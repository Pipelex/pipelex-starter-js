import type { PipelineError } from "@/lib/errors";
// Type-only, so nothing of the SDK reaches the client bundle through this
// module. The descriptor types are the MTHDS standard's (`mthds/protocol`),
// re-exported by the SDK whose `prepareInputs` walks the same nodes.
import type { InputFormItem, PipeInputFormDescriptor } from "@pipelex/sdk";

/**
 * The authoritative pre-flight for the file-bearing inputs of a run.
 * `checkFileInputs` is the entry point: it walks the method's wire input-form
 * descriptor to find every file position — top-level, inside a list, nested in
 * a structured concept — validates the *reference* each one carries against a
 * closed set of schemes, and then — only for a `data:` URL, the one form that
 * arrives as bytes — its MIME type and its size.
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

/** Strict plain-object test — the SDK's own, so the two walks agree on what an object is. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * The kernel's explicit `{ concept, content }` envelope — exact keys, not a
 * superset, which is the SDK's test (`isExplicitEnvelope`) and the runtime's
 * (`input_shaper.py`'s `_is_explicit`). A structured input that merely happens
 * to carry both fields is not an envelope.
 */
function isExplicitEnvelope(value: unknown): value is { concept: unknown; content: unknown } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && "concept" in value && "content" in value;
}

/** One file position the descriptor declares, with the source the value put there. */
interface FilePosition {
  /** Dotted, list indices included: `document`, `cvs.1`, `packet.scan`. */
  path: string;
  /** What `prepareInputs` would resolve: `value.url` for `{url}` content, else the value. */
  source: unknown;
  /** The filename the value states, for the error that names the file. */
  filename?: string;
}

/**
 * The file positions under one descriptor node, found by walking the
 * DESCRIPTOR — never the value. This is `prepareInputs`'s `resolveNode`, read
 * rather than resolved: `document` / `image` is a file position whatever the
 * value's shape, `object` descends the fields it declares (a key the descriptor
 * does not name is copied through untouched by the SDK, so it is not a file
 * position here either), `list` descends `item` against each element, and
 * every other kind passes through at any depth — `unknown` included, which the
 * SDK deliberately does not interpret. A value whose shape disagrees with the
 * node (a scalar at an `object`, a non-array at a `list`) is left to the shape
 * gate and the run.
 *
 * At a file position the source is read the way `resolveFilePosition` reads
 * it: canonical `{url}` content yields its `url`, anything else IS the source.
 */
function collectFilePositions(
  node: InputFormItem,
  value: unknown,
  path: string,
  out: FilePosition[],
): void {
  switch (node.kind) {
    case "document":
    case "image": {
      if (isPlainObject(value) && "url" in value) {
        const filename = value["filename"];
        out.push({
          path,
          source: value["url"],
          filename: typeof filename === "string" ? filename : undefined,
        });
      } else {
        out.push({ path, source: value });
      }
      return;
    }
    case "object": {
      if (!isPlainObject(value)) return;
      for (const child of node.fields) {
        if (Object.hasOwn(value, child.name)) {
          collectFilePositions(child, value[child.name], `${path}.${child.name}`, out);
        }
      }
      return;
    }
    case "list": {
      if (!Array.isArray(value)) return;
      value.forEach((entry, index) => {
        collectFilePositions(node.item, entry, `${path}.${index}`, out);
      });
      return;
    }
    default:
      return;
  }
}

/**
 * The scheme, MIME and size gate for the file-bearing inputs in a gated payload.
 * The kernel gate proves the *shape*; this proves what the contract cannot
 * express — "a reference we accept, and if it carries bytes, few enough of the
 * right kind".
 *
 * **The descriptor is the classifier, never the value's shape.** The SDK's
 * `prepareInputs` finds the positions it will resolve by walking the method's
 * wire input-form descriptor — `document` / `image` at any depth, through
 * `object` fields and `list` items — and this gate walks the same descriptor,
 * so the set of positions it verifies is exactly the set the SDK goes on to
 * read. That is what lets a method take `cvs: list[Document]`, or a file inside
 * a structured concept, without a value heuristic on either side: a `text`
 * field merely *named* `url` is not a file, and a `Document` two levels down
 * is. The earlier shape of this gate read `content.url` one level down and
 * refused anything deeper, because a value walk cannot tell a document string
 * from a text one; the descriptor can.
 *
 * Three properties worth keeping when adapting this:
 *
 * 1. **Scheme first, and refuse by default.** Treating "not a data URL" as
 *    "nothing to check" is how the local-file read above opens — the absence of
 *    bytes to inspect is not the absence of something to verify.
 * 2. **Keyed on the descriptor, not on an input's name.** Hard-coding
 *    `inputs.document` makes this whole gate return "fine" the day the bundle
 *    renames that input, while codegen carries the rename into the form, the
 *    readiness rules and the wire envelope. The descriptor is regenerated with
 *    them, so a rename moves the gate too.
 * 3. **A file position holds a string, or it is refused.** `prepareInputs`
 *    accepts a *bare source string* at a file position as readily as `{url}`
 *    and resolves the two identically, so both are read here. Anything else
 *    that is present — bytes smuggled past the size cap, an object with no
 *    `url` — is refused rather than skipped: the verdict rests on this walk,
 *    never on the schema gate in front of it happening to refuse the same
 *    thing. `null` and `undefined` are the one exception, because they are how
 *    an optional file position is left empty, and nothing reads a file for them.
 *
 * This is the authoritative check. The browser's own size check is an early exit
 * that saves an encode, not a gate — it is trivially bypassed.
 */
export function checkFileInputs(
  descriptor: PipeInputFormDescriptor,
  inputs: Record<string, unknown>,
  opts: { allowedMimes: string[]; maxBytes: number },
): PipelineError | null {
  const positions: FilePosition[] = [];
  for (const field of descriptor.fields) {
    if (!Object.hasOwn(inputs, field.name)) continue;
    const value = inputs[field.name];
    // The kernel gate hands over `{ concept, content }` envelopes; the SDK reads
    // the inner content against the same node, and so does this.
    const content = isExplicitEnvelope(value) ? value.content : value;
    collectFilePositions(field, content, field.name, positions);
  }

  for (const { path, source, filename } of positions) {
    if (source === undefined || source === null) continue; // An empty optional position.
    if (typeof source !== "string" || !ALLOWED_FILE_SCHEMES.some((s) => source.startsWith(s))) {
      return {
        kind: "bad_request",
        title: "Unsupported file reference",
        message:
          `The "${path}" input must be an uploaded file, an https:// URL, or a ` +
          `pipelex-storage:// reference.`,
        details: `unsupported_scheme: ${path}`,
      };
    }
    if (!source.startsWith("data:")) continue; // A reference, not bytes — `prepareInputs` resolves it.

    const fileError = validateDataUrl(source, opts);
    if (fileError) return fileInputErrorToPipelineError(fileError, filename ?? path);
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
