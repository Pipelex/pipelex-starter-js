"use server";

import { getPipelexClient } from "@/lib/pipelexClient";
import { loadSummarizePdfBundle } from "@/lib/loadBundle";
import {
  MAX_PDF_BYTES,
  buildDocumentInput,
  fileInputErrorToPipelineError,
  validateDataUrl,
} from "@/lib/fileEncoding";
import { parseDocumentSummary, type DocumentSummary } from "@/types/summarizePipeline";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";

export type RunSummarizePdfPipelineResult =
  | { ok: true; summary: DocumentSummary }
  | { ok: false; error: PipelineError };

/**
 * Server Action: summarize an uploaded PDF.
 *
 * The PDF arrives as a base64 data URL — encoded client-side by
 * `fileToDataUrl`, because Server Actions only accept serializable
 * arguments (a `File` would not survive the boundary). File-size and
 * MIME problems are caught here as authoritative pre-flight validation and
 * returned inline; they never reach `classifyPipelineError`, which only
 * handles thrown SDK errors.
 */
export async function runSummarizePdfPipeline(input: {
  dataUrl: string;
  filename: string;
}): Promise<RunSummarizePdfPipelineResult> {
  const { dataUrl, filename } = input;

  if (!dataUrl) {
    return {
      ok: false,
      error: {
        kind: "bad_request",
        title: "PDF required",
        message: "Choose a PDF file (or use the sample) to summarize.",
        details: "Empty file input",
      },
    };
  }

  const fileError = validateDataUrl(dataUrl, {
    allowedMimes: ["application/pdf"],
    maxBytes: MAX_PDF_BYTES,
  });
  if (fileError) {
    return { ok: false, error: fileInputErrorToPipelineError(fileError, filename) };
  }

  try {
    const bundle = await loadSummarizePdfBundle();
    const client = getPipelexClient();
    const response = await client.executePipeline({
      pipe_code: "summarize_pdf",
      mthds_contents: [bundle],
      inputs: { document: buildDocumentInput(dataUrl, filename || "document.pdf") },
    });
    const summary = parseDocumentSummary(response.pipe_output);
    return { ok: true, summary };
  } catch (err) {
    return {
      ok: false,
      error: classifyPipelineError(err, {
        apiUrl: process.env.PIPELEX_API_URL,
        hasApiKey: Boolean(process.env.PIPELEX_API_KEY),
      }),
    };
  }
}
