import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PdfForm } from "./PdfForm";
import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "@/actions/runSummarizePdfPipeline";

vi.mock("@/actions/runSummarizePdfPipeline", () => ({
  runSummarizePdfBlocking: vi.fn(),
  startSummarizePdfRun: vi.fn(),
  pollSummarizePdfRun: vi.fn(),
}));

const blocking = vi.mocked(runSummarizePdfBlocking);
const start = vi.mocked(startSummarizePdfRun);
const poll = vi.mocked(pollSummarizePdfRun);

beforeEach(() => {
  blocking.mockReset();
  start.mockReset();
  poll.mockReset();
});

function pdfFile(name = "doc.pdf") {
  return new File(["%PDF-1.4 fake pdf bytes"], name, { type: "application/pdf" });
}

async function selectFile(file: File) {
  const input = screen.getByLabelText(/pdf document/i);
  fireEvent.change(input, { target: { files: [file] } });
  // fileToDataUrl is async (FileReader); the submit button enables once done.
  await waitFor(() => expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeEnabled());
}

/** A durable run that completes on the first poll (no setTimeout gap to bridge). */
function durableCompletes(summary: { title: string; docType: string; keyPoints: string[] }) {
  start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
  poll.mockResolvedValueOnce({ ok: true, state: "completed", output: summary });
}

describe("PdfForm", () => {
  it("encodes a selected PDF and renders the summary on success (durable)", async () => {
    durableCompletes({ title: "Invoice", docType: "invoice", keyPoints: ["Total $1,728"] });

    render(<PdfForm />);
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByText("Invoice")).toBeInTheDocument();
    // The action receives a serializable data URL + filename, never a File.
    const arg = start.mock.calls[0][0];
    expect(arg.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(arg.filename).toBe("doc.pdf");
  });

  it("rejects a non-PDF file client-side without calling any action", async () => {
    render(<PdfForm />);
    fireEvent.change(screen.getByLabelText(/pdf document/i), {
      target: { files: [new File(["x"], "photo.png", { type: "image/png" })] },
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Unsupported file type")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(blocking).not.toHaveBeenCalled();
  });

  it("renders the structured error when a poll returns ok:false", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({
      ok: false,
      transient: false,
      error: {
        kind: "auth_missing",
        title: "Pipelex API key missing",
        message: "no key configured",
        details: "ApiResponseError: HTTP 401",
      },
    });

    render(<PdfForm />);
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Pipelex API key missing")).toBeInTheDocument();
  });

  it("surfaces a transport_error when the awaited blocking action rejects", async () => {
    blocking.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<PdfForm />);
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
  });

  it("clears a prior summary when the sample-PDF fetch fails", async () => {
    durableCompletes({ title: "Invoice", docType: "invoice", keyPoints: ["Total $1,728"] });

    render(<PdfForm />);
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));
    expect(await screen.findByText("Invoice")).toBeInTheDocument();

    // The sample fetch now fails — the stale summary must not linger beside the
    // new error (regression: clearing used to run only on the success path).
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")));
    try {
      fireEvent.click(screen.getByRole("button", { name: /use sample pdf/i }));
      expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
      expect(screen.queryByText("Invoice")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts a .pdf when the browser reports an empty MIME type", async () => {
    durableCompletes({ title: "Invoice", docType: "invoice", keyPoints: [] });

    render(<PdfForm />);
    const fileWithEmptyType = new File(["%PDF-1.4"], "report.pdf", { type: "" });
    fireEvent.change(screen.getByLabelText(/pdf document/i), {
      target: { files: [fileWithEmptyType] },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByText("Invoice")).toBeInTheDocument();
    // The empty MIME is normalized so the data URL carries application/pdf.
    const arg = start.mock.calls[0][0];
    expect(arg.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true);
  });

  it("ignores a stale FileReader read when a newer file is selected", async () => {
    durableCompletes({ title: "Second", docType: "invoice", keyPoints: [] });

    // First-call FileReader stays pending; second-call resolves immediately.
    // If the stale guard is missing, the late first read overwrites filename
    // and the action receives "first.pdf" instead of "second.pdf".
    const RealFileReader = globalThis.FileReader;
    const pendingFirst: { fire?: () => void } = {};
    let callCount = 0;
    class StubFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((ev: ProgressEvent) => void) | null = null;
      onerror: ((ev: ProgressEvent) => void) | null = null;
      readAsDataURL(_file: File) {
        callCount += 1;
        const isFirst = callCount === 1;
        const reader = this;
        const fire = () => {
          reader.result = `data:application/pdf;base64,${isFirst ? "Zmlyc3Q=" : "c2Vjb25k"}`;
          reader.onload?.(new ProgressEvent("load"));
        };
        if (isFirst) {
          pendingFirst.fire = fire;
        } else {
          queueMicrotask(fire);
        }
      }
    }
    (globalThis as unknown as { FileReader: typeof FileReader }).FileReader =
      StubFileReader as unknown as typeof FileReader;

    try {
      render(<PdfForm />);
      const input = screen.getByLabelText(/pdf document/i);
      fireEvent.change(input, { target: { files: [pdfFile("first.pdf")] } });
      fireEvent.change(input, { target: { files: [pdfFile("second.pdf")] } });

      await waitFor(() => expect(screen.getByText(/Selected: second\.pdf/)).toBeInTheDocument());
      // Now let the stale first read finish — it must not overwrite state.
      pendingFirst.fire?.();
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByText(/Selected: second\.pdf/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));
      await screen.findByText("Second");
      expect(start.mock.calls[0][0].filename).toBe("second.pdf");
    } finally {
      (globalThis as unknown as { FileReader: typeof FileReader }).FileReader = RealFileReader;
    }
  });
});
