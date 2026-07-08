"use server";

import { loadExtractEntitiesBundle } from "@/lib/loadBundle";
import { parseEntities, type ExtractedEntities } from "@/types/extractEntitiesPipeline";
import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";
import {
  pollDurableRun,
  startDurableRun,
  type PollOutcome,
  type StartOutcome,
} from "@/lib/durableRun";
import type { PipelineError } from "@/lib/errors";
import type { StartOptions } from "@pipelex/sdk";

const PIPE_CODE = "extract_entities";

function emptyInputError(): PipelineError {
  return {
    kind: "bad_request",
    title: "Input required",
    message: "Enter some text to extract entities from.",
    details: "Empty input",
  };
}

/** SDK options shared by both paths — `execute` and `start` take the same shape. */
async function buildOptions(text: string): Promise<StartOptions> {
  return {
    pipe_code: PIPE_CODE,
    mthds_contents: [await loadExtractEntitiesBundle()],
    inputs: { text },
  };
}

/**
 * BLOCKING path: run the extract-entities pipeline synchronously (`POST /v1/execute`).
 * Behind the hosted gateway this is cut off at ~30s — fine for short text, but
 * flip the example to Durable mode to survive long runs. Returns a structured
 * outcome (never throws across the server→client boundary).
 */
export async function runExtractEntitiesBlocking(
  text: string,
): Promise<BlockingOutcome<ExtractedEntities>> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: emptyInputError() };
  return executeBlockingRun(() => buildOptions(trimmed), parseEntities);
}

/** DURABLE path — start the run (`POST /v1/start`) and return its id to poll. */
export async function startExtractEntitiesRun(text: string): Promise<StartOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: emptyInputError() };
  return startDurableRun(() => buildOptions(trimmed));
}

/** DURABLE path — poll one tick of a started run by id. */
export async function pollExtractEntitiesRun(
  runId: string,
): Promise<PollOutcome<ExtractedEntities>> {
  return pollDurableRun(runId, parseEntities);
}
