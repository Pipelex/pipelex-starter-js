import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { specFromJsonl } from "@pipelex/mthds-form/generative";
import { DESIGN } from "@/generated/summarize-pdf/design";
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
 * The kernel's `DocumentField` links its field label to the `<input
 * type="file">` itself — the tab stop lives on the input, with the focus ring
 * drawn on the dropzone through `focus-within` — so the accessible query
 * reaches the same element a real drop or browse would deliver the file to.
 */
function fileInput(): HTMLInputElement {
  return screen.getByLabelText("Document");
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

/**
 * Switch to the kernel's plain form.
 *
 * This method carries a committed design now, so the tab opens on the page a
 * model laid out — and every label, button name and section title on that page
 * is the model's, re-written whenever the design is re-produced. The toggle is
 * app chrome and its name is this repo's, so one click here is what keeps the
 * assertions below about the run path rather than about somebody's copy. The
 * designed view has its own tests, which read what the committed layout
 * actually says rather than assuming any of it.
 */
/** The call to action's label, read from the committed layout rather than assumed. */
function ctaLabelOf(jsonl: string): string {
  const spec = specFromJsonl(jsonl);
  const cta = Object.values(spec.elements ?? {}).find(
    (element) => (element as { type?: string }).type === "Cta",
  ) as { props?: { label?: string } } | undefined;
  const label = cta?.props?.label;
  if (!label) throw new Error("the committed design has no call to action");
  return label;
}

function showPlainForm() {
  fireEvent.click(screen.getByRole("radio", { name: "Plain form" }));
}

describe("PdfForm", () => {
  it("renders the file input the method's contract declares", () => {
    render(<PdfForm />);
    showPlainForm();
    // `document` in the bundle → "Document" through the kernel's `app`
    // presentation, rendered as a dropzone because the concept is a file one.
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeDisabled();
  });

  it("encodes a dropped PDF and renders the summary on success (durable)", async () => {
    durableCompletes({ title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] });

    render(<PdfForm />);

    showPlainForm();
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
    showPlainForm();
    const huge = pdfFile("huge.pdf");
    // `File.size` is read-only; stand in for a 9 MB file (the cap is 8 MB).
    Object.defineProperty(huge, "size", { value: 9 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [huge] } });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("File too large")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(blocking).not.toHaveBeenCalled();
  });

  it("clears a rejection once the user fixes the input by pasting a URL", async () => {
    render(<PdfForm />);
    showPlainForm();
    const huge = pdfFile("huge.pdf");
    Object.defineProperty(huge, "size", { value: 9 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [huge] } });
    expect(await screen.findByText("File too large")).toBeInTheDocument();

    // "paste a URL instead" writes straight through `onValuesChange`, never
    // touching the handler that set the error — so the alert outlives the value
    // that caused it unless the setter clears it.
    fireEvent.click(screen.getByRole("button", { name: /paste a url instead/i }));
    fireEvent.change(screen.getByPlaceholderText(/pipelex-storage/i), {
      target: { value: "https://example.com/ok.pdf" },
    });

    await waitFor(() => expect(screen.queryByText("File too large")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeEnabled();
  });

  it("drops the previous PDF when its replacement is rejected", async () => {
    render(<PdfForm />);
    showPlainForm();
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
      expect(await screen.findByText("File too large")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("locks the field while the sample PDF is still downloading", async () => {
    let release!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      ),
    );
    try {
      render(<PdfForm />);
      showPlainForm();
      fireEvent.click(screen.getByRole("button", { name: /use sample pdf/i }));

      // Still downloading: every door into the field is shut, so a PDF picked
      // meanwhile cannot be silently overwritten when this older request lands.
      expect(await screen.findByText("Uploading…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /use sample pdf/i })).toBeDisabled();
      // react-dropzone disables by no-op'ing its handler, not by setting the
      // `disabled` attribute — so the check is that the change does nothing.
      // `handleDropFile` is async, so it has to be given the chance to run:
      // asserting straight after the event passes whether or not the drop was
      // refused, which is what made this case vacuous before.
      fireEvent.change(fileInput(), { target: { files: [pdfFile("mine.pdf")] } });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      // An accepted drop renders its filename in the kernel's file chip, and
      // its `finally` would have emptied `encodingIds` and re-enabled submit.
      expect(screen.queryByText(/mine\.pdf/)).not.toBeInTheDocument();
      // The third door: the kernel's `uploadingIds` shuts the "paste a URL
      // instead" toggle and its input too, not only the dropzone — the form
      // passes plain run state as `disabled` and relies on that. Left open, a
      // URL pasted here makes the form ready mid-fetch — and the run it starts
      // is abandoned client-side when the fetch lands and calls `reset()`.
      expect(screen.getByRole("button", { name: /paste a url instead/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeDisabled();

      release({
        ok: true,
        blob: async () => new Blob(["%PDF-1.4 sample"], { type: "application/pdf" }),
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeEnabled(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("answers a pasted storage URL instead of spinning forever", async () => {
    // The kernel paints `http(s):`, `data:` and `blob:` URLs directly; a
    // non-web scheme is what it hands to the host's `resolveUrl`, and
    // `pipelex-storage://…` pasted through "paste a URL instead" is the path
    // that reaches it here. The identity resolver is this template's answer —
    // it has nothing to sign the URI with — and this pins what that buys.
    //
    // Not a preview: the kernel judges a resolver's answer by the same URL gate
    // it judges a payload by, so a storage URI comes back refused and the panel
    // shows "nothing to show". The difference the resolver makes is that this
    // is an ANSWER — with no resolver the kernel has a reference and nothing
    // said about it, which is a load in flight, and it spins for good.
    render(<PdfForm />);
    showPlainForm();
    fireEvent.click(screen.getByRole("button", { name: /paste a url instead/i }));
    fireEvent.change(screen.getByPlaceholderText(/pipelex-storage/i), {
      target: { value: "pipelex-storage://bucket/invoice.pdf" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /summarize pdf/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(document.querySelector(".animate-spin")).toBeNull());
    expect(document.querySelector('object[type="application/pdf"]')).toBeNull();
    // And the reference is still the value — refusing to PAINT it is not
    // refusing to send it, and the run receives what was pasted.
    expect(screen.getByDisplayValue("pipelex-storage://bucket/invoice.pdf")).toBeInTheDocument();
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

    showPlainForm();
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Pipelex API key missing")).toBeInTheDocument();
  });

  it("surfaces a transport_error when the awaited blocking action rejects", async () => {
    blocking.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<PdfForm />);

    showPlainForm();
    await selectFile(pdfFile());
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));

    expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
  });

  it("clears a prior summary when the sample-PDF fetch fails", async () => {
    durableCompletes({ title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] });

    render(<PdfForm />);

    showPlainForm();
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

    showPlainForm();
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

// The designed view, and the one piece of real host code it needs.
//
// `MthdsField` mints the file control's DOM id from the store pointer it was
// given, so the id the kernel reports is not the dotted value path a plain form
// reports. `inputPathOf` is the inverse, and a file written at a
// plausible-looking wrong path is the failure this seam exists to prevent — so
// what is asserted is that the encoded value reaches the ACTION, not merely
// that the drop was accepted.
describe("PdfForm's designed page", () => {
  it("has a committed design that this kernel renders", () => {
    expect(DESIGN).not.toBeNull();
    render(<PdfForm />);
    // The kernel's own file control, reached through the layout's escape hatch:
    // the designed page delegates a document rather than approximating it.
    expect(screen.getByLabelText("Document")).toBeInTheDocument();
  });

  it("writes a file dropped on the designed page at the input's value path", async () => {
    durableCompletes({ title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] });

    render(<PdfForm />);
    const ctaLabel = ctaLabelOf(DESIGN?.jsonl ?? "");
    fireEvent.change(screen.getByLabelText("Document"), { target: { files: [pdfFile()] } });
    // Waited on the FILENAME, not on the call to action: a designed page's Cta
    // is never disabled — the catalog has no readiness prop, and a press with an
    // input missing is meant to reach the server's gate. So there is nothing to
    // enable, and the encode is a real `FileReader` that has to be waited out.
    await waitFor(() => expect(screen.getByText("doc.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: ctaLabel }));

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(documentArg(start.mock.calls[0] as [Record<string, unknown>])).toMatchObject({
      filename: "doc.pdf",
    });
    expect(documentArg(start.mock.calls[0] as [Record<string, unknown>]).url).toMatch(
      /^data:application\/pdf;base64,/,
    );
  });

  it("keeps the file across the toggle, because both views read one store", async () => {
    render(<PdfForm />);
    fireEvent.change(screen.getByLabelText("Document"), { target: { files: [pdfFile()] } });
    await waitFor(() => expect(screen.getByText("doc.pdf")).toBeInTheDocument());

    showPlainForm();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });
});
