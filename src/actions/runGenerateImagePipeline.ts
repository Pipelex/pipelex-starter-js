"use server";

import { loadGenerateImageBundle } from "@/lib/loadBundle";
import { parseGeneratedImage, type GeneratedImage } from "@/types/generateImagePipeline";
import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";
import {
  pollDurableRun,
  startDurableRun,
  type PollOutcome,
  type StartOutcome,
} from "@/lib/durableRun";
import type { PipelineError } from "@/lib/errors";
import type { StartOptions } from "@pipelex/sdk";

const PIPE_CODE = "generate_image";

function emptyInputError(): PipelineError {
  return {
    kind: "bad_request",
    title: "Prompt required",
    message: "Describe the image you want to generate.",
    details: "Empty input",
  };
}

async function buildOptions(prompt: string): Promise<StartOptions> {
  return {
    pipe_code: PIPE_CODE,
    mthds_contents: [await loadGenerateImageBundle()],
    inputs: { image_prompt: prompt },
  };
}

/**
 * BLOCKING path: generate an image synchronously (`POST /v1/execute`). Image
 * generation routinely outlives the hosted gateway's ~30s cap, so this is the
 * example that best demonstrates `execute_timeout` — flip to Durable mode to
 * actually get an image.
 */
export async function runGenerateImageBlocking(
  prompt: string,
): Promise<BlockingOutcome<GeneratedImage>> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: emptyInputError() };
  return executeBlockingRun(() => buildOptions(trimmed), parseGeneratedImage);
}

/** DURABLE path — start the image run and return its id to poll. */
export async function startGenerateImageRun(prompt: string): Promise<StartOutcome> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: emptyInputError() };
  return startDurableRun(() => buildOptions(trimmed));
}

/** DURABLE path — poll one tick of a started image run by id. */
export async function pollGenerateImageRun(runId: string): Promise<PollOutcome<GeneratedImage>> {
  return pollDurableRun(runId, parseGeneratedImage);
}
