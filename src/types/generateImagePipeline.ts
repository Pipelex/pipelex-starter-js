import type { RunResults } from "@pipelex/sdk";
import { parseImage } from "@/generated/generate-image/binder";
import { ImageSchema, type Image } from "@/generated/generate-image/types";
import { describeSchemaFailure, wireOutput } from "@/lib/wireOutput";
import { BadImageOutputError } from "@/types/pipelineError";

/**
 * The generated `Image` concept, under the name the app already uses. Aliased
 * rather than re-exported as `Image` because that name is a DOM global in a
 * `.tsx` file. Optional fields are `| undefined` (zod's `.optional()`), not
 * `| null` — `??` at the render sites covers both.
 */
export type GeneratedImage = Image;

/**
 * URL schemes a browser can render directly in an `<img>` element. `data:`
 * additionally has its media type checked — see `isImageDataUrl`.
 */
const WEB_RENDERABLE_SCHEMES = ["http:", "https:", "data:"];

/** The parsed URL, or null if `value` isn't one. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Media types a `data:` image output may carry: the image formats a Pipelex run
 * actually returns. An allow-list rather than an `image/` prefix test, matching
 * how `validateDataUrl` gates the file *inputs* in `src/lib/fileEncoding.ts` —
 * a gate that decides what is safe to hand a user as a file should fail closed.
 */
const ACCEPTED_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Media types that render as an image but execute script when opened as a document. */
const ACTIVE_IMAGE_MEDIA_TYPES = ["image/svg+xml", "image/svg"];

/**
 * The media type of a `data:` URL, lowercased.
 *
 * Read off the parsed URL rather than the raw string: for a `data:` URL the
 * whole payload is the `pathname`, so the media type is everything before the
 * first `;` or `,` there, already free of any whitespace the parser trimmed.
 */
function dataUrlMediaType(url: URL): string {
  return url.pathname.split(/[;,]/, 1)[0].toLowerCase();
}

/**
 * Narrow a run's output into the generated `Image` shape, then apply the one
 * rule the concept itself does not declare: the URL we are about to render has
 * to be one a browser can load.
 *
 * Throws `BadImageOutputError` — distinct from `BadPipelineOutputError` so the
 * error UI can speak to image generation specifically — both when the payload
 * fails the schema and when it carries a URL `<ImageResult>` should not be handed:
 * a non-web scheme (`file://`, `pipelex-storage://`, …), which it would otherwise
 * drop straight into an `<img>` and produce a silently-broken image, or a `data:`
 * URL whose media type is not one of the image formats a run returns. On the
 * hosted durable path the runtime returns both a non-web `url`
 * (`pipelex-storage://…`) and a web `public_url` (a signed S3 URL); we validate
 * the one that will actually render — `public_url ?? url` — so a usable `url`
 * can't save a broken `public_url` and vice-versa.
 *
 * The `data:` rule guards the download link rather than the `<img>`, which is why
 * an *image* type can be refused: `<ImageResult>` renders the same validated
 * string in an `<a href={src} download>`, so a payload the browser saves as a
 * file — a `data:text/html`, or an SVG carrying a `<script>` — runs with the
 * privileges of a `file://` origin once opened, where an `<img>` would either
 * have failed to decode it or kept its scripts inert. Unlikely to arrive from an
 * image pipeline, which is the point: an unlikely value that reaches a dangerous
 * sink is exactly what a boundary check is for. It reaches only `data:` URLs —
 * a remote `https://…/x.svg` is equally active when opened, and no predicate
 * here can see the content type a server will send for it.
 */
export function parseGeneratedImage(results: RunResults): GeneratedImage {
  let image: Image;
  try {
    image = parseImage(wireOutput(results, ImageSchema));
  } catch (err) {
    throw new BadImageOutputError(describeSchemaFailure(err, "Image"));
  }

  // `||`, not `??`: `public_url` is `.optional()`, so the schema accepts `""` —
  // and an empty string is not nullish, so `??` would let it win over a perfectly
  // good `url` and fail the run on a scheme-less URL. The narrower this replaced
  // ran optional strings through a helper that mapped `""` to null; this is that
  // guard, kept where it still matters.
  const displayUrl = image.public_url || image.url;
  const parsed = parseUrl(displayUrl);
  if (parsed === null) {
    throw new BadImageOutputError(
      `The pipeline returned an image at "${displayUrl}", but a browser cannot load a ` +
        `scheme-less URL.`,
      { nonWebUrl: displayUrl },
    );
  }

  const scheme = parsed.protocol.toLowerCase();
  if (!WEB_RENDERABLE_SCHEMES.includes(scheme)) {
    throw new BadImageOutputError(
      `The pipeline returned an image at "${displayUrl}", but a browser cannot load a ${scheme} URL.`,
      { nonWebUrl: displayUrl },
    );
  }
  if (scheme === "data:") {
    const mediaType = dataUrlMediaType(parsed);
    if (ACTIVE_IMAGE_MEDIA_TYPES.includes(mediaType)) {
      throw new BadImageOutputError(
        `The pipeline returned an SVG as a data: URL. An SVG renders in an <img>, but it can ` +
          `carry a script that runs once the download link's file is opened, so it is refused ` +
          `here rather than offered for download.`,
        { nonWebUrl: displayUrl },
      );
    }
    if (!ACCEPTED_IMAGE_MEDIA_TYPES.includes(mediaType)) {
      throw new BadImageOutputError(
        `The pipeline returned a data: URL carrying "${mediaType || "no media type"}". Expected ` +
          `one of: ${ACCEPTED_IMAGE_MEDIA_TYPES.join(", ")} — anything else either will not ` +
          `render or would be saved by the download link as an arbitrary file.`,
        { nonWebUrl: displayUrl },
      );
    }
  }

  return image;
}
