# Follow-up: durable-runs PR code-review findings

**Source:** xhigh-effort workflow code review of the staged durable-runs changes (`git diff --staged`). 6 finders + per-candidate adversarial verification; findings survived independent verification. This file tracks the fixes; delete or mark resolved as each lands.

The work is grouped into phases by severity. The correctness trio (Phase 1) is the must-fix-before-land set — #1 and #3 in particular undercut the durable-runs feature this PR is built around.

## Phase 1 — Correctness (fix before landing)

> **✅ Resolved (2026-06-30).** All three fixed, with tests, `make all` green.
>
> - **#1** — `pollDurableRun` now tags each failure `transient` (`server_error`/`api_unreachable` → transient; `run_failed`/`lifecycle_unavailable`/bad-output/auth → terminal). `useRun` retries transient poll failures (and rejected poll awaits) up to `MAX_TRANSIENT_POLL_FAILURES = 5` consecutive, surfacing `degraded` meanwhile; a verdict-bearing tick resets the streak. Terminal failures still fail immediately.
> - **#2** — `handleUseSample` clears run state (`setFileError(null)` + `reset()`) up-front, before the async fetch, so a failed sample fetch can't leave a stale summary beside the new error.
> - **#3** — Decision: **kept `durable` as the default** (changing it to blocking would re-break the hosted majority — the whole point of the feature) and added a **transparent bare-runner fallback** in `useRun`: a durable `start` that returns `lifecycle_unavailable` re-runs the blocking path. Bare runners have no run store but also no ~30s gateway cap, so blocking is correct there — mirrors the SDK's own `startAndWaitForResult`. A fresh clone now works against any backend with no manual toggle flip.
>
> **`mthds-starter-js` checked — none of Phase 1 applies.** That repo is the pre-durable-runs version (older `mthds` SDK, blocking-only): no `useRun`/`durableRun`/`config`/`ModeToggle`, so #1 and #3 don't exist there, and its `PdfForm.handleUseSample` already clears state up-front (the correct pre-regression pattern), so #2 doesn't apply either.

### 1. Durable poll loop aborts a still-running pipeline on any transient blip

**Where:** `src/hooks/useRun.ts:161` (root cause mirrored at `src/lib/durableRun.ts:101`). **Verdict:** CONFIRMED.

The poll loop treats every non-ok outcome as terminal: `if (!outcome.ok) { fail(outcome.error); return; }`. The SDK only retries 202/503 internally (`getRunStatus`/`getRunResult` re-throw 502/500 and network errors as `ApiResponseError`/`ApiUnreachableError`), so a single transient gateway 5xx or a momentary network blip on one poll tick makes `pollDurableRun` return `{ok:false}` and the UI abandons a run that finishes fine server-side. This defeats durable mode's documented "survives the cap / hosted-safe" guarantee — the SDK's own `pollUntilResult` tolerates exactly these conditions; this per-tick poller does not.

**Fix direction:** distinguish transient from terminal poll failures and keep polling on transient ones, with a bounded consecutive-failure budget before giving up. Either tag the `PollOutcome` error with a transient/terminal flag in `durableRun.ts` and branch on it in `useRun`, or track a consecutive-failure counter in the hook that only `fail()`s once it crosses a threshold. Keep terminal application errors (`run_failed`, etc.) failing immediately.

### 2. PdfForm renders a stale summary next to a fresh fetch error

**Where:** `src/components/PdfForm.tsx:122`. **Verdict:** CONFIRMED.

`handleUseSample` no longer clears prior run state up-front; clearing now happens only via `reset()` inside `acceptFile()`, which runs after `fetch('/sample-invoice.pdf')` succeeds. If that fetch fails, the catch sets `fileError` but `reset()` never fires, so `state.phase` stays `"done"`. The render then shows both the new "Could not reach the server" `ErrorDisplay` and the previous `PdfSummaryResult` at once — a contradictory failure-plus-stale-success UI. This is a regression from routing the clear through `acceptFile`.

**Fix direction:** clear prior run state at the top of `handleUseSample`, before the async fetch, the way the previous code did.

### 3. Default durable mode breaks the out-of-box happy path on self-hosted runners

**Where:** `src/config.ts:26`. **Verdict:** CONFIRMED.

`DEFAULT_EXECUTION_MODE` is `"durable"`, but a bare self-hosted `pipelex-api` runner (which the README explicitly supports) has no run store. The first run of every example calls `start`, the SDK 404s the lifecycle routes and throws `RunLifecycleUnavailableError`, and every example shows "Durable runs aren't available on this API" until the user discovers the per-example toggle and flips it to Blocking. The out-of-the-box experience is broken for the entire self-hosted audience.

**Fix direction:** decide the intended default story for self-hosted. Options, in rough order of preference: detect `lifecycle_unavailable` on the first durable attempt and transparently fall back to blocking for that session; or default to blocking and let hosted users opt into durable; or, at minimum, document the `NEXT_PUBLIC_EXECUTION_MODE` override prominently in the README next to the self-hosted instructions. Whichever we pick, the goal is that a fresh clone pointed at any supported backend runs the examples without a manual toggle flip.

> **Checkpoint — end of Phase 1. ✅ DONE (2026-06-30).** The correctness trio is fixed with tests; `make all` passes (lint + format + typecheck + unit + build). Still owed before the PR lands: `make test-e2e` against the live hosted API to exercise the real durable poll loop end-to-end (the transient-retry and bare-runner-fallback paths are unit-tested with mocks, not yet against a live runner). Phases 2–4 remain open.

## Phase 2 — Accessibility

### 4. ModeToggle radiogroup has no keyboard navigation

**Where:** `src/components/ModeToggle.tsx:25`. **Verdict:** CONFIRMED.

The component renders plain `<button role="radio">` options inside `role="radiogroup"` with no roving `tabIndex` and no `onKeyDown` handler. Tab stops on every radio instead of the single roving stop the ARIA radio pattern requires, and Left/Right/Up/Down arrow keys — which AT users expect to move selection within a radiogroup — do nothing. The advertised radiogroup cannot be operated the way its role promises.

**Fix direction:** either implement the ARIA radio pattern properly (roving tabindex: only the selected radio is tabbable, arrow keys move and select), or switch to native `<input type="radio">` elements styled as a segmented control, which get keyboard behavior for free. Native is simpler and matches the "keep it small and obvious" template ethos.

### 5. RunStatus re-announces a 4Hz timer in an aria-live region

**Where:** `src/components/RunStatus.tsx:52`. **Verdict:** CONFIRMED.

The `{seconds}s` elapsed counter sits inside the `role="status" aria-live="polite"` region with no `aria-hidden` (only the spinner span is hidden). The `useRun` ticker updates `elapsedMs` ~4×/second (`TICK_MS = 250`), so a screen reader re-announces the region content continuously ("Running 0.2 seconds… Running 0.5 seconds…") for the whole run, drowning out the meaningful status-label changes the live region is meant to convey.

**Fix direction:** add `aria-hidden="true"` to the elapsed-time span so the live region announces only the status label, not the ticking counter.

> **Checkpoint — end of Phase 2.** A11y fixes are visually verifiable; sanity-check keyboard navigation on `ModeToggle` and confirm the timer no longer ticks inside the live region. These pair naturally with the correctness trio for a single "review fixes" PR.

## Phase 3 — Latent / judgment calls

These are not confirmed bugs in the shipped examples but are traps worth a decision. Resolve the design question for each, then either fix or explicitly accept and document.

### 6. Blocking vs durable disagree on which output is "main"

**Where:** `src/lib/blockingRun.ts:39`. **Verdict:** PLAUSIBLE (latent).

The `execute → RunResults` adapter copies only `pipeline_run_id` + `pipe_output` and drops the server's `main_stuff_name` extension field, so the blocking arm of `findOutputContent` must guess the main output by predicate-shape-matching the first `working_memory` entry. A pipeline with an intermediate or input stuff that satisfies the same narrower predicate as the final output (draft-then-finalize, fetch-then-generate) renders the wrong result in blocking mode, while the identical run in durable mode reads the true `main_stuff` and renders correctly. None of the three shipped examples trip this, but anyone extending the template can.

**Fix direction:** preserve `main_stuff_name` through the adapter and have the blocking arm of `findOutputContent` prefer the named main stuff over first-match. Keeps the two modes in agreement and removes the shape-guessing.

### 7. Blocking 502/504 always forced to `execute_timeout`

**Where:** `src/lib/blockingRun.ts:44`. **Verdict:** PLAUSIBLE.

`executeBlockingRun` passes `{blocking:true}`, so every 502/504 on the blocking path maps to `execute_timeout` ("switch to Durable mode"), including a genuine runner-crash bad-gateway that the old path classified as `server_error` ("retry"). Note: this mapping is documented as intended in `CLAUDE.md`, so it may be by-design. Decision needed: accept the trade-off (a real bad-gateway is rare on the blocking path and the "switch to Durable" guidance is still reasonable) and leave it, or distinguish the two.

### 8. 5-min client poll ceiling cuts off legitimately long runs

**Where:** `src/hooks/useRun.ts:116`. **Verdict:** PLAUSIBLE.

`DEFAULT_MAX_DURATION_MS = 300_000` (5 min) while the hosted lifecycle/SDK allow ~20 min, and none of the three forms override `maxDurationMs`. A durable run that legitimately takes ~7 minutes is force-stopped with a `run_timeout` (`buildClientTimeoutError`) even though it completes server-side — contradicting the PR's framing that durable mode lets long pipelines succeed.

**Fix direction:** raise the default ceiling to align with the SDK lifecycle ceiling (or pass a per-example `maxDurationMs` for the long ones, e.g. image generation, which `e2e` already allows up to ~150s). At minimum, the default should not be below the longest example's expected runtime.

> **Checkpoint — end of Phase 3.** Each item here needs a yes/no design decision before code changes. Record the decision inline (accept vs fix) so the next session does not re-litigate.

## Phase 4 — Cleanups

### 9. `classifyBlockingGatewayTimeout` duplicates `classifyExecuteTimeout`

**Where:** `src/lib/errors.ts:286` (vs `:264`). **Verdict:** CONFIRMED. Same `kind` (`execute_timeout`), identical title and `hint.summary`, differing only in the message string. Factor the shared title/hint into one helper that takes the per-source message + details, so timeout copy can't drift between the two branches.

### 10. `env()` helper duplicated verbatim

**Where:** `src/lib/blockingRun.ts:8` and `src/lib/durableRun.ts:11`. **Verdict:** PLAUSIBLE. Both build the `ClassifyEnv` from a copy-pasted `{ apiUrl, hasApiKey }` reader. Both already import `getPipelexClient` from the server-only `@/lib/pipelexClient`; move a single `readClassifyEnv()` there and reuse it, so a future `ClassifyEnv` field can't be added to one path and missed on the other.

### 11. Garbled markdown in TODOS.md

**Where:** `TODOS.md:32`. **Verdict:** CONFIRMED. The line reads `pipe*output` and `\_main*` instead of the literal `pipe_output` / `_main_`, opening an unterminated emphasis run and rendering a stray backslash. Fix by escaping the underscores or wrapping the identifiers in backticks.

## Refuted (not acted on)

Two candidates were raised and rejected by verification, recorded here so they are not re-flagged:

- **`buildClientTimeoutError` vs `classifyRunTimeout` "duplication"** (`src/lib/errors.ts:447`) — deliberate and documented as distinct (SDK error classified server-side vs client-built poll ceiling); not a defect.
- **Unused `mode` field in `RunState.running`** (`src/hooks/useRun.ts:19`) — factually unread by consumers but harmless; no behavioral bug.
