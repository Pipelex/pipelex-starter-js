"use client";

import { useRef, useState, useTransition } from "react";
import { runSummarizePdfPipeline } from "@/actions/runSummarizePdfPipeline";
import { fileToDataUrl } from "@/lib/clientFile";
import {
  MAX_PDF_BYTES,
  fileInputErrorToPipelineError,
  type FileInputError,
} from "@/lib/fileEncoding";
import type { DocumentSummary } from "@/types/summarizePipeline";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import { PdfSummaryResult } from "./PdfSummaryResult";
import { ErrorDisplay } from "./ErrorDisplay";

const SAMPLE_PDF_PATH = "/sample-invoice.pdf";

function megabytes(bytes: number): string {
  const value = bytes / 1024 / 1024;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Fast client-side check so we don't base64-encode a huge or wrong-typed
 * file just to have the server reject it. `runSummarizePdfPipeline`
 * re-validates the data URL authoritatively — this is UX, not a gate.
 */
function checkFile(file: File): FileInputError | null {
  if (file.type !== "application/pdf") {
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
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState<PipelineError | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Validate, then base64-encode a chosen PDF into a data URL for submission. */
  async function acceptFile(file: File) {
    setSummary(null);
    setError(null);
    const fileError = checkFile(file);
    if (fileError) {
      setFilename(null);
      setDataUrl(null);
      setError(fileInputErrorToPipelineError(fileError, file.name));
      return;
    }
    try {
      const url = await fileToDataUrl(file);
      setFilename(file.name);
      setDataUrl(url);
    } catch (err) {
      setFilename(null);
      setDataUrl(null);
      setError(classifyTransportError(err));
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void acceptFile(file);
  }

  async function handleUseSample() {
    setSummary(null);
    setError(null);
    try {
      const res = await fetch(SAMPLE_PDF_PATH);
      if (!res.ok) throw new Error(`Could not load the sample PDF (HTTP ${res.status})`);
      const blob = await res.blob();
      // Run the sample through the exact same path as a real upload.
      await acceptFile(new File([blob], "sample-invoice.pdf", { type: "application/pdf" }));
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(classifyTransportError(err));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dataUrl) return;
    setSummary(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await runSummarizePdfPipeline({
          dataUrl,
          filename: filename ?? "document.pdf",
        });
        if (result.ok) {
          setSummary(result.summary);
        } else {
          setError(result.error);
        }
      } catch (err) {
        // Transport-layer failure — see the matching comment in EntityForm.
        setError(classifyTransportError(err));
      }
    });
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
          disabled={pending}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleUseSample}
            disabled={pending}
            className="text-xs font-medium text-blue-700 underline disabled:opacity-50"
          >
            Use sample PDF
          </button>
          {filename && <span className="text-xs text-slate-500">Selected: {filename}</span>}
        </div>
        <button
          type="submit"
          disabled={pending || !dataUrl}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Summarizing…" : "Summarize PDF"}
        </button>
      </form>

      {error && <ErrorDisplay error={error} />}

      {summary && <PdfSummaryResult summary={summary} />}
    </div>
  );
}
