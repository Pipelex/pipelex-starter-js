"use server";

import { getPipelexClient } from "@/lib/pipelexClient";
import { loadSummarizePdfBundle } from "@/lib/loadBundle";
import { MAX_PDF_BYTES, fileInputErrorToPipelineError, validateDataUrl } from "@/lib/fileEncoding";
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

/**
 * Build the run options, uploading the PDF through the SDK's signature-driven
 * `prepareInputs` instead of hand-rolling a `Document` envelope.
 *
 * `prepareInputs` reads the method's declared signature (`document` is a
 * `Document` input), so it knows the bare data URL at `document` is a *file*: it
 * uploads the decoded bytes to Pipelex storage and rewrites the input to a small
 * `pipelex-storage://` URI. The run request then carries that reference, not the
 * fat inline base64 the old envelope embedded. `pipe_ref` is omitted, so it
 * defaults to the closure's `main_pipe` (`summarize_pdf`).
 *
 * On failure `prepareInputs` throws *before any run starts* (a typed
 * `InputPreparationError` — see `classifyInputPreparationError`). Because this
 * closure runs inside `executeBlockingRun` / `startDurableRun`'s try/catch, that
 * error is classified like any other SDK error — no new try/catch here. On the
 * durable path the upload happens once, at start; `poll` never rebuilds options,
 * so there is no re-upload.
 */
async function buildOptions(input: SummarizePdfInput): Promise<StartOptions> {
  const bundle = await loadSummarizePdfBundle();
  const prepared = await getPipelexClient().prepareInputs({
    files: [{ content: bundle }],
    inputs: { document: input.dataUrl },
  });
  return { pipe_code: PIPE_CODE, mthds_contents: [bundle], inputs: prepared.inputs };
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
