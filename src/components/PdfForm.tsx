"use client";

import { useCallback, useState } from "react";
import { setValueAtPath } from "@pipelex/mthds-form";
import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "@/actions/runSummarizePdfPipeline";
import { fileToDataUrl } from "@/lib/clientFile";
import {
  MAX_PDF_BYTES,
  fileInputErrorToPipelineError,
  fileTooLargeError,
} from "@/lib/fileEncoding";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/summarize-pdf/contracts";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import { requireContract, requireInputForm } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { PdfSummaryResult } from "./PdfSummaryResult";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunStatus } from "./RunStatus";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "summarize_pdf", "summarize_pdf");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "summarize_pdf", "summarize_pdf");

const SAMPLE_PDF_PATH = "/sample-invoice.pdf";
/** The input the sample PDF fills. Like a seeded sample text, a demo shortcut
 *  names the input it is a sample *of* — the form's structure still does not. */
const DOCUMENT_INPUT = "document";

const NO_UPLOADS: ReadonlySet<string> = new Set<string>();

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
  // File-selection errors (too large, FileReader failure) live separately from
  // the run state: they happen *before* a run, so there is no useRun error to
  // carry them. The run's own error comes from `state`.
  const [fileError, setFileError] = useState<PipelineError | null>(null);
  // While an id is in here the kernel shuts every door into that value — the
  // dropzone, the "paste a URL instead" toggle and the URL input behind it —
  // and shows a spinner. That is what makes a second write mid-encode
  // impossible without this form folding encode state into `disabled`.
  const [encodingIds, setEncodingIds] = useState<ReadonlySet<string>>(NO_UPLOADS);

  const { state, run, reset } = useRun({
    mode,
    blocking: runSummarizePdfBlocking,
    start: startSummarizePdfRun,
    poll: pollSummarizePdfRun,
  });

  const running = state.phase === "running";

  /**
   * Un-select the file at `id`. Every path that is about to replace a selection
   * calls this *before* its first await, so the form's value is only ever a
   * successfully encoded file: a replacement that is still in flight, or one
   * that fails, leaves nothing behind to submit by accident.
   */
  const clearFile = useCallback(
    (id: string) => setValues((current) => setValueAtPath(current, id.split("."), undefined)),
    [setValues],
  );

  /**
   * Hold the field at `id` in its busy state for the whole of an operation that
   * will end in a new value — the kernel disables that control and shows a
   * spinner while it is set, and this form's sample shortcut is disabled too.
   * Cover every await, not just the encode: a window where the field is
   * writable while an older selection is still resolving is a window where the
   * older one lands last and silently replaces the newer.
   *
   * This is a set, not a refcount, and `handleUseSample` nests a `handleDropFile`
   * inside its own busy span — so the inner `finally` releases the field while
   * the outer is still running. That is safe only because nothing awaits after
   * the inner call returns. Add an `await` there and the window reopens.
   */
  const markBusy = useCallback((id: string, busy: boolean) => {
    setEncodingIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /**
   * The host seam for file inputs: the kernel never uploads. `DocumentField`
   * hands us the dropped `File` and the dotted path of the field that asked,
   * and we write a `FileValue` (`{url, filename}`) back at that path. Here the
   * "upload" is a base64 data URL — the Server Action passes it to the SDK's
   * `prepareInputs`, which does the real upload to Pipelex storage.
   */
  const handleDropFile = useCallback(
    async (id: string, file: File) => {
      setFileError(null);
      reset(); // clear any prior run result/error so only the new selection shows
      clearFile(id); // before the size check and before the encode
      // Checked here, before encoding, purely to save the work: base64 inflates
      // a file ~37%, and past this cap the payload would not fit the Server
      // Action body limit anyway. The same constant is re-checked server-side,
      // which is the actual gate — this is the early exit, not a second rule.
      if (file.size > MAX_PDF_BYTES) {
        setFileError(
          fileInputErrorToPipelineError(fileTooLargeError(file.size, MAX_PDF_BYTES), file.name),
        );
        return;
      }
      markBusy(id, true);
      try {
        const url = await fileToDataUrl(withPdfMime(file));
        setValues((current) =>
          setValueAtPath(current, id.split("."), { url, filename: file.name }),
        );
      } catch (err) {
        setFileError(classifyTransportError(err));
      } finally {
        markBusy(id, false);
      }
    },
    [reset, clearFile, markBusy, setValues],
  );

  async function handleUseSample() {
    setFileError(null);
    reset();
    // Clear here too, not just in the handler below: this path awaits a network
    // round trip first, and a slow or failing fetch would otherwise leave the
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
      await handleDropFile(
        DOCUMENT_INPUT,
        new File([blob], "sample-invoice.pdf", { type: "application/pdf" }),
      );
    } catch (err) {
      setFileError(classifyTransportError(err));
    } finally {
      markBusy(DOCUMENT_INPUT, false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFileError(null);
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
            setFileError(null);
            setValues(next);
          }}
          disabled={running}
          env={{
            onDropFile: handleDropFile,
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
          <PdfSummaryResult summary={state.output} />
          <CostReport usage={state.usage} />
        </>
      )}
    </div>
  );
}
