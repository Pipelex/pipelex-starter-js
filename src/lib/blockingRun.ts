import { getPipelexClient } from "@/lib/pipelexClient";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";
import { readClassifyEnv } from "@/lib/serverEnv";
import { buildUsageReport, type UsageReport } from "@/lib/usageReport";
// StartOptions ≡ RunOptions structurally (both `RunRequest & ExtensionOptions`),
// so the same `buildOptions` closure drives `execute` (blocking) and `start`
// (durable). `PipelexStartOptions` is that pure protocol shape plus the run
// extensions — `method_ref` and `method_id`, how a scaffolded action names a
// method that lives on the platform or in a published package rather than
// shipping its bundle inline. Every extension is optional, so an action that
// sends `mthds_contents` satisfies this type unchanged.
import { resultsFromExecute } from "@pipelex/sdk";
import type { PipelexStartOptions, RunResults } from "@pipelex/sdk";

export type BlockingOutcome<T> =
  | { ok: true; output: T; usage: UsageReport }
  | { ok: false; error: PipelineError };

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
 *
 * Several fields ride differently on the two paths: the durable path gets
 * `working_memory`, the graph pair and the usage pair directly on `RunResults`,
 * while the blocking execute response carries each on the extension-open
 * `pipe_output`. The SDK's own `resultsFromExecute` is the canonical lift of all
 * of them onto their declared fields — the same mapping `startAndWaitForResult`
 * applies on its bare-runner fallback, public since `@pipelex/sdk` 0.20.1 — so
 * this helper calls it rather than restating a partial copy. That is what makes
 * `buildUsageReport` read the usage pair the same way for both modes, and
 * `working_memory` genuinely present on both.
 */
export async function executeBlockingRun<T>(
  buildOptions: () => Promise<PipelexStartOptions>,
  parse: (results: RunResults) => T,
): Promise<BlockingOutcome<T>> {
  try {
    const options = await buildOptions();
    const response = await getPipelexClient().execute(options);
    const adapted: RunResults = resultsFromExecute(response);
    return { ok: true, output: parse(adapted), usage: buildUsageReport(adapted) };
  } catch (err) {
    // `blocking: true` maps the gateway's 502/504 cap response to execute_timeout.
    return { ok: false, error: classifyPipelineError(err, readClassifyEnv(), { blocking: true }) };
  }
}
