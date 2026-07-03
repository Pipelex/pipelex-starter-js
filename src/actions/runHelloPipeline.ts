"use server";

import { loadHelloBundle } from "@/lib/loadBundle";
import { parseEntities, type ExtractedEntities } from "@/types/helloPipeline";
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
  return { pipe_code: PIPE_CODE, mthds_contents: [await loadHelloBundle()], inputs: { text } };
}

/**
 * BLOCKING path: run the hello pipeline synchronously (`POST /v1/execute`).
 * Behind the hosted gateway this is cut off at ~30s — fine for short text, but
 * flip the example to Durable mode to survive long runs. Returns a structured
 * outcome (never throws across the server→client boundary).
 */
export async function runHelloBlocking(text: string): Promise<BlockingOutcome<ExtractedEntities>> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: emptyInputError() };
  return executeBlockingRun(() => buildOptions(trimmed), parseEntities);
}

/** DURABLE path — start the run (`POST /v1/start`) and return its id to poll. */
export async function startHelloRun(text: string): Promise<StartOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: emptyInputError() };
  return startDurableRun(() => buildOptions(trimmed));
}

/** DURABLE path — poll one tick of a started run by id. */
export async function pollHelloRun(runId: string): Promise<PollOutcome<ExtractedEntities>> {
  return pollDurableRun(runId, parseEntities);
}
