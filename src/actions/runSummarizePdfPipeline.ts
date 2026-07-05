"use server";

import { loadSummarizePdfBundle } from "@/lib/loadBundle";
import {
  MAX_PDF_BYTES,
  buildDocumentInput,
  fileInputErrorToPipelineError,
  validateDataUrl,
} from "@/lib/fileEncoding";
import { parseDocumentSummary, type DocumentSummary } from "@/types/summarizePipeline";
import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";
import {
  pollDurableRun,
  startDurableRun,
  type PollOutcome,
  type StartOutcome,
} from "@/lib/durableRun";
import type { PipelineError } from "@/lib/errors";
import type { StartOptions } from "@pipelex/sdk";

const PIPE_CODE = "summarize_pdf";

/** Serializable PDF input — encoded client-side by `fileToDataUrl` (no `File`). */
type SummarizePdfInput = { dataUrl: string; filename: string };

/**
 * Empty-input + authoritative file pre-flight, shared by both paths. The PDF
 * arrives as a base64 data URL; size/MIME are validated here (the client's own
 * check is just UX). Returns the error to short-circuit with, or null to proceed.
 */
function preflight(input: SummarizePdfInput): PipelineError | null {
  if (!input.dataUrl) {
    return {
      kind: "bad_request",
      title: "PDF required",
      message: "Choose a PDF file (or use the sample) to summarize.",
      details: "Empty file input",
    };
  }
  const fileError = validateDataUrl(input.dataUrl, {
    allowedMimes: ["application/pdf"],
    maxBytes: MAX_PDF_BYTES,
  });
  if (fileError) return fileInputErrorToPipelineError(fileError, input.filename);
  return null;
}

async function buildOptions(input: SummarizePdfInput): Promise<StartOptions> {
  return {
    pipe_code: PIPE_CODE,
    mthds_contents: [await loadSummarizePdfBundle()],
    inputs: { document: buildDocumentInput(input.dataUrl, input.filename || "document.pdf") },
  };
}

/** BLOCKING path: summarize an uploaded PDF synchronously (`POST /v1/execute`). */
export async function runSummarizePdfBlocking(
  input: SummarizePdfInput,
): Promise<BlockingOutcome<DocumentSummary>> {
  const error = preflight(input);
  if (error) return { ok: false, error };
  return executeBlockingRun(() => buildOptions(input), parseDocumentSummary);
}

/** DURABLE path — start the summarize run and return its id to poll. */
export async function startSummarizePdfRun(input: SummarizePdfInput): Promise<StartOutcome> {
  const error = preflight(input);
  if (error) return { ok: false, error };
  return startDurableRun(() => buildOptions(input));
}

/** DURABLE path — poll one tick of a started summarize run by id. */
export async function pollSummarizePdfRun(runId: string): Promise<PollOutcome<DocumentSummary>> {
  return pollDurableRun(runId, parseDocumentSummary);
}
