import type { RunResults } from "@pipelex/sdk";
import { parseImage } from "@/generated/generate-image/binder";
import type { Image } from "@/generated/generate-image/types";
import { describeSchemaFailure, wireOutput } from "@/lib/wireOutput";
import { BadImageOutputError } from "@/types/pipelineError";

/**
 * The generated `Image` concept, under the name the app already uses. Aliased
 * rather than re-exported as `Image` because that name is a DOM global in a
 * `.tsx` file. Optional fields are `| undefined` (zod's `.optional()`), not
 * `| null` — `??` at the render sites covers both.
 */
export type GeneratedImage = Image;

/** URL schemes a browser can render directly in an `<img>` element. */
const WEB_RENDERABLE_SCHEMES = ["http:", "https:", "data:"];

/** Lowercased URL scheme (e.g. `"https:"`), or null if `value` isn't a URL. */
function urlScheme(value: string): string | null {
  try {
    return new URL(value).protocol.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Narrow a run's output into the generated `Image` shape, then apply the one
 * rule the concept itself does not declare: the URL we are about to render has
 * to be one a browser can load.
 *
 * Throws `BadImageOutputError` — distinct from `BadPipelineOutputError` so the
 * error UI can speak to image generation specifically — both when the payload
 * fails the schema and when it carries a URL with a non-web scheme (`file://`,
 * `pipelex-storage://`, …), which `<ImageResult>` would otherwise drop straight
 * into an `<img>` and produce a silently-broken image. On the hosted durable
 * path the runtime returns both a non-web `url` (`pipelex-storage://…`) and a
 * web `public_url` (a signed S3 URL); we validate the one that will actually
 * render — `public_url ?? url` — so a usable `url` can't save a broken
 * `public_url` and vice-versa.
 */
export function parseGeneratedImage(results: RunResults): GeneratedImage {
  let image: Image;
  try {
    image = parseImage(wireOutput(results));
  } catch (err) {
    throw new BadImageOutputError(describeSchemaFailure(err, "Image"));
  }

  const displayUrl = image.public_url ?? image.url;
  const scheme = urlScheme(displayUrl);
  if (scheme === null || !WEB_RENDERABLE_SCHEMES.includes(scheme)) {
    throw new BadImageOutputError(
      `The pipeline returned an image at "${displayUrl}", but a browser cannot load a ${
        scheme ?? "scheme-less"
      } URL.`,
      { nonWebUrl: displayUrl },
    );
  }

  return image;
}
