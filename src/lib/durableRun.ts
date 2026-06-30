import { getPipelexClient } from "@/lib/pipelexClient";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";
import {
  RunFailedError,
  isTerminalRunStatus,
  type RunResults,
  type RunStatus,
  type StartOptions,
} from "@pipelex/sdk";

function env() {
  return { apiUrl: process.env.PIPELEX_API_URL, hasApiKey: Boolean(process.env.PIPELEX_API_KEY) };
}

export type StartOutcome = { ok: true; runId: string } | { ok: false; error: PipelineError };

export type PollOutcome<T> =
  | {
      ok: true;
      state: "running";
      status: RunStatus;
      degraded: boolean;
      retryAfterSeconds: number | null;
    }
  | { ok: true; state: "completed"; output: T }
  | { ok: false; error: PipelineError };

/**
 * Start a pipeline the **durable** way — `POST /v1/start` (202) — and return
 * the run id to poll. Server-only.
 *
 * Against a bare runner with no run store, the SDK throws
 * `RunLifecycleUnavailableError` (raw `start()` does NOT auto-fall-back to
 * blocking); it is classified into a `lifecycle_unavailable` error that points
 * the user at Blocking mode.
 */
export async function startDurableRun(
  buildOptions: () => Promise<StartOptions>,
): Promise<StartOutcome> {
  try {
    const options = await buildOptions();
    const { pipeline_run_id } = await getPipelexClient().start(options);
    return { ok: true, runId: pipeline_run_id };
  } catch (err) {
    return { ok: false, error: classifyPipelineError(err, env()) };
  }
}

/**
 * Poll one tick of a durable run. Server-only — the client calls this on a
 * timer (see `useRun`) and never touches the SDK directly.
 *
 * 1. `getRunStatus` — while non-terminal, report `running` with the coarse
 *    status + degraded flag + the server's `Retry-After` hint.
 * 2. On a terminal status, `getRunResult`:
 *    - `completed` → narrow `result` and report `completed`.
 *    - `failed`    → classify a constructed `RunFailedError` (the status read
 *                    has no failure message; the result lookup does).
 *    - `running`   → mid-write race (status flipped terminal but `main_stuff` /
 *                    `graph_spec` aren't written yet) → report `running` so the
 *                    client polls once more.
 * A thrown SDK error — including a narrower throwing `BadPipelineOutputError` /
 * `BadImageOutputError`, or `RunLifecycleUnavailableError` — is classified.
 */
export async function pollDurableRun<T>(
  runId: string,
  parse: (results: RunResults) => T,
): Promise<PollOutcome<T>> {
  const client = getPipelexClient();
  try {
    const read = await client.getRunStatus(runId);
    if (!isTerminalRunStatus(read.status)) {
      return {
        ok: true,
        state: "running",
        status: read.status,
        degraded: read.degraded,
        retryAfterSeconds: read.retry_after_seconds ?? null,
      };
    }

    const res = await client.getRunResult(runId);
    if (res.state === "completed") {
      return { ok: true, state: "completed", output: parse(res.result) };
    }
    if (res.state === "failed") {
      return {
        ok: false,
        error: classifyPipelineError(new RunFailedError(res.message, runId, res.status), env()),
      };
    }
    // res.state === "running": terminal status but result artifacts mid-write.
    return {
      ok: true,
      state: "running",
      status: read.status,
      degraded: read.degraded,
      retryAfterSeconds: res.retry_after_seconds ?? null,
    };
  } catch (err) {
    return { ok: false, error: classifyPipelineError(err, env()) };
  }
}
