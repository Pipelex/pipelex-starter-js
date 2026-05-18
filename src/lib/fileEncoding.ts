import type { PipelineError } from "@/lib/errors";

/**
 * Helpers for turning a base64 data URL (produced client-side by
 * `fileToDataUrl`) into a Pipelex file input — plus the validation that
 * gates it. Pure: no React, no `process.env`, safe to import from either
 * side of the server boundary.
 */

/** Largest PDF the PDF example will send, measured in decoded bytes. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** A rejected file: either too large, or not an accepted type. */
export type FileInputError = {
  kind: "file_too_large" | "unsupported_file_type";
  message: string;
};

const BASE64_DATA_URL_RE = /^data:([^;,]+);base64,/;

/** MIME type of a base64 data URL, or null if the string isn't one. */
export function dataUrlMimeType(dataUrl: string): string | null {
  return BASE64_DATA_URL_RE.exec(dataUrl)?.[1] ?? null;
}

/**
 * Decoded byte length of a base64 data URL, computed from string length
 * (4 base64 chars → 3 bytes, minus padding) so we never allocate a buffer.
 */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  if (b64.length === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Human-readable megabytes, e.g. `8` or `11.4`. */
function mb(bytes: number): string {
  const value = bytes / 1024 / 1024;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Validate a base64 data URL against an allowed MIME list and a size cap.
 * Returns a `FileInputError` describing the problem, or null when valid.
 *
 * The Server Action calls this as an authoritative pre-flight check — the
 * client's own check is only for fast UX feedback and is trivially bypassed.
 */
export function validateDataUrl(
  dataUrl: string,
  opts: { allowedMimes: string[]; maxBytes: number },
): FileInputError | null {
  const mime = dataUrlMimeType(dataUrl);
  if (!mime) {
    return {
      kind: "unsupported_file_type",
      message: "Expected a base64-encoded data URL.",
    };
  }
  if (!opts.allowedMimes.includes(mime)) {
    return {
      kind: "unsupported_file_type",
      message: `Unsupported file type "${mime}". Expected: ${opts.allowedMimes.join(", ")}.`,
    };
  }
  const bytes = dataUrlByteLength(dataUrl);
  if (bytes > opts.maxBytes) {
    return {
      kind: "file_too_large",
      message: `File is ${mb(bytes)} MB; the limit is ${mb(opts.maxBytes)} MB.`,
    };
  }
  return null;
}

/** Render a `FileInputError` as a `PipelineError` for `<ErrorDisplay>`. */
export function fileInputErrorToPipelineError(
  fileError: FileInputError,
  filename: string,
): PipelineError {
  return {
    kind: fileError.kind,
    title: fileError.kind === "file_too_large" ? "PDF too large" : "Unsupported file type",
    message: fileError.message,
    details: `${fileError.kind}: ${filename || "(no filename)"}`,
  };
}

/** A Pipelex `Document` input envelope, as accepted by `executePipeline`. */
export type DocumentInput = {
  concept: "Document";
  content: { url: string; filename: string; mime_type: string };
};

/**
 * Build the `Document` input envelope for `executePipeline`. The Pipelex API
 * decodes the base64 data URL server-side and uploads it to storage, so the
 * app never has to host the file itself.
 */
export function buildDocumentInput(dataUrl: string, filename: string): DocumentInput {
  return {
    concept: "Document",
    content: {
      url: dataUrl,
      filename,
      mime_type: dataUrlMimeType(dataUrl) ?? "application/octet-stream",
    },
  };
}
