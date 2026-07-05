import type { RunResults } from "@pipelex/sdk";
import { findOutputContent } from "@/lib/runOutput";
import { BadImageOutputError } from "@/types/pipelineError";

export type GeneratedImage = {
  /** Image URL — a remote/storage URL or a base64 data URL; renders either way. */
  url: string;
  /** Public URL when the API exposes one; prefer it for display. */
  publicUrl: string | null;
  mimeType: string | null;
  caption: string | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

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
 * Narrow a run's output into our GeneratedImage shape. Takes `RunResults` and
 * reads the main output via `findOutputContent`. Throws `BadImageOutputError`
 * when no entry carries a usable image URL — distinct from
 * `BadPipelineOutputError` so the error UI can speak to image generation
 * specifically.
 *
 * Also rejects an image URL whose scheme a browser can't render (`file://`,
 * `pipelex-storage://`, …): `<ImageResult>` would otherwise drop it straight
 * into an `<img>` and produce a silently-broken image. On the hosted durable
 * path the runtime returns both a non-web `url` (`pipelex-storage://…`) and a
 * web `public_url` (a signed S3 URL); we validate the one that will actually
 * render — `publicUrl ?? url` — so a usable `url` can't save a broken
 * `publicUrl` and vice-versa.
 */
export function parseGeneratedImage(results: RunResults): GeneratedImage {
  const candidate = findOutputContent(
    results,
    (c) => typeof c.url === "string" && (c.url as string).length > 0,
  );
  if (!candidate) {
    throw new BadImageOutputError("Could not find a generated image with a URL in the run output");
  }

  const url = candidate.url as string;
  const publicUrl = optionalString(candidate.public_url);

  const displayUrl = publicUrl ?? url;
  const scheme = urlScheme(displayUrl);
  if (scheme === null || !WEB_RENDERABLE_SCHEMES.includes(scheme)) {
    throw new BadImageOutputError(
      `The pipeline returned an image at "${displayUrl}", but a browser cannot load a ${
        scheme ?? "scheme-less"
      } URL.`,
      { nonWebUrl: displayUrl },
    );
  }

  return {
    url,
    publicUrl,
    mimeType: optionalString(candidate.mime_type),
    caption: optionalString(candidate.caption),
  };
}
