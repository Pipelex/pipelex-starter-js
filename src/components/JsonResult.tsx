/**
 * The honest result view for an output whose shape nobody designed a component
 * for: the typed value, rendered as formatted JSON, plus an `<img>` for any
 * image the value carries.
 *
 * `make add-method` writes this into every scaffolded form, because a result
 * component is a design decision about a specific shape and the scaffold has no
 * design — it would have to invent headings for fields it has never seen. The
 * closing message names the `<JsonResult>` line as the one to replace, and the
 * four hand-written examples (`EntityResult`, `PdfSummaryResult`, …) are what
 * replacing it looks like.
 *
 * The value is already typed by then: the scaffolded narrower parses it through
 * the method's own generated binder. This renders it; it validates nothing.
 */

/** Image media types a `data:` URL may carry here — the formats a run returns. */
const IMAGE_DATA_URL_PREFIXES = ["data:image/png", "data:image/jpeg", "data:image/webp"];

/**
 * Is this a URL a browser can drop straight into an `<img>`?
 *
 * `https:` only — no cleartext `http:`, which a page served over HTTPS would
 * refuse as mixed content anyway — and a `data:` URL restricted to the raster
 * formats a run produces. The restriction matters even though an `<img>` keeps
 * an SVG's scripts inert: it is what keeps this affordance from rendering a
 * broken image for a payload that was never a picture. `pipelex-storage://` is
 * deliberately not renderable, which is the case this predicate exists to catch
 * — the runtime returns one beside the signed `public_url`.
 */
export function isWebRenderableImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return (
    value.startsWith("https://") ||
    IMAGE_DATA_URL_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
}

/** A JSON object — not an array, not null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every renderable image URL in the value, in order.
 *
 * Looks one level down and no further: the value itself, or — for a plural
 * output, which the narrower hands over as an array — each item. Deeper than
 * that a `url` key is somebody else's data, and guessing which one is the
 * picture is the design decision this component is defined not to make.
 *
 * `public_url ?? url` is the same preference `parseGeneratedImage` applies:
 * the runtime returns the storage URI as `url` and the signed web URL as
 * `public_url`, so the second is the one to show when it is there.
 */
export function imageUrlsOf(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .filter(isPlainObject)
    .map((candidate) => candidate.public_url ?? candidate.url)
    .filter(isWebRenderableImageUrl);
}

interface JsonResultProps {
  value: unknown;
  /** The section's accessible name. Defaults to the neutral "Run output". */
  label?: string;
}

export function JsonResult({ value, label = "Run output" }: JsonResultProps) {
  const images = imageUrlsOf(value);

  return (
    <section
      aria-label={label}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      {images.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {images.map((src) => (
            // `<img>` rather than `next/image`: the URL is a signed storage URL
            // or a `data:` URL, and neither can be optimized without a remote
            // pattern configured per deployment.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={`${label} image`}
              className="max-w-full rounded-lg border border-slate-200"
            />
          ))}
        </div>
      )}
      {/* Wide output scrolls inside its own box rather than stretching the page. */}
      <pre className="overflow-x-auto rounded bg-slate-50 p-4 text-xs leading-relaxed text-slate-800">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
