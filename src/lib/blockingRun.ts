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
 * The execute response is adapted onto `RunResults` (`main_stuff` undefined,
 * `pipe_output` carried through) so the SAME narrower serves blocking and
 * durable — `findOutputContent` falls to the `pipe_output` search arm here.
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
      // `DictPipeOutput` is the concrete `{ working_memory, pipeline_run_id }`;
      // `RunResults.pipe_output` is the looser `Record<string, unknown>` the
      // narrower's search arm reads. Widen through `unknown` (no index sig).
      pipe_output: response.pipe_output as unknown as Record<string, unknown>,
    };
    return { ok: true, output: parse(adapted) };
  } catch (err) {
    // `blocking: true` maps the gateway's 502/504 cap response to execute_timeout.
    return { ok: false, error: classifyPipelineError(err, readClassifyEnv(), { blocking: true }) };
  }
}
