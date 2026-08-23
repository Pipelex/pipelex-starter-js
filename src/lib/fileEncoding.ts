import type { PipelineError } from "@/lib/errors";

/**
 * The authoritative pre-flight for the file-bearing inputs of a run.
 * `checkFileInputs` is the entry point: it validates the *reference* each file
 * input carries against a closed set of schemes, and then — only for a `data:`
 * URL, the one form that arrives as bytes — its MIME type and its size.
 *
 * The scheme half is the security-relevant one, because the SDK's
 * `prepareInputs` resolves an unrecognised string as a **local filesystem
 * path**; see {@link ALLOWED_FILE_SCHEMES}. The size half matters for a
 * different reason: a `data:` URL crosses the Server Action boundary whole, so
 * it must stay under `next.config.js`'s `bodySizeLimit`.
 *
 * Building the run input is the SDK's job — the Server Action hands the gated
 * inputs to `client.prepareInputs`, which uploads any bytes to Pipelex storage
 * and rewrites them to a `pipelex-storage://` URI. Pure: no React, no
 * `process.env`, safe to import from either side of the server boundary.
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
 * The "too large" rejection, built here so the browser's early exit and this
 * module's own gate cannot word the same refusal two different ways.
 *
 * The early exit in `PdfForm` is not a second rule — it reads `MAX_PDF_BYTES`
 * from here and only saves an encode. Letting it phrase its own message would
 * have re-introduced by the back door exactly the duplication that sharing the
 * constant removes.
 */
export function fileTooLargeError(bytes: number, maxBytes: number): FileInputError {
  return {
    kind: "file_too_large",
    message: `File is ${mb(bytes)} MB; the limit is ${mb(maxBytes)} MB.`,
  };
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
    return fileTooLargeError(bytes, opts.maxBytes);
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
 *
 * What the two remaining schemes mean, since neither is bytes this app produced:
 *
 * - `https://` is the kernel's "paste a URL instead" affordance. Accepting it
 *   means the **runner** fetches that URL server-side, which is the feature —
 *   and it is also why a host that must not reach arbitrary origins wants an
 *   allow-list here rather than a scheme test. Left open in the template
 *   because a plausible allow-list for a starter does not exist.
 * - `pipelex-storage://` is a file already in this app's own storage scope,
 *   which `prepareInputs` passes through untouched. It is accepted so a
 *   reference obtained from an earlier run round-trips without a re-upload.
 *   The URIs are server-generated opaque ids, so this is not guessable — but
 *   it is a deliberate widening, not an oversight.
 */
const ALLOWED_FILE_SCHEMES = ["data:", "https://", "pipelex-storage://"];

/** How deep `carriesUrl` will look before giving up and refusing. */
const MAX_INPUT_DEPTH = 8;

/**
 * Whether `value` is, or contains, an object carrying a `url` key — i.e. a file
 * position. Descends arrays and plain objects only, and treats hitting the depth
 * cap as "yes", so a deeply nested or self-referential payload refuses rather
 * than passing (and the walk cannot run away on a cycle).
 */
function carriesUrl(value: unknown, depth = 0): boolean {
  if (depth >= MAX_INPUT_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => carriesUrl(item, depth + 1));
  if (typeof value !== "object" || value === null) return false;
  if ("url" in value) return true;
  return Object.values(value).some((child) => carriesUrl(child, depth + 1));
}

/**
 * Whether `content` hides a file position besides the one {@link checkFileInputs}
 * goes on to read and validate — its own `url`, *when that is a string*.
 *
 * Two things make the exclusion narrow, and both were bypasses before they were
 * rules. It is asked unconditionally, never only when `url` is missing: `url` is
 * a key the caller supplies, so a check that runs only in its absence is
 * switched off by pasting a perfectly good `https://` URL beside a nested one.
 * And the exclusion is keyed on the value's *type*, not on the key's name: a
 * non-string under `url` is a subtree this gate never inspects, so waving it
 * through on the strength of its name skips exactly what the walk exists to
 * catch. Excluded is only ever what the scheme check below actually reads.
 */
function hidesFilePosition(content: unknown): boolean {
  if (Array.isArray(content)) return carriesUrl(content, 1);
  if (typeof content !== "object" || content === null) return false;
  return Object.entries(content).some(
    ([key, child]) => !(key === "url" && typeof child === "string") && carriesUrl(child, 1),
  );
}

/**
 * The scheme, MIME and size gate for the file-bearing inputs in a gated payload.
 * The kernel gate proves the *shape*; this proves what the contract cannot
 * express — "a reference we accept, and if it carries bytes, few enough of the
 * right kind".
 *
 * Three properties worth keeping when adapting this:
 *
 * 1. **Scheme first, and refuse by default.** Treating "not a data URL" as
 *    "nothing to check" is how the local-file read above opens — the absence of
 *    bytes to inspect is not the absence of something to verify.
 * 2. **Keyed on the values, not on an input's name.** Hard-coding `inputs.document`
 *    makes this whole gate return "fine" the day the bundle renames that input,
 *    while codegen carries the rename into the form, the readiness rules and the
 *    wire envelope. It fails open, silently, on a routine edit.
 * 3. **It reads one level — `content.url`, or a bare `content` string, which
 *    the SDK treats the same way — and refuses any shape that hides a file
 *    position deeper.** `prepareInputs` walks the method's signature, so it
 *    resolves a file inside a list (`documents: list[Document]`) or nested in a
 *    structured concept, both of which `content.url` misses entirely. Property 2
 *    is worth nothing if pluralising an input reopens the hole instead — so an
 *    unreachable `url` is a refusal here, not a pass. The refusal is asked
 *    *unconditionally*, not merely when `content.url` is absent: guarding it
 *    behind a missing `url` lets the caller switch it off with a benign outer
 *    `url` beside the nested one, which is the bypass shape
 *    {@link hidesFilePosition} exists to close. Widening the walk to descend the
 *    contract's `json_schema` in lockstep (the way `wireOutput`'s
 *    `dropWireNulls` descends a zod schema, and for the same reason: a blind
 *    value walk cannot tell a file position from a data field named `url`) is
 *    the real fix, and is worth doing the day a method needs one of those shapes.
 *
 * This is the authoritative check. The browser's own size check is an early exit
 * that saves an encode, not a gate — it is trivially bypassed.
 */
export function checkFileInputs(
  inputs: Record<string, unknown>,
  opts: { allowedMimes: string[]; maxBytes: number },
): PipelineError | null {
  for (const [name, envelope] of Object.entries(inputs)) {
    const content = (envelope as { content?: unknown })?.content;

    if (hidesFilePosition(content)) {
      return {
        kind: "bad_request",
        title: "Unsupported input shape",
        message:
          `The "${name}" input carries a file reference this app cannot verify — ` +
          `a repeated or nested file position. Refused rather than passed through.`,
        details: `unverifiable_file_position: ${name}`,
      };
    }
    // `prepareInputs` accepts a *bare source string* at a file position as
    // readily as `{url}`, and resolves the two identically — so reading only
    // the object form would leave this gate's verdict resting on the schema in
    // front of it (ajv refuses a string where `native.Document` declares an
    // object) rather than on its own walk. That is the coupling property 2
    // disclaims, and no committed method reaches the compact form today, which
    // is exactly why it must not be the thing keeping this correct.
    const file: { url?: unknown; filename?: unknown } =
      typeof content === "string" ? { url: content } : ((content ?? {}) as typeof file);
    if (typeof file.url !== "string") continue;
    const url = file.url;

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
        typeof file.filename === "string" ? file.filename : "document",
      );
    }
  }
  return null;
}

/**
 * Render a `FileInputError` as a `PipelineError` for `<ErrorDisplay>`. The title
 * says "File", not "PDF": `checkFileInputs` is generic over whatever a method
 * declares, and the message underneath already names the type and the limit.
 */
export function fileInputErrorToPipelineError(
  fileError: FileInputError,
  filename: string,
): PipelineError {
  return {
    kind: fileError.kind,
    title: fileError.kind === "file_too_large" ? "File too large" : "Unsupported file type",
    message: fileError.message,
    details: `${fileError.kind}: ${filename || "(no filename)"}`,
  };
}
