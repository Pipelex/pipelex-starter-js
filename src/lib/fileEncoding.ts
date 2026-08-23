import type { PipelineError } from "@/lib/errors";

/**
 * Authoritative pre-flight for a base64 data URL (produced client-side by
 * `fileToDataUrl`): MIME + size validation that gates the file *before* it is
 * uploaded. Building the actual run input is the SDK's job now — the Server
 * Action hands the validated data URL to `client.prepareInputs`, which uploads
 * it to Pipelex storage and rewrites the input to a `pipelex-storage://` URI.
 * This gate still matters: the data URL crosses the Server Action boundary, so
 * its size must stay under `next.config.js`'s `bodySizeLimit`. Pure: no React,
 * no `process.env`, safe to import from either side of the server boundary.
 */

/** Largest PDF the PDF example will send, measured in decoded bytes. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** A rejected file: either too large, or not an accepted type. */
export type FileInputError = {
  kind: "file_too_large" | "unsupported_file_type";
  message: string;
};

const BASE64_DATA_URL_RE = /^data:([^;,]+);base64,/;
const BASE64_ALPHABET_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Whether a base64 payload is well-formed — the alphabet, the length, and the
 * padding, in one linear pass.
 *
 * Written the obvious way this is a *group* repetition,
 * `/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/`, and V8
 * walks a repeated group with a recursive backtracking stack. Past roughly
 * 4.47 M payload characters — about 3.2 MB decoded — it does not return `false`,
 * it throws `RangeError: Maximum call stack size exceeded`. That crashed the
 * Server Action with an opaque transport digest for every PDF in the 3.2–8 MB
 * band, i.e. inside the `MAX_PDF_BYTES` this module advertises, and made the
 * `file_too_large` branch below unreachable: anything big enough to trip it blew
 * the stack first. The flat alternation carries no repeated group, so it is
 * linear (a 6 MB payload matches in a few milliseconds), and the explicit
 * length check restores the `% 4` rule the group repetition used to imply.
 */
function isBase64Payload(payload: string): boolean {
  return payload.length % 4 === 0 && BASE64_ALPHABET_RE.test(payload);
}

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
  // Size before shape: it is the cheaper rejection (a length arithmetic, no scan
  // of the payload) and the more likely one, and it keeps the limit this module
  // advertises the operative one rather than something a malformed-payload check
  // might pre-empt.
  const bytes = dataUrlByteLength(dataUrl);
  if (bytes > opts.maxBytes) {
    return {
      kind: "file_too_large",
      message: `File is ${mb(bytes)} MB; the limit is ${mb(opts.maxBytes)} MB.`,
    };
  }
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!isBase64Payload(payload)) {
    return {
      kind: "unsupported_file_type",
      message: "Expected a valid base64-encoded data URL.",
    };
  }
  return null;
}

/**
 * References a file input may carry. A **closed** set, and that is the point.
 *
 * `prepareInputs` resolves any string it does not recognise as a **local
 * filesystem path**, reads it and uploads it (`@pipelex/sdk`'s
 * `prepare-inputs.js` → `readLocalPath`). A Server Action is a public endpoint,
 * so an unconstrained `url` is an arbitrary server-side file read whose contents
 * come back rendered to the caller. `http://` is left out deliberately: nothing
 * in this template needs a cleartext fetch, and the narrower set is the safer
 * default for code adopters copy.
 */
const ALLOWED_FILE_SCHEMES = ["data:", "https://", "pipelex-storage://"];

/**
 * The scheme, MIME and size gate for every file-bearing input in a gated
 * payload. The kernel gate proves the *shape*; this proves what the contract
 * cannot express — "a reference we accept, and if it carries bytes, few enough
 * of the right kind".
 *
 * Two properties worth keeping when adapting this:
 *
 * 1. **Scheme first, and refuse by default.** Treating "not a data URL" as
 *    "nothing to check" is how the local-file read above opens — the absence of
 *    bytes to inspect is not the absence of something to verify.
 * 2. **Keyed on the values, not on an input's name.** Hard-coding `inputs.document`
 *    makes this whole gate return "fine" the day the bundle renames that input,
 *    while codegen carries the rename into the form, the readiness rules and the
 *    wire envelope. It fails open, silently, on a routine edit.
 *
 * This is the authoritative check. The browser's own size check is an early exit
 * that saves an encode, not a gate — it is trivially bypassed.
 */
export function checkFileInputs(
  inputs: Record<string, unknown>,
  opts: { allowedMimes: string[]; maxBytes: number },
): PipelineError | null {
  for (const [name, envelope] of Object.entries(inputs)) {
    const content = (envelope as { content?: { url?: unknown; filename?: unknown } })?.content;
    if (typeof content?.url !== "string") continue;
    const url = content.url;

    if (!ALLOWED_FILE_SCHEMES.some((scheme) => url.startsWith(scheme))) {
      return {
        kind: "bad_request",
        title: "Unsupported file reference",
        message:
          `The "${name}" input must be an uploaded file, an https:// URL, or a ` +
          `pipelex-storage:// reference.`,
        details: `unsupported_scheme: ${name}`,
      };
    }
    if (!url.startsWith("data:")) continue; // A reference, not bytes — `prepareInputs` resolves it.

    const fileError = validateDataUrl(url, opts);
    if (fileError) {
      return fileInputErrorToPipelineError(
        fileError,
        typeof content.filename === "string" ? content.filename : "document",
      );
    }
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
