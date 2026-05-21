"use server";

import { getPipelexClient } from "@/lib/pipelexClient";
import { loadGenerateImageBundle } from "@/lib/loadBundle";
import { parseGeneratedImage, type GeneratedImage } from "@/types/generateImagePipeline";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";

export type RunGenerateImagePipelineResult =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: PipelineError };

/**
 * Server Action: generate an image from a text prompt and return either the
 * generated image or a classified error. Same discriminated-union shape as
 * the other examples — structured failures survive the server→client
 * boundary, where thrown server-action errors would be stripped to digests.
 */
export async function runGenerateImagePipeline(
  prompt: string,
): Promise<RunGenerateImagePipelineResult> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: {
        kind: "bad_request",
        title: "Prompt required",
        message: "Describe the image you want to generate.",
        details: "Empty input",
      },
    };
  }

  try {
    const bundle = await loadGenerateImageBundle();
    const client = getPipelexClient();
    const response = await client.executePipeline({
      pipe_code: "generate_image",
      mthds_contents: [bundle],
      inputs: { image_prompt: trimmed },
    });
    const image = parseGeneratedImage(response.pipe_output);
    return { ok: true, image };
  } catch (err) {
    return {
      ok: false,
      error: classifyPipelineError(err, {
        apiUrl: process.env.PIPELEX_API_URL,
        hasApiKey: Boolean(process.env.PIPELEX_API_KEY),
      }),
    };
  }
}
