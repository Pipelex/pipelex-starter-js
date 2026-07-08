# TODOS — Dual execution modes: blocking `execute` + durable start/poll with live status

> **✅ STATUS: COMPLETE.** All phases (0–8) shipped. `make all` green (lint + format + typecheck + unit + build); `make test-e2e` green (4 live specs pass — durable extract/summarize/image with live status, **and** the blocking-image ~30s-cap demo — offline spec skips when the API is reachable).
>
> **Two live findings worth keeping:**
>
> 1. **`main_stuff` is the bare content** (confirmed against `api-dev`, both extract-entities + image), NOT a `{ concept, content }` wrapper — so `findOutputContent`'s durable arm uses `main_stuff` directly, no unwrap. On the hosted durable path `graph_spec` is present and `pipe_output` is absent; the image returns a non-web `url` (`pipelex-storage://…`) plus a web `public_url` (signed S3), and the narrower validates `publicUrl ?? url`.
> 2. **The blocking cap is an HTTP 502, not `PipelineExecuteTimeoutError`.** Behind the hosted gateway a synchronous `execute` over ~30s returns `ApiResponseError` 502 "the runner did not complete the request" (a response — the SDK's own timeout is longer). `executeBlockingRun` passes `{ blocking: true }` to `classifyPipelineError`, which maps a blocking-path 502/504 to `execute_timeout` (the "switch to Durable" guidance); durable-path 502s stay transient `server_error`s. The `PipelineExecuteTimeoutError` branch is kept for configs where the SDK timeout fires first.
>
> **Pre-existing bug fixed along the way:** `e2e/error-display.spec.ts`'s reachability gate probed `/health`, which 404s on the hosted gateway (only `/v1/*` is served) — so it ran the offline test against a live API. Switched the probe to the always-public `/v1/version`.

**Goal.** Keep the existing **blocking** execution path (`client.execute(...)`) **and** add a **durable** path (`start` → poll) that shows **live status** in the UI. Let each example **switch between the two modes at runtime** via a small per-example toggle. Build it on **shared helpers + shared UI components** so all three examples (and future ones) inherit identical behavior.

**Why both.** Durable runs survive the hosted gateway's ~30s synchronous cap and stream status; blocking is simpler and fine for short pipelines. Keeping both turns the template into a side-by-side teaching artifact: run the **image** example in blocking mode and watch it hit the 30s wall (a real, classified `PipelineExecuteTimeoutError`), then flip to durable and watch it stream status and succeed.

**Origin.** Follow-up to PR #7 review (P2). Background in [`wip/durable-runs-for-long-pipelines.md`](./wip/durable-runs-for-long-pipelines.md).

> This is a **reference template** (`pipelex-starter-js`). Clarity beats features. Every shared piece is inherited by everyone who clones it — keep helpers small, obvious, well-commented. The dual-mode design must stay clean: the _forms_ are mode-agnostic; only the unified hook knows which actions to call.

---

## Decisions (resolved — do not re-litigate)

1. **Keep blocking, add durable. Both modes live side by side.** The existing `execute` path is preserved (renamed for clarity), the durable `start`/poll path is added.
2. **Switch = per-example UI toggle.** A small segmented control (`<ModeToggle>`) inside each form; each form owns its own `useState<ExecutionMode>`, initialized from a default constant. Chosen so you can compare modes per pipeline on the same input.
3. **Default mode = `durable`** (env-overridable via `NEXT_PUBLIC_EXECUTION_MODE`). Durable is hosted-safe everywhere; blocking is the opt-in "see the limit" mode.
4. **One unified client hook `useRun<TInput,TOutput>`** presents a single state machine (`idle | running | done | error`) and internally dispatches to blocking vs durable based on `mode`. Forms don't branch on mode.
5. **All SDK access stays server-side** (template rule: Server Actions are the only place that calls the SDK; no raw `fetch` to the Pipelex API). The client polls by calling a per-pipeline **poll Server Action**. SDK error classes don't cross the server→client boundary, so `classifyPipelineError` stays server-side.
6. **One narrower entry point, two arms — `findOutputContent(results, predicate)`.** Narrowers take `RunResults` and read `main_stuff ?? pipe_output`, but the two sources have different shapes so the helper branches:
   - **`main_stuff`** (durable hosted) = the **single main output stuff** directly → unwrap to its content and validate against the predicate. **No search.**
   - **`pipe_output`** (blocking `execute` + durable bare-runner) = the full `{ working_memory: { root } }` → **search** `root[*].content` for the entry matching the predicate (the existing logic).
     The blocking `execute` response adapts into `{ pipeline_run_id, pipe_output }`, so blocking and durable-bare share the search arm. All three narrowers stay DRY behind this one helper; the predicate is both the search key (pipe*output arm) and the validator (main_stuff arm). **Limitation:** `RunResults` does **not** surface `working_memory.json` (only `main_stuff`/`graph_spec`/`pipe_output`). Fine here — every example wants the \_main* output — but a future durable pipeline that needs an _intermediate_ stuff can't reach the full working memory via the typed surface (would need an SDK addition upstream in `pipelex-sdk-js`).

---

## Phase 0 — confirm the `main_stuff` shape (small, not a blocker)

**Corrected understanding (from the user's S3 result folder).** The result bucket `results/<run-id>/` holds **separate** artifacts: `working_memory.json` (the full working memory — _contains_ the main stuff plus every intermediate stuff), `main_stuff.json` (**just the single main output stuff**), `graphspec.json`, and rendered views (`main_stuff.html/.md`, `mermaidflow.*`, `reactflow.html`). **`main_stuff` is NOT the working memory** — it's the main output directly. And the SDK's `RunResults` exposes `main_stuff` + `graph_spec` (+ bare-runner `pipe_output`) but **does NOT expose `working_memory.json`**. For all three examples the narrower wants the _main_ output, so `main_stuff` is exactly right — the durable path is actually _simpler_ than blocking (no root search). The two arms genuinely differ (Decision 6). The only open bit: is `main_stuff` a `{ concept, content }` stuff wrapper or the bare content? One live probe confirms; `findOutputContent` tolerates both until then.

---

## SDK reference (verified against `@pipelex/sdk@0.1.4` — embedded so a cold start needs no re-investigation)

All types/values import from the **`@pipelex/sdk`** barrel. Verified: a type+value probe using exactly these imports compiles clean against the project's `tsconfig.json` (incl. `StartOptions`, re-exported via `export * from "mthds/protocol"`).

### Client methods (on the cached `PipelexApiClient` from `getPipelexClient()`)

```ts
execute(options: RunOptions): Promise<DictRunResultExecute>      // BLOCKING path (kept). { pipeline_run_id, pipe_output }
start(options: StartOptions): Promise<RunResultStart>            // DURABLE: POST /v1/start (202) -> { pipeline_run_id }
getRunStatus(runId, o?): Promise<RunRead>                        // DURABLE: coarse status, every poll
getRunResult(runId, o?): Promise<RunResultState>                 // DURABLE: single-shot running|completed|failed
version(): Promise<VersionInfo>                                  // GET /v1/version handshake
// waitForResult / startAndWaitForResult exist but we DON'T use them (they poll server-side -> no live UI status)
```

`RunOptions` and `StartOptions` are structurally identical (`RunRequest & ExtensionOptions`): `{ pipe_code?, mthds_contents?, inputs?, output_name?, output_multiplicity?, dynamic_output_concept_ref?, extra? }`. → the `{ pipe_code, mthds_contents:[bundle], inputs }` we build today works verbatim for **both** `execute` and `start`. No cancel/stop method; no streaming.

### `DictRunResultExecute` (blocking response) vs `RunResults` (durable completed)

```ts
// BLOCKING
type DictRunResultExecute = { pipeline_run_id: string; pipe_output: DictPipeOutput };
type DictPipeOutput = {
  working_memory: { root: Record<string, DictStuff>; aliases: Record<string, string> };
  pipeline_run_id: string;
};
type DictStuff = { concept: string; content: unknown };

// DURABLE — read main_stuff ?? pipe_output
interface RunResults {
  pipeline_run_id: string;
  graph_spec?: unknown; // graphspec.json; hosted only; null mid-write; null on bare runner
  main_stuff?: unknown; // main_stuff.json = the SINGLE main output stuff, NOT the working memory. { concept, content } wrapper vs bare content -> confirm in Phase 0. (working_memory.json is a separate S3 artifact the SDK does NOT expose.)
  pipe_output?: Record<string, unknown> | null; // BARE-RUNNER fallback: the old { working_memory: { root } } shape
}
```

**Adapter (the convergence):** blocking `response` → `{ pipeline_run_id: response.pipeline_run_id, pipe_output: response.pipe_output }` is a valid `RunResults` (`main_stuff` undefined → `findOutputContent` falls to the `pipe_output.working_memory.root` arm). Same narrower, no per-mode branching.

### `RunResultState` (what `getRunResult` returns — discriminated on `state`)

```ts
type RunResultState =
  | { state: "running"; pipeline_run_id: string; retry_after_seconds: number | null } // HTTP 202 / 503
  | { state: "completed"; pipeline_run_id: string; result: RunResults } // HTTP 200
  | { state: "failed"; pipeline_run_id: string; status: RunStatus; message: string }; // HTTP 409
```

### `RunRead` (what `getRunStatus` returns) — no failure message (that's why failures read via `getRunResult`)

```ts
interface RunRead {
  pipeline_run_id: string;
  pipe_code?: string | null;
  status: RunStatus;
  created_at: string;
  finished_at?: string | null;
  degraded: boolean;
  retry_after_seconds?: number | null;
  [ext: string]: unknown;
}
```

### `RunStatus` + helpers (value exports)

```ts
type RunStatus = "PENDING"|"STARTED"|"RUNNING"|"COMPLETED"|"FAILED"|"CANCELLED"|"TERMINATED"|"TIMED_OUT";
isTerminalRunStatus(status): boolean
isSuccessRunStatus(status): boolean   // only COMPLETED is success
```

### Error classes (value exports — for `classifyPipelineError` branches)

Already handled (keep): `ApiResponseError`, `ApiUnreachableError`, `ClientAuthenticationError`.

| Class                          | Extra fields                             | Raised on which mode                                                            | Add branch                                                                           |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PipelineExecuteTimeoutError`  | `elapsedMs`                              | **blocking** — hosted ~30s cap. **Now demonstrable!**                           | yes — message: "exceeded the ~30s hosted limit; switch to Durable mode"              |
| `RunStillRunningError`         | `runId`, `retryAfterSeconds`, `location` | **blocking** — 202 degrade                                                      | yes                                                                                  |
| `RunFailedError`               | `runId`, `status`                        | **durable** — we construct from the `failed` poll state                         | yes                                                                                  |
| `RunTimeoutError`              | `runId`, `timeoutMs`                     | only `waitForResult` (unused)                                                   | optional (completeness)                                                              |
| `RunLifecycleUnavailableError` | `apiUrl`                                 | **durable** — bare runner, no run store (raw `start()` does NOT auto-fall-back) | yes — actionable "this runner has no run store; use Blocking mode or the hosted API" |

---

## Target architecture

### Two paths behind one hook

```
Blocking mode:
  client: run(input) -> run<Name>Blocking(input)   // Server Action -> client.execute(...) -> adapt -> parse
       -> { ok:true, output } | { ok:false, error }
  UI: <RunStatus> with spinner + elapsed (NO status label) while awaiting; then result or <ErrorDisplay>

Durable mode:
  client: run(input) -> start<Name>Run(input)       // Server Action -> client.start(...)
       -> { ok:true, runId } | { ok:false, error }
  client: useRun loops every ~Ns: poll<Name>Run(runId)   // Server Action -> getRunStatus [+ getRunResult on terminal]
       -> { ok:true, state:"running", status, degraded, retryAfterSeconds }   // <RunStatus> with status label
       -> { ok:true, state:"completed", output }                              // result component
       -> { ok:false, error }                                                 // <ErrorDisplay>
  Either mode: a rejected await -> classifyTransportError -> <ErrorDisplay>
```

### Shared pieces to build

| New file                        | Kind               | Responsibility                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`                 | pure (client-safe) | `type ExecutionMode = "blocking" \| "durable"` + `DEFAULT_EXECUTION_MODE` (reads `NEXT_PUBLIC_EXECUTION_MODE`, defaults `"durable"`).                                                                                                                                       |
| `src/lib/blockingRun.ts`        | server-only        | `executeBlockingRun(buildOptions, parse): Promise<BlockingOutcome<T>>` — wrap `client.execute` + adapt to `RunResults` + `parse` + `classifyPipelineError`.                                                                                                                 |
| `src/lib/durableRun.ts`         | server-only        | `startDurableRun(buildOptions): Promise<StartOutcome>` + `pollDurableRun(runId, parse): Promise<PollOutcome<T>>`.                                                                                                                                                           |
| `src/lib/runOutput.ts`          | pure               | `findOutputContent(results: RunResults, predicate)` — normalizes `main_stuff ?? pipe_output` over BOTH shapes. De-dupes the three narrowers, serves all three execution paths.                                                                                              |
| `src/hooks/useRun.ts`           | client hook        | Unified state machine; dispatches blocking vs durable by `mode`; status/elapsed, `setTimeout` poll loop honoring `retryAfterSeconds`, client-side timeout ceiling, staleness token, unmount cleanup, `try/catch`→`classifyTransportError`. Returns `{ state, run, reset }`. |
| `src/components/RunStatus.tsx`  | client component   | Shared live-status card: spinner + friendly status label (durable) or spinner+elapsed only (blocking), `role="status" aria-live="polite"`, blue accent matching the card primitive, degraded note.                                                                          |
| `src/components/ModeToggle.tsx` | client component   | Segmented `radiogroup` "Blocking / Durable · live status"; `value`/`onChange`/`disabled`; one-line helper text explaining durable survives the ~30s cap.                                                                                                                    |

### Files that change

| File                                                              | Change                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/actions/runExtractEntitiesPipeline.ts`                       | Export `runExtractEntitiesBlocking(text)` (the kept `execute` path, body adapted to `RunResults`+shared helper), `startExtractEntitiesRun(text)`, `pollExtractEntitiesRun(runId)`. Keep the empty-input `bad_request` guard in both `runExtractEntitiesBlocking` and `startExtractEntitiesRun`. |
| `src/actions/runSummarizePdfPipeline.ts`                          | Same trio. Keep the `validateDataUrl` + `fileInputErrorToPipelineError` pre-flight in both `*Blocking` and `start*`.                                                                                                                                                                            |
| `src/actions/runGenerateImagePipeline.ts`                         | Same trio.                                                                                                                                                                                                                                                                                      |
| `src/types/extractEntitiesPipeline.ts`                            | `parseEntities(results: RunResults)` via `findOutputContent`.                                                                                                                                                                                                                                   |
| `src/types/summarizePipeline.ts`                                  | `parseDocumentSummary(results: RunResults)`; keep `doc_type`→`docType`, `key_points`→`keyPoints`.                                                                                                                                                                                               |
| `src/types/generateImagePipeline.ts`                              | `parseGeneratedImage(results: RunResults)`; keep `BadImageOutputError` + `WEB_RENDERABLE_SCHEMES`.                                                                                                                                                                                              |
| `src/lib/errors.ts`                                               | New `PipelineErrorKind`s + `classifyPipelineError` branches for the durable/blocking error classes above.                                                                                                                                                                                       |
| `src/components/EntityForm.tsx` / `PdfForm.tsx` / `ImageForm.tsx` | Add `useState<ExecutionMode>`, render `<ModeToggle>`; replace `useTransition`+single-await with `useRun`; render `<RunStatus>` while running.                                                                                                                                                   |
| Tests (Phase 6)                                                   | Action tests (both modes), form tests (both modes + toggle), `errors.test.ts`; new tests for `blockingRun`, `durableRun`, `runOutput`, `useRun`, `RunStatus`, `ModeToggle`.                                                                                                                     |
| `CLAUDE.md`                                                       | Update "Pipelex Integration Pattern" (dual-mode), "To add a new pipeline" steps, project structure, testing/mock notes.                                                                                                                                                                         |
| `wip/durable-runs-for-long-pipelines.md`                          | Mark resolved / point at this plan once shipped.                                                                                                                                                                                                                                                |

### Files that DON'T change (confirmed)

`src/lib/pipelexClient.ts` (same client, new methods), `src/lib/fileEncoding.ts`, `src/lib/clientFile.ts`, `src/lib/loadBundle.ts`, `src/types/pipelineError.ts`, the result components (`EntityResult`/`PdfSummaryResult`/`ImageResult`), `ErrorDisplay.tsx` (reused for failed runs + timeouts), `ExampleTabs.tsx` (panels already stay mounted via `hidden` — the poll loop relies on it; per-example toggle state also survives tab switches because panels stay mounted).

---

## Poll design (durable mode — the detail that matters)

`pollDurableRun(runId, parse)` per tick:

1. `read = await client.getRunStatus(runId)`.
2. `!isTerminalRunStatus(read.status)` → `{ ok:true, state:"running", status: read.status, degraded: read.degraded, retryAfterSeconds: read.retry_after_seconds ?? null }`.
3. Terminal → `res = await client.getRunResult(runId)`:
   - `completed` → `{ ok:true, state:"completed", output: parse(res.result) }`.
   - `failed` → `classifyPipelineError(new RunFailedError(res.message, runId, res.status), env)`.
   - `running` (**race**: status terminal but `main_stuff`/`graph_spec` mid-write) → return `running` so the client polls once more.
4. Any thrown SDK error (incl. `parse` throwing `BadPipelineOutputError`/`BadImageOutputError`, or `RunLifecycleUnavailableError`) → `classifyPipelineError(err, env)`.

**Client loop (`useRun`, durable branch):** recursive `setTimeout` (no overlap); next delay `Math.max(intervalMs≈2000, (retryAfterSeconds ?? 0)*1000)`; ceiling `maxDurationMs≈300_000` (image needs ≥150s; hosted runs can live 20min) → timeout `PipelineError`; staleness token (PdfForm `selectionTokenRef` precedent); elapsed ticker (~250ms) for a smooth counter; `try/catch`→`classifyTransportError` around start + each poll.

**Client (`useRun`, blocking branch):** set `running` (status `null`), start elapsed ticker, `await blocking(input)` in `try/catch`→transport; `{ok:true}`→`done`, `{ok:false}`→`error`. No loop. Same staleness token + cleanup.

---

## Code sketches (starting points — match repo style: double quotes, named exports, `@/` imports, inline-Tailwind, comments explaining _why_)

### `src/config.ts`

```ts
export type ExecutionMode = "blocking" | "durable";
// NEXT_PUBLIC_ is inlined at build time -> safe to read on the client.
export const DEFAULT_EXECUTION_MODE: ExecutionMode =
  (process.env.NEXT_PUBLIC_EXECUTION_MODE as ExecutionMode) || "durable";
```

### `src/lib/blockingRun.ts` (server-only)

```ts
import { getPipelexClient } from "@/lib/pipelexClient";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";
import type { StartOptions, RunResults } from "@pipelex/sdk"; // StartOptions ≡ RunOptions structurally

function env() {
  return { apiUrl: process.env.PIPELEX_BASE_URL, hasApiKey: Boolean(process.env.PIPELEX_API_KEY) };
}
export type BlockingOutcome<T> = { ok: true; output: T } | { ok: false; error: PipelineError };

export async function executeBlockingRun<T>(
  buildOptions: () => Promise<StartOptions>,
  parse: (results: RunResults) => T,
): Promise<BlockingOutcome<T>> {
  try {
    const r = await getPipelexClient().execute(await buildOptions());
    // Adapt blocking response to RunResults so ONE narrower serves both modes:
    return {
      ok: true,
      output: parse({ pipeline_run_id: r.pipeline_run_id, pipe_output: r.pipe_output }),
    };
  } catch (err) {
    return { ok: false, error: classifyPipelineError(err, env()) };
  }
}
```

### `src/lib/durableRun.ts` (server-only)

```ts
import { getPipelexClient } from "@/lib/pipelexClient";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";
import {
  RunFailedError,
  isTerminalRunStatus,
  type StartOptions,
  type RunResults,
} from "@pipelex/sdk";

function env() {
  return { apiUrl: process.env.PIPELEX_BASE_URL, hasApiKey: Boolean(process.env.PIPELEX_API_KEY) };
}
export type StartOutcome = { ok: true; runId: string } | { ok: false; error: PipelineError };
export type PollOutcome<T> =
  | {
      ok: true;
      state: "running";
      status: string;
      degraded: boolean;
      retryAfterSeconds: number | null;
    }
  | { ok: true; state: "completed"; output: T }
  | { ok: false; error: PipelineError };

export async function startDurableRun(
  buildOptions: () => Promise<StartOptions>,
): Promise<StartOutcome> {
  try {
    const { pipeline_run_id } = await getPipelexClient().start(await buildOptions());
    return { ok: true, runId: pipeline_run_id };
  } catch (err) {
    return { ok: false, error: classifyPipelineError(err, env()) };
  }
}

export async function pollDurableRun<T>(
  runId: string,
  parse: (r: RunResults) => T,
): Promise<PollOutcome<T>> {
  const client = getPipelexClient();
  try {
    const read = await client.getRunStatus(runId);
    if (!isTerminalRunStatus(read.status))
      return {
        ok: true,
        state: "running",
        status: read.status,
        degraded: read.degraded,
        retryAfterSeconds: read.retry_after_seconds ?? null,
      };
    const res = await client.getRunResult(runId);
    if (res.state === "completed")
      return { ok: true, state: "completed", output: parse(res.result) };
    if (res.state === "failed")
      return {
        ok: false,
        error: classifyPipelineError(new RunFailedError(res.message, runId, res.status), env()),
      };
    return {
      ok: true,
      state: "running",
      status: read.status,
      degraded: read.degraded,
      retryAfterSeconds: res.retry_after_seconds ?? null,
    }; // mid-write race
  } catch (err) {
    return { ok: false, error: classifyPipelineError(err, env()) };
  }
}
```

### `src/lib/runOutput.ts` (pure — finalize `main_stuff` arm after Phase 0)

```ts
import type { RunResults } from "@pipelex/sdk";
type Content = Record<string, unknown>;
/** Output content matching `predicate`. Two arms — the sources differ in shape:
 *   - main_stuff (durable hosted) = the SINGLE main output stuff -> unwrap + validate, no search.
 *   - pipe_output (blocking + durable-bare) = { working_memory: { root } } -> search root[*].content. */
export function findOutputContent(
  results: RunResults,
  predicate: (c: Content) => boolean,
): Content | undefined {
  if (results.main_stuff != null) {
    const s = results.main_stuff as Content;
    const content = ("content" in s ? s.content : s) as Content; // unwrap { concept, content } if wrapped (Phase 0)
    return predicate(content) ? content : undefined; // predicate doubles as validation
  }
  const root = (
    results.pipe_output as {
      working_memory?: { root?: Record<string, { content?: unknown }> };
    } | null
  )?.working_memory?.root;
  if (!root) return undefined;
  for (const entry of Object.values(root)) {
    const content = (entry?.content ?? entry) as Content;
    if (predicate(content)) return content;
  }
  return undefined;
}
```

### `src/hooks/useRun.ts` (client — the unified switch)

```ts
"use client";
import { useEffect, useRef, useState } from "react";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import type { ExecutionMode } from "@/config";
import type { BlockingOutcome } from "@/lib/blockingRun";
import type { StartOutcome, PollOutcome } from "@/lib/durableRun";

export type RunState<T> =
  | { phase: "idle" }
  | {
      phase: "running";
      mode: ExecutionMode;
      status: string | null;
      elapsedMs: number;
      degraded: boolean;
    }
  | { phase: "done"; output: T }
  | { phase: "error"; error: PipelineError };

export function useRun<TInput, TOutput>(cfg: {
  mode: ExecutionMode;
  blocking: (input: TInput) => Promise<BlockingOutcome<TOutput>>;
  start: (input: TInput) => Promise<StartOutcome>;
  poll: (runId: string) => Promise<PollOutcome<TOutput>>;
  intervalMs?: number; // default 2000
  maxDurationMs?: number; // default 300_000
}): { state: RunState<TOutput>; run: (input: TInput) => void; reset: () => void } {
  // tokenRef (staleness), startedAt + timer refs, state.
  // run(input): bump token; setState running(mode, status:null); start elapsed ticker.
  //   blocking: try r = await cfg.blocking(input) catch -> transport; guard token; map -> done/error; stop ticker.
  //   durable:  try s = await cfg.start(input) catch -> transport; if !s.ok -> error; else loop(s.runId).
  // loop(runId): schedule poll; on running -> update {status,degraded,elapsed}, reschedule by retryAfter;
  //              on completed -> done; on !ok -> error; enforce maxDurationMs -> timeout error. token-guard everything.
  // reset(): bump token, clear timers, idle.  useEffect cleanup: bump token + clear timers on unmount.
}
```

### `src/components/ModeToggle.tsx` (client)

```tsx
"use client";
import type { ExecutionMode } from "@/config";
const OPTIONS: { value: ExecutionMode; label: string }[] = [
  { value: "blocking", label: "Blocking" },
  { value: "durable", label: "Durable · live status" },
];
export function ModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionMode;
  onChange: (m: ExecutionMode) => void;
  disabled?: boolean;
}) {
  // role="radiogroup" aria-label="Execution mode"; two segmented buttons; slate accent on selected.
  // helper line: "Durable survives the ~30s hosted timeout and streams live status."
}
```

### Form wiring (mode-agnostic — same for all three; EntityForm shown)

```tsx
const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
const { state, run } = useRun({
  mode,
  blocking: runExtractEntitiesBlocking,
  start: startExtractEntitiesRun,
  poll: pollExtractEntitiesRun,
});
// submit: run(text.trim())
// render:
//   <ModeToggle value={mode} onChange={setMode} disabled={state.phase === "running"} />
//   {state.phase === "running" && <RunStatus status={state.status} elapsedMs={state.elapsedMs} degraded={state.degraded} />}
//   {state.phase === "error"   && <ErrorDisplay error={state.error} />}
//   {state.phase === "done"    && <EntityResult entities={state.output} />}
```

### Per-pipeline actions (thin; extract-entities shown)

```ts
"use server";
// runExtractEntitiesBlocking — the KEPT execute path
export async function runExtractEntitiesBlocking(text: string): Promise<BlockingOutcome<ExtractedEntities>> {
  const t = text.trim();
  if (!t) return { ok: false, error: /* bad_request */ };
  return executeBlockingRun(async () => ({ pipe_code: "extract_entities", mthds_contents: [await loadExtractEntitiesBundle()], inputs: { text: t } }), parseEntities);
}
export async function startExtractEntitiesRun(text: string): Promise<StartOutcome> {
  const t = text.trim();
  if (!t) return { ok: false, error: /* bad_request */ };
  return startDurableRun(async () => ({ pipe_code: "extract_entities", mthds_contents: [await loadExtractEntitiesBundle()], inputs: { text: t } }));
}
export async function pollExtractEntitiesRun(runId: string): Promise<PollOutcome<ExtractedEntities>> {
  return pollDurableRun(runId, parseEntities);
}
```

(Factor the shared empty-input guard + the `buildOptions` closure to avoid duplicating between blocking/start.)

---

## Implementation phases (checkboxes track progress)

### Phase 0 — Confirm the `main_stuff` shape (quick; not blocking)

`main_stuff` = the single main output stuff (working memory is a separate, non-exposed artifact). Just confirm the wrapper.

- [ ] With a live hosted key (`PIPELEX_API_KEY` set, `PIPELEX_BASE_URL` unset → `api.pipelex.com`), run a throwaway probe (scratchpad or temp e2e — do NOT commit): load `methods/extract-entities/main.mthds`, `client.start({ pipe_code:"extract_entities", mthds_contents:[bundle], inputs:{ text:"..." } })`, poll `getRunResult` to `completed`, `console.dir(res.result.main_stuff, { depth: null })`.
- [ ] Confirm the `main_stuff` wrapper: tick one —
  - [ ] `{ concept, content: { people, orgs, dates } }` (DictStuff wrapper → unwrap `.content`)
  - [ ] `{ people, orgs, dates }` (bare content → use directly)
  - [ ] something else: `____________`
- [ ] Confirm the image `main_stuff` exposes `url`/`publicUrl` the same way. Note whether `graph_spec`/`pipe_output` are present/null on the hosted path.
- [ ] (Optional) capture a bare-runner `pipe_output` sample (local `pipelex-api`) to lock the search arm; otherwise rely on existing fixtures (`working_memory.root[*].content`).
- [ ] Encode the confirmed `main_stuff` unwrap in `runOutput.ts` (drop the tolerant fallback once pinned).

**CHECKPOINT 0:** `main_stuff` wrapper confirmed. (Can also be done lazily — `findOutputContent`'s tolerant unwrap lets Phases 1–4 proceed first.)

### Phase 1 — Config + shared error kinds

- [ ] Add `src/config.ts` (`ExecutionMode`, `DEFAULT_EXECUTION_MODE`).
- [ ] Extend `src/lib/errors.ts`: add `PipelineErrorKind`s (e.g. `execute_timeout`, `run_failed`, `lifecycle_unavailable`, `run_still_running`, optional `run_timeout`) and `classifyPipelineError` `instanceof` branches for `PipelineExecuteTimeoutError` (actionable: "switch to Durable mode"), `RunFailedError`, `RunLifecycleUnavailableError` ("this runner has no run store; use Blocking mode or the hosted API"), `RunStillRunningError`, and optionally `RunTimeoutError`. Import classes from `@pipelex/sdk`. Keep `classifyPipelineError` pure (env passed in). Decide `title`/`message`/`hint` per kind, mirroring existing branch style.

### Phase 2 — Shared run helpers + narrower refactor (durable arm depends on Phase 0)

- [ ] Add `src/lib/runOutput.ts` (`findOutputContent`): implement the `pipe_output.working_memory.root` arm first (existing logic — serves blocking + durable-bare), then the `main_stuff` arm from Phase 0.
- [ ] Add `src/lib/blockingRun.ts` (`executeBlockingRun`, `BlockingOutcome<T>`) and `src/lib/durableRun.ts` (`startDurableRun`, `pollDurableRun`, `StartOutcome`, `PollOutcome<T>`).
- [ ] Change `parseEntities`/`parseDocumentSummary`/`parseGeneratedImage` to `(results: RunResults)` via `findOutputContent`. Preserve summarize's snake→camel remap and image's `BadImageOutputError` + web-scheme validation. Keep throwing tagged subclasses on mismatch (poll/blocking catch classifies them as today).

**CHECKPOINT 1:** server side compiles; `runOutput`/`blockingRun`/`durableRun` + narrowers unit-tested green (at least the `pipe_output` arm against existing fixtures). Forms untouched. Handoff.

### Phase 3 — Per-pipeline actions (blocking kept + start + poll)

- [ ] `runExtractEntitiesPipeline.ts`: `runExtractEntitiesBlocking(text)` (kept `execute` path, now via `executeBlockingRun`), `startExtractEntitiesRun(text)`, `pollExtractEntitiesRun(runId)`. Share the empty-input guard + `buildOptions` closure.
- [ ] `runSummarizePdfPipeline.ts`: `runSummarizePdfBlocking({dataUrl,filename})` + `startSummarizePdfRun(...)` + `pollSummarizePdfRun(runId)`. Keep the `validateDataUrl` pre-flight in both `*Blocking` and `start*`.
- [ ] `runGenerateImagePipeline.ts`: `runGenerateImageBlocking(prompt)` + `startGenerateImageRun(prompt)` + `pollGenerateImageRun(runId)`.
- [ ] Remove the old single `run<Name>Pipeline` exports (replaced by the trio). Breaking change is fine.

### Phase 4 — Unified hook

- [ ] Add `src/hooks/useRun.ts` per sketch: blocking branch (single await) + durable branch (poll loop), shared staleness token, elapsed ticker, `maxDurationMs` ceiling, unmount cleanup, `classifyTransportError` around start/blocking/poll awaits. `src/hooks/` is a new dir; no Tailwind glob change needed (hook emits no classes).

### Phase 5 — Shared UI + wire forms

- [ ] Add `src/components/RunStatus.tsx` (blue card; status label when present else spinner+elapsed; degraded note; `role="status" aria-live="polite"`).
- [ ] Add `src/components/ModeToggle.tsx` (segmented radiogroup; helper text).
- [ ] `EntityForm.tsx`: add `useState<ExecutionMode>(DEFAULT_EXECUTION_MODE)`, render `<ModeToggle>` (disabled while running), wire `useRun({ mode, blocking: runExtractEntitiesBlocking, start: startExtractEntitiesRun, poll: pollExtractEntitiesRun })`, render `<RunStatus>`/`<EntityResult>`/`<ErrorDisplay>` by phase.
- [ ] `ImageForm.tsx`: same with the image trio + `<ImageResult>`. Headline demo: durable streams status then image; blocking shows the ~30s `execute_timeout` error.
- [ ] `PdfForm.tsx`: same with the pdf trio + `<PdfSummaryResult>`, preserving the existing file-encoding/validation flow (`acceptFile`, `fileToDataUrl`, `selectionTokenRef`) before `run({ dataUrl, filename })`.
- [ ] Manual check: switch mode mid-form, run both modes on the same input; tab-switch mid-run keeps the loop alive (panels stay mounted).

**CHECKPOINT 2:** both modes work end-to-end in `make dev` against the live hosted API for all three examples; toggle flips cleanly; durable shows live status. Good handoff.

### Phase 6 — Tests (unit)

- [ ] `src/lib/runOutput.test.ts` (new): `findOutputContent` over a hosted `main_stuff` fixture (Phase 0) AND a `pipe_output.working_memory.root` fixture; predicate match + no-match (undefined).
- [ ] `src/lib/blockingRun.test.ts` (new): mock `{ execute }`; success→adapted→parsed output; throw→classified; assert `execute` called with exact options; `bad_image_output` via a result whose image content lacks `url`.
- [ ] `src/lib/durableRun.test.ts` (new): mock `{ start, getRunStatus, getRunResult }`; start success/throw; poll running; terminal→completed→parsed; terminal→failed→`run_failed` (assert `RunFailedError` args); terminal-but-result-running race→running; narrower throw→classified; `RunLifecycleUnavailableError`→`lifecycle_unavailable`.
- [ ] Rewrite the three `src/actions/*.test.ts`: mock surface now `{ execute, start, getRunStatus, getRunResult }`. Assert each action calls the right SDK method with the exact `{ pipe_code, mthds_contents, inputs }`, and is NOT called on empty/invalid input. Use `main_stuff` completed fixtures (durable) and `pipe_output` fixtures (blocking/bare).
- [ ] Extend `src/lib/errors.test.ts`: cases for each new SDK error class → expected kind (incl. `PipelineExecuteTimeoutError`, now meaningful). Mirror existing positional constructor usage.
- [ ] `src/hooks/useRun.test.tsx` (new): fake timers. Blocking: `run`→running→done; `run`→`{ok:false}`→error; rejected blocking→transport error. Durable: poll running→running→completed→done; failed poll→error; rejected start/poll→transport; unmount mid-run discards late result (staleness); `maxDurationMs` exceed→timeout.
- [ ] `src/components/RunStatus.test.tsx` (new): `role="status"`; label for a given `RunStatus`; elapsed seconds; degraded note; spinner-only when status null (blocking).
- [ ] `src/components/ModeToggle.test.tsx` (new): renders radiogroup; selecting an option fires `onChange`; respects `disabled`.
- [ ] Rewrite form tests (`EntityForm`/`ImageForm`/`PdfForm`): mock the trio of actions; cover BOTH modes — toggle to blocking → asserts blocking action called + result; toggle to durable → drives fake timers, asserts `<RunStatus>` then result; failed path → `<ErrorDisplay>`; transport-reject guard on the awaited action(s) (the `mockRejectedValueOnce(new TypeError("Failed to fetch"))` regression). Preserve PdfForm's stale-FileReader test.
- [ ] `make agent-test` green. `ExampleTabs.test.tsx` unaffected (stubs the forms).

### Phase 7 — Docs

- [ ] `CLAUDE.md` "Pipelex Integration Pattern": document the dual-mode pattern — the `<ModeToggle>` + `useRun` + `<RunStatus>`, the kept blocking `execute` path, the durable `start`/poll path, and the `main_stuff ?? pipe_output` narrower contract with the blocking-response adapter. Update "To add a new pipeline" (now: bundle → narrower(`RunResults`) → **blocking + start + poll actions** → wire form with `useRun` + `<ModeToggle>` + `<RunStatus>`).
- [ ] `CLAUDE.md` Project Structure: add `src/config.ts`, `src/lib/blockingRun.ts`, `src/lib/durableRun.ts`, `src/lib/runOutput.ts`, `src/hooks/useRun.ts`, `src/components/RunStatus.tsx`, `src/components/ModeToggle.tsx`.
- [ ] `CLAUDE.md` Testing/"Mocking the SDK": update to the `{ execute, start, getRunStatus, getRunResult }` mock surface; note both modes are covered.
- [ ] Document `NEXT_PUBLIC_EXECUTION_MODE` in `README.md` / `.env.example` if present (default `durable`).
- [ ] `wip/durable-runs-for-long-pipelines.md`: mark resolved (point to this plan / commit). WIP-doc edits are not changelog-worthy.

### Phase 8 — e2e + live verification (final)

- [ ] Update `e2e/extract.spec.ts` / `summarize-pdf.spec.ts` / `generate-image.spec.ts`: default (durable) drives the UI and optionally asserts the `role="status"` region appears before the result; keep the live-API guard + generous image timeout. Consider one spec that toggles to **blocking** for image and asserts the `execute_timeout` error renders (demonstrates the cap) — gate it behind the live-API guard.
- [ ] Confirm `e2e/error-display.spec.ts` (offline, unguarded) still passes.
- [ ] `make all` green (lint + format-check + typecheck + unit + build). If `make format-check` fails, run `make format`.
- [ ] `make test-e2e` live: **durable image returns an image (no 30s timeout); blocking image surfaces the `execute_timeout` error.** Watch live status update in `make dev`.

**CHECKPOINT 3 (final):** both modes shipped behind a per-example `<ModeToggle>`, unified by `useRun`, sharing `<RunStatus>`; `make all` + `make test-e2e` green; docs updated.

---

## Open questions / risks

- **`main_stuff` shape (Phase 0).** `main_stuff` is the single main output stuff (not the working memory). Only the wrapper (`{ concept, content }` vs bare content) needs a one-shot live confirmation; `findOutputContent`'s tolerant unwrap lets work proceed before then.
- **SDK doesn't expose `working_memory.json` on durable runs.** `RunResults` surfaces only `main_stuff`/`graph_spec`/`pipe_output`. Fine for these examples (all want the main output), but a future durable pipeline needing an intermediate stuff can't reach the full working memory via the typed surface — would need an SDK addition upstream in `pipelex-sdk-js`.
- **Bare-runner durable (`RunLifecycleUnavailableError`).** Raw `start()` throws on a runner with no run store (no auto-fallback). Recommended: classify into a clear error pointing the user at Blocking mode / hosted API — and since blocking mode now exists, that's a real, usable fallback, not a dead end. (No hidden auto-switch in the template.)
- **No per-step progress.** SDK gives only coarse `RunStatus` + wall-clock elapsed. The label ("Queued"/"Running" + `Ns`) is honest, not a progress bar.
- **Poll frequency.** ~2s, honor `retry_after_seconds`; don't drop below ~1s.
- **Mid-write race** handled by re-reporting `running` when `getRunResult` returns `running` after a terminal status.
- **`make use-local`.** If iterating against sibling `../pipelex-sdk-js`, re-run after each SDK edit (Turbopack won't follow symlinks). npm `@pipelex/sdk@0.1.4` already has the full durable surface — no SDK change required.

## Done criteria

- [ ] Each example has a `<ModeToggle>`; blocking and durable both work behind the unified `useRun` hook; `<RunStatus>` renders in both modes (status label in durable).
- [ ] Blocking path preserved (`execute`); durable path added (`start`/poll); no orphaned old `run<Name>Pipeline` exports.
- [ ] One `findOutputContent` (two arms: `main_stuff` unwrap-and-validate; `pipe_output` working-memory search) serves all three paths.
- [ ] New blocking/durable error kinds classified in `errors.ts` (incl. demonstrable `execute_timeout`).
- [ ] `make all` green; `make test-e2e` green — durable image returns an image, blocking image demonstrates the ~30s cap.
- [ ] `CLAUDE.md` (pattern + structure + testing) updated; wip doc marked resolved.
