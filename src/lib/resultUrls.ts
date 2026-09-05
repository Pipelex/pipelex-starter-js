/**
 * The output side of `fileEncoding.ts`'s scheme gate: the URL policy the result
 * view applies before the form kernel is allowed to act on a run's file URLs.
 *
 * **Why this exists at all.** The kernel decides what to paint, link and frame
 * from its own `isViewableUrl`, which accepts `http:`, `https:`, **any** `data:`
 * media type, `blob:` and same-origin paths. Three of its sinks act on that
 * verdict: an `<img src>`, an `<a href target="_blank">`, and — for a value
 * whose declared `mime_type` or `filename` looks previewable — a
 * `DocumentPreview` `<iframe src>` carrying no `sandbox` attribute. So a payload
 * stating `url: "data:text/html,…"` with `filename: "report.pdf"` is offered a
 * preview and framed, and the frame executes. The kernel's own `HtmlPreview`
 * sandboxes, which is what says the omission is a gap rather than a posture.
 *
 * A run's output is model-shaped data crossing a trust boundary, exactly like a
 * run's input, and `checkFileInputs` is the rule on the way in. This is the same
 * rule on the way out, and it is deliberately the *only* place in this template
 * that re-reads a result: the shape is the generated binder's job, and this
 * proves the one thing a JSON Schema cannot state — "a reference a browser may
 * be handed".
 *
 * **It is a stopgap with an owner.** Every fix belongs in `@pipelex/mthds-form`:
 * sandbox the document preview, stop deciding previewability from the payload's
 * own `filename`/`mime_type`, and trim before scheme-testing. Delete this module
 * the day the kernel ships them — the walk below is the same walk
 * `collectFilePositions` does on the input side, so it is one deletion, not an
 * unpicking. It does **not** cover markdown a `native.Text` result carries: the
 * kernel typesets prose, and a `![](https://…)` in the model's own answer loads
 * on paint. That one has no host-side fix and is upstream's alone.
 *
 * Pure module — no React, no `process.env`, no Node built-ins — so the client
 * component that renders the result may call it directly.
 */
import type { RunField } from "@pipelex/mthds-form";

/**
 * What the form kernel would act on, restated here rather than imported because
 * the kernel does not export it: `isViewableUrl` in its `dist` core.
 *
 * The predicate matters as much as the allow-list. A string the kernel already
 * refuses — `pipelex-storage://`, `file:`, a bare filename — reaches no sink, so
 * blanking it would strip the JSON receipt of a reference that was never
 * dangerous. Only a string the kernel *would* use and this policy refuses is
 * removed, which keeps the payload as close to verbatim as safety allows.
 */
function kernelWouldRender(url: string): boolean {
  if (/^\/(?!\/)/.test(url)) return true;
  return /^https?:/i.test(url) || /^data:/i.test(url) || /^blob:/i.test(url);
}

/**
 * Media types a `data:` result URL may carry — the image formats a Pipelex run
 * returns, matching `ACCEPTED_IMAGE_MEDIA_TYPES` in
 * `src/types/generateImagePipeline.ts` and `ALLOWED_PDF_MIMES` on the input
 * side. An allow-list, not an `image/` prefix test: `image/svg+xml` renders as a
 * picture and executes as a document, which is the whole reason the input gate
 * is written this way too.
 */
const ACCEPTED_DATA_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * May a browser be handed this URL by the result view?
 *
 * `https:` only — no cleartext `http:`, which a page served over HTTPS refuses
 * as mixed content anyway — and a `data:` URL restricted to the raster formats
 * above. Parsed rather than prefix-matched, so the leading whitespace that
 * `new URL` strips and the kernel's own `/^https?:/` does not cannot be used to
 * make the two disagree about which URL is in play.
 */
export function isRenderableResultUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "data:") return false;
  // For a `data:` URL the whole payload is the pathname, so the media type is
  // everything before the first `;` or `,` — already free of whitespace the
  // parser trimmed. Same read as `dataUrlMediaType` in generateImagePipeline.ts.
  const media = parsed.pathname.split(/[;,]/, 1)[0]!.toLowerCase();
  return ACCEPTED_DATA_MEDIA_TYPES.includes(media);
}

/** Strict plain-object test — the same one both file walks use. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** The properties a file-bearing value carries a URL in, in the kernel's own order. */
const URL_PROPERTIES = ["public_url", "url"] as const;

/** What a scrub removed, so the view can say so rather than quietly differ. */
export interface ScrubbedResult {
  /** The value to render: the original unless something was refused. */
  value: unknown;
  /** Dotted paths whose URL was removed — `output`, `pages.2.scan`. Empty when nothing was. */
  refused: string[];
}

/** What one URL string should become: kept as-is, replaced, or dropped. */
type UrlVerdict = { keep: true } | { keep: false; replacement: string | undefined };

const KEEP: UrlVerdict = { keep: true };

/**
 * Judge one URL string.
 *
 * Three outcomes, and the middle one is the reason this returns a verdict rather
 * than a boolean. **The URL the policy judged has to be the URL the kernel
 * gets**, and leading whitespace is enough to break that: `new URL` strips it,
 * the kernel's `/^https?:/` does not. So a payload carrying `" https://…"`
 * satisfies a `new URL`-based check and is then skipped by the kernel, which
 * silently falls back to the *other* property — one nothing validated. Trimming
 * an accepted URL removes the disagreement instead of documenting it.
 *
 * A string the kernel would never act on is returned verbatim: it reaches no
 * sink, so removing it would strip the JSON receipt for nothing. That is how a
 * `pipelex-storage://` reference survives beside a refused one.
 */
function judgeUrl(candidate: string): UrlVerdict {
  const trimmed = candidate.trim();
  if (isRenderableResultUrl(trimmed)) {
    return trimmed === candidate ? KEEP : { keep: false, replacement: trimmed };
  }
  if (kernelWouldRender(candidate) || kernelWouldRender(trimmed)) {
    return { keep: false, replacement: undefined };
  }
  return KEEP;
}

/**
 * Rewrite one file position, or hand it back untouched.
 *
 * A file position holds either the canonical `{url, public_url, …}` content or a
 * bare URL string, and the kernel's `paintableUrl` reads both — so both are
 * checked. A refused property is dropped rather than blanked: `undefined` is
 * what the kernel's `!url` test wants, and `JSON.stringify` omits the key, so
 * the JSON view shows the payload minus exactly what was refused rather than a
 * misleading empty string.
 */
function scrubFilePosition(value: unknown, path: string, refused: string[]): unknown {
  if (typeof value === "string") {
    const verdict = judgeUrl(value);
    if (verdict.keep) return value;
    if (verdict.replacement === undefined) refused.push(path);
    return verdict.replacement;
  }
  if (!isPlainObject(value)) return value;
  let next: Record<string, unknown> | null = null;
  for (const property of URL_PROPERTIES) {
    const candidate = value[property];
    if (typeof candidate !== "string") continue;
    const verdict = judgeUrl(candidate);
    if (verdict.keep) continue;
    next ??= { ...value };
    if (verdict.replacement === undefined) {
      delete next[property];
      refused.push(`${path}.${property}`);
    } else {
      next[property] = verdict.replacement;
    }
  }
  return next ?? value;
}

/**
 * Walk one descriptor node against the value beneath it.
 *
 * The DESCRIPTOR classifies, never the value's shape — the same rule
 * `collectFilePositions` states on the input side, and for the same reason: a
 * `text` field merely named `url` is not a file, and an `Image` two levels down
 * is. `document` / `image` is a file position whatever the value looks like,
 * `object` descends the fields it declares, `list` descends `item` against each
 * element, and every other kind passes through untouched at any depth. A value
 * whose shape disagrees with its node is left alone for the kernel to render as
 * it sees fit; this gate refuses URLs, it does not adjudicate shapes.
 *
 * `contentKey` is unwrapped and rebuilt the way the kernel's own `unwrap` reads
 * it — a non-array record carrying that property — so a `native.Image` arriving
 * inside its content model is walked, not skipped. The reported path does not
 * gain a segment for it: the wrapper is a wire detail the kernel hides from the
 * reader, and the note built from these paths is read by one.
 */
function scrubNode(field: RunField, value: unknown, path: string, refused: string[]): unknown {
  if (field.contentKey && isPlainObject(value) && field.contentKey in value) {
    const key = field.contentKey;
    const inner = scrubNode({ ...field, contentKey: undefined }, value[key], path, refused);
    return inner === value[key] ? value : { ...value, [key]: inner };
  }
  switch (field.kind) {
    case "document":
    case "image":
      return scrubFilePosition(value, path, refused);
    case "object": {
      if (!isPlainObject(value)) return value;
      let next: Record<string, unknown> | null = null;
      for (const child of field.fields) {
        if (!Object.hasOwn(value, child.name)) continue;
        const before = value[child.name];
        const after = scrubNode(child, before, `${path}.${child.name}`, refused);
        if (after === before) continue;
        next ??= { ...value };
        next[child.name] = after;
      }
      return next ?? value;
    }
    case "list": {
      if (!Array.isArray(value)) return value;
      let changed = false;
      const next = value.map((entry, index) => {
        const after = scrubNode(field.item, entry, `${path}.${index}`, refused);
        if (after !== entry) changed = true;
        return after;
      });
      return changed ? next : value;
    }
    default:
      return value;
  }
}

/**
 * Remove every URL the form kernel would act on and this template's policy
 * refuses, reporting the paths it removed.
 *
 * Returns the original value by identity when nothing was refused, which is the
 * overwhelmingly common case — a hosted run returns a signed `https:`
 * `public_url` beside its storage URI, and the storage URI is left verbatim
 * because the kernel never touches it.
 */
export function scrubResultUrls(field: RunField, value: unknown): ScrubbedResult {
  const refused: string[] = [];
  const scrubbed = scrubNode(field, value, field.name || "output", refused);
  return { value: scrubbed, refused };
}
