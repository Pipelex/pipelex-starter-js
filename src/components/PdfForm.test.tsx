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

const USAGE = {
  calls: [
    {
      modelName: "gpt-4o",
      modelType: "llm",
      pipeCode: "summarize_pdf",
      tokensByCategory: { input: 3400, output: 210 },
      costUsd: 0.012,
    },
  ],
  totalCostUsd: 0.012,
  hasCost: true,
  state: "records" as const,
  assemblyError: null,
};

function pdfFile(name = "doc.pdf", type = "application/pdf") {
  return new File(["%PDF-1.4 fake pdf bytes"], name, { type });
}

/**
 * The kernel's `DocumentField` is a react-dropzone drop area wrapping a hidden
 * file input. It carries no accessible label (`FieldShell` renders a `div`, not
 * a `<label>`, when no control id is linkable), so the input is reached by type
 * — the same element a real drop or browse would deliver the file to.
 */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  return input;
}

async function selectFile(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
  // fileToDataUrl is async (FileReader); the submit button enables once done.
  await waitFor(() => expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeEnabled());
}

/** The document input's value, as the action received it. */
function documentArg(call: [Record<string, unknown>]): { url?: string; filename?: string } {
  return call[0].document as { url?: string; filename?: string };
}

/** A durable run that completes on the first poll (no setTimeout gap to bridge). */
function durableCompletes(summary: { title: string; doc_type: string; key_points: string[] }) {
  start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
  poll.mockResolvedValueOnce({ ok: true, state: "completed", output: summary, usage: USAGE });
}

describe("PdfForm", () => {
  it("renders the file input the method's contract declares", () => {
    render(<PdfForm />);
    // `document` in the bundle → "Document" through the kernel's `app`
    // presentation, rendered as a dropzone because the concept is a file one.
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeDisabled();
  });

  it("encodes a dropped PDF and renders the summary on success (durable)", async () => {
    durableCompletes({ title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] });

    render(<PdfForm />);
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByText("Invoice")).toBeInTheDocument();
    // The action receives the kernel's `FileValue` in schema shape — a
    // serializable data URL and a filename, never a `File`.
    const value = documentArg(start.mock.calls[0]);
    expect(value.url?.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(value.filename).toBe("doc.pdf");
  });

  it("rejects an oversized file before encoding it", async () => {
    render(<PdfForm />);
    const huge = pdfFile("huge.pdf");
    // `File.size` is read-only; stand in for a 9 MB file (the cap is 8 MB).
    Object.defineProperty(huge, "size", { value: 9 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [huge] } });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("PDF too large")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(blocking).not.toHaveBeenCalled();
  });

  it("drops the previous PDF when its replacement is rejected", async () => {
    render(<PdfForm />);
    await selectFile(pdfFile("first.pdf"));

    // Once a file is chosen the kernel renders a file chip and hides the drop
    // zone, so the one way to select a replacement is this form's own shortcut.
    // Hand it an oversized sample: the replacement is rejected, and the point is
    // that the *first* PDF must not survive as a submittable value.
    const oversized = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: "application/pdf" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => oversized }),
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: /use sample pdf/i }));
      expect(await screen.findByText("PDF too large")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
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
    durableCompletes({ title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] });

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
      // The replacement was requested before the fetch could fail, so the PDF it
      // was replacing must not still be sitting there submittable.
      expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts a .pdf when the browser reports an empty MIME type", async () => {
    durableCompletes({ title: "Invoice", doc_type: "invoice", key_points: [] });

    render(<PdfForm />);
    await selectFile(pdfFile("report.pdf", ""));
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByText("Invoice")).toBeInTheDocument();
    // The empty MIME is normalized before encoding, so the data URL carries
    // application/pdf and the server's MIME gate accepts it.
    expect(documentArg(start.mock.calls[0]).url?.startsWith("data:application/pdf;base64,")).toBe(
      true,
    );
  });
});
