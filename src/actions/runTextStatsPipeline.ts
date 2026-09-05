"use server";

import { PIPE_IO_CONTRACTS } from "@/generated/text-stats/contracts";
import { parseTextStatsOutput, type TextStatsOutput } from "@/types/textStatsPipeline";
import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";
import {
  pollDurableRun,
  startDurableRun,
  type PollOutcome,
  type StartOutcome,
} from "@/lib/durableRun";
import { gateRunInputs, requireContract } from "@/lib/runInputs";
import type { PipelexStartOptions } from "@pipelex/sdk";

// Scaffolded by `make add-method` — yours to edit from here on.
//
// The method is NOT copied into this repo: it lives where
// `methods/text-stats/method.json` says, and the run names the same selector the
// generated tree was projected from. To move to another version of it, edit that
// manifest and run `npm run codegen`.
const METHOD_REF = "github.com/Pipelex/methods/text_stats@v0.1.1";
const PIPE_CODE = "analyze_text";

// The same generated contract the browser rendered the form from. One gate, two
// call sites, zero drift — and the server's copy is the one that's trusted.
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "text_stats", PIPE_CODE);

/**
 * SDK options shared by both paths — `execute` and `start` take the same shape.
 *
 * `PipelexStartOptions` is the protocol's run arguments plus the run extensions;
 * the selector below is one of those, which is what lets this action name a
 * method that lives elsewhere instead of shipping a bundle inline.
 */
async function buildOptions(inputs: Record<string, unknown>): Promise<PipelexStartOptions> {
  return {
    method_ref: METHOD_REF,
    pipe_code: PIPE_CODE,
    inputs,
  };
}

/**
 * BLOCKING path (`POST /v1/execute`). Behind the hosted gateway a synchronous run
 * is cut off at ~30s; flip the example to Durable mode to survive a long one.
 */
export async function runTextStatsBlocking(
  data: Record<string, unknown>,
): Promise<BlockingOutcome<TextStatsOutput>> {
  const gated = gateRunInputs(CONTRACT, data);
  if (!gated.ok) return gated;
  return executeBlockingRun(() => buildOptions(gated.inputs), parseTextStatsOutput);
}

/** DURABLE path — start the run (`POST /v1/start`) and return its id to poll. */
export async function startTextStatsRun(data: Record<string, unknown>): Promise<StartOutcome> {
  const gated = gateRunInputs(CONTRACT, data);
  if (!gated.ok) return gated;
  return startDurableRun(() => buildOptions(gated.inputs));
}

/** DURABLE path — poll one tick of a started run by id. */
export async function pollTextStatsRun(runId: string): Promise<PollOutcome<TextStatsOutput>> {
  return pollDurableRun(runId, parseTextStatsOutput);
}
