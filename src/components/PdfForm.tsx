"use client";

import { useState } from "react";
import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "@/actions/runSummarizePdfPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/summarize-pdf/contracts";
import { useFileInputs } from "@/hooks/useFileInputs";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import { requireResultField } from "@/lib/resultField";
import { requireContract, requireInputForm } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunResult } from "./RunResult";
import { RunStatus } from "./RunStatus";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "summarize_pdf", "summarize_pdf");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "summarize_pdf", "summarize_pdf");
const RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, "summarize_pdf", "summarize_pdf");

const SAMPLE_PDF_PATH = "/sample-invoice.pdf";
/** The input the sample PDF fills. Like a seeded sample text, a demo shortcut
 *  names the input it is a sample *of* — the form's structure still does not. */
const DOCUMENT_INPUT = "document";

/**
 * The kernel previews `http(s):`, `data:` and `blob:` URLs directly — the
 * sample shortcut's `data:` URL included. Anything else it asks the host to
 * resolve first, and the path that reaches it here is a
 * `pipelex-storage://…/x.pdf` pasted through the control's own "paste a URL
 * instead". This template has nothing to resolve such a reference with, so
 * hand it straight back: the kernel then renders its `<object>`, whose
 * "Preview unavailable" child is what a browser shows for a scheme it cannot
 * fetch — which beats no preview at all. A real host would exchange the
 * storage URI for a signed web URL here.
 */
async function resolvePreviewUrl(url: string): Promise<string> {
  return url;
}

/**
 * Some drag-drop sources and Windows configurations hand a valid PDF over with
 * an empty `file.type`, and `FileReader` then writes that emptiness into the
 * data URL — which the server's MIME gate rejects. Re-wrap those so the encoded
 * URL carries `application/pdf`.
 *
 * This is *encoding*, not validation: the extension test is what keeps it from
 * stamping "PDF" on something that is not one, and the server still checks the
 * MIME it receives.
 */
function withPdfMime(file: File): File {
  if (file.type || !file.name.toLowerCase().endsWith(".pdf")) return file;
  return new File([file], file.name, { type: "application/pdf" });
}

export function PdfForm() {
  const { fields, values, setValues, ready, toData } = useRunInputs(CONTRACT, DESCRIPTOR);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);

  const { state, run, reset } = useRun({
    mode,
    blocking: runSummarizePdfBlocking,
    start: startSummarizePdfRun,
    poll: pollSummarizePdfRun,
  });

  // The host side of the kernel's file seam — the encode, the busy set the
  // kernel reads as `uploadingIds`, the clear-before-await discipline. Shared
  // with every scaffolded form that declares a file input; the two options are
  // this example's own: clear the previous run when a new file is selected, and
  // re-wrap a `.pdf` the browser described with no MIME type.
  const { dropFile, encodingIds, fileError, clearError, markBusy, reportError, clearFile } =
    useFileInputs({ setValues, onSelectionStart: reset, prepareFile: withPdfMime });

  const running = state.phase === "running";

  async function handleUseSample() {
    clearError();
    reset();
    // Clear here too, not just in the hook: this path awaits a network round
    // trip first, and a slow or failing fetch would otherwise leave the
    // previous PDF selected and submittable the whole time.
    clearFile(DOCUMENT_INPUT);
    // Busy for the fetch as well as the encode. Without this the field is
    // writable while the sample is still downloading, so a PDF the user picks
    // meanwhile would be overwritten when the older sample request lands.
    markBusy(DOCUMENT_INPUT, true);
    try {
      const res = await fetch(SAMPLE_PDF_PATH);
      if (!res.ok) throw new Error(`Could not load the sample PDF (HTTP ${res.status})`);
      const blob = await res.blob();
      // Run the sample through the exact same seam as a real drop.
      await dropFile(
        DOCUMENT_INPUT,
        new File([blob], "sample-invoice.pdf", { type: "application/pdf" }),
      );
    } catch (err) {
      reportError(err);
    } finally {
      markBusy(DOCUMENT_INPUT, false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    run(toData());
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <RunInputsForm
          fields={fields}
          values={values}
          onValuesChange={(next) => {
            // A rejection belongs to the value that caused it. The kernel's
            // "paste a URL instead" writes straight through this setter without
            // touching `acceptFile`, so without clearing here a "File is too
            // large" alert sits under a field the user has already fixed.
            clearError();
            setValues(next);
          }}
          disabled={running}
          env={{
            onDropFile: dropFile,
            uploadingIds: encodingIds,
            resolveUrl: resolvePreviewUrl,
          }}
        />
        {/* App chrome that writes into the field holds itself to the rule the
            kernel applies to its own controls through `uploadingIds`: no
            writes while the value is still resolving. The span covers this
            shortcut's own fetch as well as any encode. */}
        <button
          type="button"
          onClick={handleUseSample}
          disabled={running || encodingIds.size > 0}
          className="text-xs font-medium text-blue-700 underline disabled:opacity-50"
        >
          Use sample PDF
        </button>
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        <button
          type="submit"
          disabled={running || !ready}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Summarizing…" : "Summarize PDF"}
        </button>
      </form>

      {running && (
        <RunStatus status={state.status} elapsedMs={state.elapsedMs} health={state.health} />
      )}
      {fileError && <ErrorDisplay error={fileError} />}
      {!fileError && state.phase === "error" && <ErrorDisplay error={state.error} />}
      {state.phase === "done" && (
        <>
          <RunResult field={RESULT_FIELD} value={state.output} name="document_summary" />
          <CostReport usage={state.usage} />
        </>
      )}
    </div>
  );
}
