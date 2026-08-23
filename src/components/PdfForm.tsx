"use client";

import { useCallback, useState } from "react";
import { setValueAtPath } from "@pipelex/mthds-form";
import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "@/actions/runSummarizePdfPipeline";
import { fileToDataUrl } from "@/lib/clientFile";
import { MAX_PDF_BYTES, fileInputErrorToPipelineError } from "@/lib/fileEncoding";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { PIPE_IO_CONTRACTS } from "@/generated/summarize-pdf/contracts";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import { requireContract } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { PdfSummaryResult } from "./PdfSummaryResult";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunStatus } from "./RunStatus";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "summarize_pdf", "summarize_pdf");

const SAMPLE_PDF_PATH = "/sample-invoice.pdf";
/** The input the sample PDF fills. Like a seeded sample text, a demo shortcut
 *  names the input it is a sample *of* — the form's structure still does not. */
const DOCUMENT_INPUT = "document";

const NO_UPLOADS: ReadonlySet<string> = new Set<string>();

function megabytes(bytes: number): string {
  const value = bytes / 1024 / 1024;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
  const { fields, values, setValues, ready, toData } = useRunInputs(CONTRACT);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  // File-selection errors (too large, FileReader failure) live separately from
  // the run state: they happen *before* a run, so there is no useRun error to
  // carry them. The run's own error comes from `state`.
  const [fileError, setFileError] = useState<PipelineError | null>(null);
  // The kernel disables a file control while its id is in here, and shows a
  // spinner — which is also what makes a second drop mid-encode impossible.
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
          fileInputErrorToPipelineError(
            {
              kind: "file_too_large",
              message: `File is ${megabytes(file.size)} MB; the limit is ${megabytes(MAX_PDF_BYTES)} MB.`,
            },
            file.name,
          ),
        );
        return;
      }
      setEncodingIds((prev) => new Set(prev).add(id));
      try {
        const url = await fileToDataUrl(withPdfMime(file));
        setValues((current) =>
          setValueAtPath(current, id.split("."), { url, filename: file.name }),
        );
      } catch (err) {
        setFileError(classifyTransportError(err));
      } finally {
        setEncodingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [reset, clearFile],
  );

  async function handleUseSample() {
    setFileError(null);
    reset();
    // Clear here too, not just in the handler below: this path awaits a network
    // round trip first, and a slow or failing fetch would otherwise leave the
    // previous PDF selected and submittable the whole time.
    clearFile(DOCUMENT_INPUT);
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
          onValuesChange={setValues}
          disabled={running}
          env={{ onDropFile: handleDropFile, uploadingIds: encodingIds }}
        />
        {/* Also disabled mid-encode: the kernel's dropzone disables itself
            while a file is being read, and this shortcut goes through the same
            handler, so it is the one remaining way to start a second read. */}
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
