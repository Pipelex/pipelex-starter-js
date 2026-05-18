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
 * Narrow the SDK's loosely-typed `pipe_output` into our GeneratedImage
 * shape. Throws `BadImageOutputError` when no entry carries a usable image
 * URL — distinct from `BadPipelineOutputError` so the error UI can speak to
 * image generation specifically.
 *
 * Also rejects an image URL whose scheme a browser can't render (`file://`,
 * `pipelex-storage://`, …): `<ImageResult>` would otherwise drop it straight
 * into an `<img>` and produce a silently-broken image. This happens when the
 * Pipelex API uses local file storage — see `classifyPipelineError`.
 */
export function parseGeneratedImage(pipeOutput: unknown): GeneratedImage {
  if (!pipeOutput || typeof pipeOutput !== "object") {
    throw new BadImageOutputError("Expected pipe_output to be an object");
  }

  const workingMemory = (pipeOutput as { working_memory?: unknown }).working_memory;
  if (!workingMemory || typeof workingMemory !== "object") {
    throw new BadImageOutputError("Expected pipe_output.working_memory to be an object");
  }

  const root = (workingMemory as { root?: unknown }).root;
  if (!root || typeof root !== "object") {
    throw new BadImageOutputError("Expected pipe_output.working_memory.root to be an object");
  }

  const candidate = Object.values(root as Record<string, unknown>)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const content = (entry as { content?: unknown }).content;
      return content && typeof content === "object" ? (content as Record<string, unknown>) : null;
    })
    .find(
      (content) => content !== null && typeof content.url === "string" && content.url.length > 0,
    );

  if (!candidate) {
    throw new BadImageOutputError(
      "Could not find a generated image with a URL in pipe_output.working_memory",
    );
  }

  const url = candidate.url as string;
  const publicUrl = optionalString(candidate.public_url);

  // Validate the URL `<ImageResult>` will actually render — it displays
  // `publicUrl ?? url`, so a usable `url` can't save a broken `publicUrl`.
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
