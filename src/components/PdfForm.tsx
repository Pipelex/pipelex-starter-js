"use client";

import { useRef, useState } from "react";
import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "@/actions/runSummarizePdfPipeline";
import { fileToDataUrl } from "@/lib/clientFile";
import {
  MAX_PDF_BYTES,
  fileInputErrorToPipelineError,
  type FileInputError,
} from "@/lib/fileEncoding";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { useRun } from "@/hooks/useRun";
import { PdfSummaryResult } from "./PdfSummaryResult";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunStatus } from "./RunStatus";

const SAMPLE_PDF_PATH = "/sample-invoice.pdf";

function megabytes(bytes: number): string {
  const value = bytes / 1024 / 1024;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Browsers and OS integrations occasionally surface an empty `file.type`
 * for valid PDFs (e.g. some drag-drop sources, some Windows configurations).
 * Fall back to the extension so those uploads aren't blocked client-side —
 * the Server Action still re-validates authoritatively.
 */
function inferPdfMime(file: File): string {
  if (file.type) return file.type;
  return file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "";
}

/**
 * Fast client-side check so we don't base64-encode a huge or wrong-typed
 * file just to have the server reject it. The Server Action re-validates the
 * data URL authoritatively — this is UX, not a gate.
 */
function checkFile(file: File): FileInputError | null {
  const mime = inferPdfMime(file);
  if (mime !== "application/pdf") {
    return {
      kind: "unsupported_file_type",
      message: `Expected a PDF; received "${file.type || "unknown type"}".`,
    };
  }
  if (file.size > MAX_PDF_BYTES) {
    return {
      kind: "file_too_large",
      message: `File is ${megabytes(file.size)} MB; the limit is ${megabytes(MAX_PDF_BYTES)} MB.`,
    };
  }
  return null;
}

export function PdfForm() {
  const [filename, setFilename] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  // File-selection errors (wrong type, too large, FileReader failure) live
  // separately from the run state: they happen *before* a run, so there is no
  // useRun error to carry them. The run's own error comes from `state`.
  const [fileError, setFileError] = useState<PipelineError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every `acceptFile` call; lets us ignore a stale FileReader read
  // when the user picks a second file before the first finishes encoding.
  const selectionTokenRef = useRef(0);

  const { state, run, reset } = useRun({
    mode,
    blocking: runSummarizePdfBlocking,
    start: startSummarizePdfRun,
    poll: pollSummarizePdfRun,
  });

  const running = state.phase === "running";

  /** Validate, then base64-encode a chosen PDF into a data URL for submission. */
  async function acceptFile(file: File) {
    const token = ++selectionTokenRef.current;
    const isCurrent = () => selectionTokenRef.current === token;
    setFileError(null);
    reset(); // clear any prior run result/error so only the new selection shows
    const fileCheck = checkFile(file);
    if (fileCheck) {
      setFilename(null);
      setDataUrl(null);
      setFileError(fileInputErrorToPipelineError(fileCheck, file.name));
      return;
    }
    // Normalize an empty MIME (see `inferPdfMime`) so the encoded data URL
    // carries `application/pdf`, which the server's validator requires.
    const fileForEncoding =
      file.type === "application/pdf"
        ? file
        : new File([file], file.name, { type: "application/pdf" });
    try {
      const url = await fileToDataUrl(fileForEncoding);
      if (!isCurrent()) return;
      setFilename(file.name);
      setDataUrl(url);
    } catch (err) {
      if (!isCurrent()) return;
      setFilename(null);
      setDataUrl(null);
      setFileError(classifyTransportError(err));
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void acceptFile(file);
  }

  async function handleUseSample() {
    // Clear any prior run result/error up-front: `acceptFile` resets too, but
    // only on the success path — if the fetch below fails, an earlier summary
    // would otherwise stay rendered next to the new error.
    setFileError(null);
    reset();
    try {
      const res = await fetch(SAMPLE_PDF_PATH);
      if (!res.ok) throw new Error(`Could not load the sample PDF (HTTP ${res.status})`);
      const blob = await res.blob();
      // Run the sample through the exact same path as a real upload.
      await acceptFile(new File([blob], "sample-invoice.pdf", { type: "application/pdf" }));
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setFileError(classifyTransportError(err));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dataUrl) return;
    setFileError(null);
    run({ dataUrl, filename: filename ?? "document.pdf" });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label htmlFor="pdf-file" className="block text-sm font-medium text-slate-700">
          PDF document
        </label>
        <input
          id="pdf-file"
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          disabled={running}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleUseSample}
            disabled={running}
            className="text-xs font-medium text-blue-700 underline disabled:opacity-50"
          >
            Use sample PDF
          </button>
          {filename && <span className="text-xs text-slate-500">Selected: {filename}</span>}
        </div>
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        <button
          type="submit"
          disabled={running || !dataUrl}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Summarizing…" : "Summarize PDF"}
        </button>
      </form>

      {running && (
        <RunStatus status={state.status} elapsedMs={state.elapsedMs} degraded={state.degraded} />
      )}
      {fileError && <ErrorDisplay error={fileError} />}
      {!fileError && state.phase === "error" && <ErrorDisplay error={state.error} />}
      {state.phase === "done" && <PdfSummaryResult summary={state.output} />}
    </div>
  );
}
