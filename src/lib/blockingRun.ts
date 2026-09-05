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
import type {
  DictPipeOutput,
  PipelexStartOptions,
  RunResults,
  TokensUsageRecord,
} from "@pipelex/sdk";

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
 * Usage rides differently on the two paths: the durable path gets `tokens_usages`
 * directly on `RunResults`, but the blocking execute response carries it on the
 * extension-open `pipe_output`. So the adapter also lifts the usage pair off
 * `pipe_output` onto the `RunResults` it builds, and `buildUsageReport` reads it
 * the same way for both modes.
 */
export async function executeBlockingRun<T>(
  buildOptions: () => Promise<PipelexStartOptions>,
  parse: (results: RunResults) => T,
): Promise<BlockingOutcome<T>> {
  try {
    const options = await buildOptions();
    const response = await getPipelexClient().execute(options);
    // `pipe_output` is typed as always-present, but a test double
    // may omit it — read it as optional when lifting the usage pair.
    const pipeOutput = response.pipe_output as DictPipeOutput | undefined;
    const adapted: RunResults = {
      pipeline_run_id: response.pipeline_run_id,
      main_stuff: response.main_stuff,
      tokens_usages: (pipeOutput?.tokens_usages ?? null) as TokensUsageRecord[] | null,
      usage_assembly_error: (pipeOutput?.usage_assembly_error ?? null) as string | null,
    };
    return { ok: true, output: parse(adapted), usage: buildUsageReport(adapted) };
  } catch (err) {
    // `blocking: true` maps the gateway's 502/504 cap response to execute_timeout.
    return { ok: false, error: classifyPipelineError(err, readClassifyEnv(), { blocking: true }) };
  }
}
