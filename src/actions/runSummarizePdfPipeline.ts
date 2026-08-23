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
import { gateRunInputs, requireContract } from "@/lib/runInputs";
import { PIPE_IO_CONTRACTS } from "@/generated/summarize-pdf/contracts";
import type { PipelineError } from "@/lib/errors";
import type { StartOptions } from "@pipelex/sdk";

const PIPE_CODE = "summarize_pdf";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "summarize_pdf", PIPE_CODE);

/**
 * The gate proves the *shape*; this proves the *bytes*.
 *
 * A method's contract says the document input carries a `url` — it cannot say
 * "under 8 MB, and actually a PDF". So the kernel gate runs first and this runs
 * after it, over the enveloped inputs the gate produced. It only fires on an
 * inline data URL: the kernel's paste-a-URL affordance yields an `https://` or
 * `pipelex-storage://` reference, which carries no bytes across this boundary
 * and is `prepareInputs`' business to resolve.
 *
 * This is the authoritative check. The browser's own size check is an early
 * exit that saves an encode, not a gate — it is trivially bypassed.
 */
function checkDocumentBytes(inputs: Record<string, unknown>): PipelineError | null {
  const envelope = inputs.document as { content?: { url?: unknown; filename?: unknown } };
  const content = envelope?.content;
  if (typeof content?.url !== "string" || !content.url.startsWith("data:")) return null;

  const fileError = validateDataUrl(content.url, {
    allowedMimes: ["application/pdf"],
    maxBytes: MAX_PDF_BYTES,
  });
  if (!fileError) return null;
  return fileInputErrorToPipelineError(
    fileError,
    typeof content.filename === "string" ? content.filename : "document.pdf",
  );
}

/** Shape gate + byte gate, in that order. Shared by both execution paths. */
function gatePdfInputs(
  data: Record<string, unknown>,
): { ok: true; inputs: Record<string, unknown> } | { ok: false; error: PipelineError } {
  const gated = gateRunInputs(CONTRACT, data);
  if (!gated.ok) return gated;
  const error = checkDocumentBytes(gated.inputs);
  return error ? { ok: false, error } : gated;
}

/**
 * Build the run options, uploading the PDF through the SDK's signature-driven
 * `prepareInputs` instead of hand-rolling a `Document` envelope.
 *
 * `prepareInputs` reads the method's declared signature (`document` is a
 * `Document` input), so it knows the data URL at `document` is a *file*: it
 * uploads the decoded bytes to Pipelex storage and rewrites the input to a small
 * `pipelex-storage://` URI. The run request then carries that reference, not the
 * fat inline base64. It takes the kernel's explicit `{concept, content}`
 * envelope as readily as a bare value — verified live against the hosted API —
 * and preserves the envelope on output, so the gate's payload goes straight in.
 * `pipe_ref` is omitted, so it defaults to the closure's `main_pipe`.
 *
 * On failure `prepareInputs` throws *before any run starts* (a typed
 * `InputPreparationError` — see `classifyInputPreparationError`). Because this
 * closure runs inside `executeBlockingRun` / `startDurableRun`'s try/catch, that
 * error is classified like any other SDK error — no new try/catch here. On the
 * durable path the upload happens once, at start; `poll` never rebuilds options,
 * so there is no re-upload.
 */
async function buildOptions(inputs: Record<string, unknown>): Promise<StartOptions> {
  const bundle = await loadSummarizePdfBundle();
  const prepared = await getPipelexClient().prepareInputs({
    files: [{ content: bundle }],
    inputs,
  });
  return { pipe_code: PIPE_CODE, mthds_contents: [bundle], inputs: prepared.inputs };
}

/** BLOCKING path: summarize an uploaded PDF synchronously (`POST /v1/execute`). */
export async function runSummarizePdfBlocking(
  data: Record<string, unknown>,
): Promise<BlockingOutcome<DocumentSummary>> {
  const gated = gatePdfInputs(data);
  if (!gated.ok) return gated;
  return executeBlockingRun(() => buildOptions(gated.inputs), parseDocumentSummary);
}

/** DURABLE path — start the summarize run and return its id to poll. */
export async function startSummarizePdfRun(data: Record<string, unknown>): Promise<StartOutcome> {
  const gated = gatePdfInputs(data);
  if (!gated.ok) return gated;
  return startDurableRun(() => buildOptions(gated.inputs));
}

/** DURABLE path — poll one tick of a started summarize run by id. */
export async function pollSummarizePdfRun(runId: string): Promise<PollOutcome<DocumentSummary>> {
  return pollDurableRun(runId, parseDocumentSummary);
}
