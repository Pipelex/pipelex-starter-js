import { getPipelexClient } from "@/lib/pipelexClient";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";
import { readClassifyEnv } from "@/lib/serverEnv";
// StartOptions ≡ RunOptions structurally (both `RunRequest & ExtensionOptions`),
// so the same `buildOptions` closure drives `execute` (blocking) and `start`
// (durable).
import type { RunResults, StartOptions } from "@pipelex/sdk";

export type BlockingOutcome<T> = { ok: true; output: T } | { ok: false; error: PipelineError };

/**
 * Run a pipeline the **blocking** way — one synchronous `POST /v1/execute` —
 * and narrow its output. Server-only (constructs the SDK client and reads
 * `process.env`).
 *
 * Behind the hosted gateway, `execute` is killed at ~30s and the SDK throws
 * `PipelineExecuteTimeoutError`; that (and every other SDK error) is caught and
 * classified, so the caller always gets a structured `BlockingOutcome`.
 *
 * The execute response already carries the resolved main output on `.main_stuff`
 * (the SDK digs it out of the working memory), so it adapts onto `RunResults`
 * with the SAME resolved `main_stuff` the durable path delivers — one narrower,
 * one accessor, no `pipe_output` search. A completed run that named no locatable
 * main stuff throws `MissingMainStuffError` on that access, which the catch below
 * classifies like any other SDK error.
 */
export async function executeBlockingRun<T>(
  buildOptions: () => Promise<StartOptions>,
  parse: (results: RunResults) => T,
): Promise<BlockingOutcome<T>> {
  try {
    const options = await buildOptions();
    const response = await getPipelexClient().execute(options);
    const adapted: RunResults = {
      pipeline_run_id: response.pipeline_run_id,
      main_stuff: response.main_stuff,
    };
    return { ok: true, output: parse(adapted) };
  } catch (err) {
    // `blocking: true` maps the gateway's 502/504 cap response to execute_timeout.
    return { ok: false, error: classifyPipelineError(err, readClassifyEnv(), { blocking: true }) };
  }
}
