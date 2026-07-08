# Follow-up: switch long-running pipelines to durable runs

> **✅ Resolved.** Implemented as the dual-mode design in `TODOS.md`: both modes ship side by side behind a per-example `<ModeToggle>`, unified by the `useRun` hook. Durable (`start` + poll) is the default and survives the ~30s cap; blocking (`execute`) is kept to demonstrate the limit (a classified `execute_timeout`). One `findOutputContent` narrower reads `main_stuff ?? pipe_output`. See `CLAUDE.md` → "Pipelex Integration Pattern" for the canonical pattern. The notes below are the original problem statement, kept for context.

**Source:** PR #7 review comment from `chatgpt-codex-connector` (P2) — "Switch image generation to durable runs."

## The problem

The migration to `@pipelex/sdk` wired every server action to `client.execute(...)`, which hits the blocking `POST /v1/execute` path. Behind the **hosted gateway** (`api.pipelex.com`, the default when `PIPELEX_BASE_URL` is unset), synchronous requests are cut off at **~30s**. Long-running pipelines exceed that ceiling and surface as a timeout error instead of returning a result.

Image generation is the clear offender: `e2e/generate-image.spec.ts` already allows up to **150s** for the run. So with the default hosted setup, the image example fails rather than returning an image.

The SDK itself documents this — `execute()`'s doc comment says: _"Behind the hosted gateway, synchronous requests terminate at ~30s; a run that outlives that should use the durable start+poll path."_

## The fix

Use the SDK's durable run lifecycle instead of blocking `execute()` for long pipelines. The SDK already provides a one-call helper:

```ts
// PipelexApiClient
startAndWaitForResult(options: StartOptions, pollOptions?: WaitForResultOptions): Promise<RunResults>
```

Behavior (from `client.d.ts`):

- **Hosted** (decided via the `/v1/version` handshake): durable `POST /v1/start` (202) → poll `GET /v1/runs/{id}/results` until terminal. Survives the 30s gateway cap.
- **Bare runner** (no run store): transparently falls back to the blocking `POST /v1/execute`.

So `startAndWaitForResult` is the right default for any pipeline that may run long — it does the right thing on both tiers with no env branching.

## ⚠️ Output-shape change — don't miss this

The durable path returns a **`RunResults`**, not the blocking execute response. Its output lives in a different field:

```ts
interface RunResults {
  pipeline_run_id: string;
  graph_spec?: unknown;
  main_stuff?: unknown; // hosted durable path output
  pipe_output?: Record<string, unknown> | null; // bare-runner blocking fallback only
}
```

The SDK docs say consumers should read **`main_stuff ?? pipe_output`** (the documented output-shape difference between the two tiers).

Today `parseGeneratedImage(response.pipe_output)` expects the blocking-execute shape and reaches into `pipe_output.working_memory.root`. When switching to `startAndWaitForResult`, the action must pass `result.main_stuff ?? result.pipe_output` into the narrower — and we need to confirm the **hosted `main_stuff` shape matches** what `parseGeneratedImage` walks (`working_memory.root` vs. a possibly flattened `main_stuff`). This likely also affects the other narrowers if we migrate them too.

## Scope / decisions to make

- **Image generation** — definitely migrate (flagged, already 150s in e2e).
- **summarize-pdf** — likely also long enough to exceed 30s; consider migrating for the same reason.
- **extract-entities** — short; blocking `execute()` is probably fine, but moving everything to `startAndWaitForResult` would make the starter uniformly hosted-safe and simpler to reason about. Decide: migrate only the long ones, or standardize on durable runs everywhere.
- **Pattern doc** — `CLAUDE.md`'s "Pipelex Integration Pattern" section shows `execute(...)`. If we standardize on durable runs, update that canonical example + the per-action narrower contract (`main_stuff ?? pipe_output`).
- **Polling knobs** — review `WaitForResultOptions` (`runs.d.ts:97`) for timeout/interval defaults; image gen needs a ceiling ≥150s.
- **Tests** — unit tests mock `client.execute`; they'd switch to mocking `startAndWaitForResult` and returning a `RunResults` (`main_stuff`-shaped). Re-run `make test-e2e` against the live hosted API to confirm the 30s cliff is gone.

## Files in play

- `src/actions/runGenerateImagePipeline.ts` (primary)
- `src/types/generateImagePipeline.ts` — narrower input field (`pipe_output` → `main_stuff ?? pipe_output`)
- possibly `src/actions/runSummarizePdfPipeline.ts` + `src/types/summarizePipeline.ts`
- `src/actions/run*Pipeline.test.ts` — mock surface
- `CLAUDE.md` — integration pattern example, if standardizing
