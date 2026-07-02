# pipelex-starter-js

Minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

This repo is a **reference template**. Keep it small, clear, and high-quality — clarity beats features. When adding anything, ask: "would I want every consumer of this template to inherit this?"

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS 3 (minimal, no design system — keep classes inline and obvious)
- **Testing**: Vitest 4 + Testing Library (happy-dom) for unit; Playwright for e2e
- **Linting**: ESLint 9 (flat config via `eslint-config-next`)
- **Formatting**: Prettier 3
- **Git hooks**: Husky + lint-staged
- **SDK**: [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) (`PipelexApiClient`)

## Project Structure

```
methods/
  hello/main.mthds            # text → entities pipeline (TOML)
  summarize-pdf/main.mthds    # PDF Document → structured summary
  generate-image/main.mthds   # text prompt → image (gpt-image-1-mini)
public/
  sample-invoice.pdf          # sample PDF the PDF example loads out of the box
src/
  config.ts                   # ExecutionMode + DEFAULT_EXECUTION_MODE (client-safe)
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — a trio per pipeline
    runHelloPipeline.ts         # runHelloBlocking + startHelloRun + pollHelloRun
    runSummarizePdfPipeline.ts  # …Blocking + start… + poll…
    runGenerateImagePipeline.ts # …Blocking + start… + poll…
  lib/
    pipelexClient.ts          # PipelexApiClient singleton factory
    loadBundle.ts             # fs.readFile of the .mthds bundles
    blockingRun.ts            # executeBlockingRun — the blocking `execute` path (server)
    durableRun.ts             # startDurableRun + pollDurableRun — the durable start/poll path (server)
    runOutput.ts              # findOutputContent — main_stuff ?? pipe_output narrowing (pure)
    errors.ts                 # classifyPipelineError + classifyTransportError + PipelineError model
    fileEncoding.ts           # data-URL validation + Document input envelope (server)
    clientFile.ts             # browser File → base64 data URL (client)
  hooks/
    useRun.ts                 # unified blocking|durable state machine (client)
  components/
    ExampleTabs.tsx           # client component — tab switcher for the 3 examples
    EntityForm/PdfForm/ImageForm.tsx        # client components (per-example input, mode-agnostic)
    ModeToggle.tsx            # client component — Blocking|Durable segmented control
    RunStatus.tsx             # live-status card (spinner + status label + elapsed)
    EntityResult/PdfSummaryResult/ImageResult.tsx  # server components (render output)
    ErrorDisplay.tsx          # server component (renders classified PipelineError)
  types/
    pipelineError.ts          # BadPipelineOutputError + BadImageOutputError (tagged)
    helloPipeline.ts          # ExtractedEntities + parseEntities(RunResults)
    summarizePipeline.ts      # DocumentSummary + parseDocumentSummary(RunResults)
    generateImagePipeline.ts  # GeneratedImage + parseGeneratedImage(RunResults)
e2e/
  extract.spec.ts             # Playwright e2e (hits live API)
  summarize-pdf.spec.ts
  generate-image.spec.ts
```

### What lives where

- **`methods/`** — `.mthds` bundles (TOML). Treat them as first-class artifacts, not embedded strings. Use the `/mthds-build`, `/mthds-edit`, `/mthds-check`, `/mthds-run` skills from the `mthds-plugins` marketplace to author and validate them.
- **`src/actions/`** — Server Actions (`"use server"`). The only place that calls the Pipelex SDK. Each pipeline exports a **trio**: `run<Name>Blocking` (the blocking `execute` path), `start<Name>Run` + `poll<Name>Run` (the durable start/poll path). They are thin: pre-flight guard → build options → delegate to `executeBlockingRun` / `startDurableRun` / `pollDurableRun`.
- **`src/lib/`** — Server-side utilities. No React. The two execution helpers `blockingRun.ts` and `durableRun.ts` are server-only (they construct the SDK client and read `process.env`); `runOutput.ts` is pure (just shape-narrowing). Deliberate client-touching exceptions: `errors.ts` (its types cross the server→client boundary, and `classifyTransportError` + `buildClientTimeoutError` run client-side), and `clientFile.ts` (a browser `FileReader` wrapper imported only by client components). `fileEncoding.ts` is pure (no React, no `process.env`) so it is safe to import from either side. Because `errors.ts` is bundled into the client, it imports the SDK error classes from **`@pipelex/sdk`**. That barrel is client-safe — `PipelexApiClient` is fetch-based and pulls no `node:fs` into the graph — so a client bundler handles it without breaking `make build`. Only `pipelexClient.ts` (server-only) constructs `PipelexApiClient` from `@pipelex/sdk`. The forms import `blockingRun`/`durableRun` **types only** (`import type`), so no server code leaks into the client bundle.
- **`src/hooks/`** — `useRun<TInput,TOutput>`, the unified client state machine (`idle → running → done|error`) that dispatches blocking vs durable by `mode`. Holds the durable poll loop, the staleness token, the elapsed ticker, the wall-clock ceiling, the `classifyTransportError` wrapping, and the **transient-failure budget** (a momentary 5xx/network blip on one poll tick — flagged `transient` by `pollDurableRun` — or a rejected poll await is retried up to `MAX_TRANSIENT_POLL_FAILURES`, surfacing `degraded` meanwhile, rather than abandoning a run that's still completing server-side). A durable `start` that returns `lifecycle_unavailable` (a bare runner with no run store) surfaces as an explicit error — `useRun` never silently downgrades durable to blocking. Forms never branch on mode — they just call `run(input)`.
- **`src/components/`** — React components. `"use client"` only when the component uses hooks, event handlers, or browser APIs (`ModeToggle` does; `RunStatus` is a pure render).
- **`src/types/`** — TS types and runtime narrowers (`parseXxx(results: RunResults)`). Narrowers read the output via `findOutputContent` and throw on shape mismatch; that's deliberate (system boundary).

## Pipelex Integration Pattern

**Two execution modes, one hook.** Every example runs in either mode, chosen per-example at runtime via a `<ModeToggle>`:

- **Blocking** (`client.execute`) — one synchronous request. Simple, but behind the hosted gateway it is cut off at ~30s, so long pipelines surface a classified `execute_timeout` error. Use it to _see_ that limit.
- **Durable** (`client.start` then poll) — survives the ~30s cap and streams coarse live status. Hosted-safe everywhere; the default (`NEXT_PUBLIC_EXECUTION_MODE`, defaults `"durable"`). On a bare runner with no run store it surfaces an explicit `lifecycle_unavailable` error (naming the endpoint URL, pointing at Blocking mode) — no silent downgrade.

The forms are **mode-agnostic** — they call `useRun({ mode, blocking, start, poll })` and render by `state.phase`. Only the unified hook knows which Server Actions to call.

```ts
// src/actions/runHelloPipeline.ts — a thin trio per pipeline
"use server";
import { loadHelloBundle } from "@/lib/loadBundle";
import { parseEntities, type ExtractedEntities } from "@/types/helloPipeline";
import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";
import { pollDurableRun, startDurableRun, type PollOutcome, type StartOutcome } from "@/lib/durableRun";
import type { StartOptions } from "@pipelex/sdk";

// `execute` and `start` take the same options, so one closure drives both.
async function buildOptions(text: string): Promise<StartOptions> {
  return { pipe_code: "extract_entities", mthds_contents: [await loadHelloBundle()], inputs: { text } };
}

export async function runHelloBlocking(text: string): Promise<BlockingOutcome<ExtractedEntities>> {
  const t = text.trim();
  if (!t) return { ok: false, error: /* bad_request */ };
  return executeBlockingRun(() => buildOptions(t), parseEntities);
}
export async function startHelloRun(text: string): Promise<StartOutcome> {
  const t = text.trim();
  if (!t) return { ok: false, error: /* bad_request */ };
  return startDurableRun(() => buildOptions(t));
}
export async function pollHelloRun(runId: string): Promise<PollOutcome<ExtractedEntities>> {
  return pollDurableRun(runId, parseEntities);
}
```

The shared helpers in `src/lib/` own the SDK call + `classifyPipelineError` (server-side, where the SDK error classes still `instanceof`-match): `executeBlockingRun` wraps `client.execute` and **adapts its response onto `RunResults`** (`{ pipeline_run_id, pipe_output }`) so one narrower serves both modes; `startDurableRun` wraps `client.start`; `pollDurableRun` does one `getRunStatus` (+ `getRunResult` on a terminal status) tick.

**One narrower contract — `parseXxx(results: RunResults)` via `findOutputContent(results, predicate)`.** The two modes deliver output in different fields, so `findOutputContent` (`src/lib/runOutput.ts`) reads `main_stuff ?? pipe_output` over both shapes:

- **`main_stuff`** (durable hosted) is the single main output's **content directly** (confirmed live — _not_ a `{ concept, content }` wrapper, _not_ a working-memory map) → validate against the predicate, no search.
- **`pipe_output`** (blocking `execute`, adapted) is the full `{ working_memory: { root } }` → search `root[*].content` for the entry matching the predicate.

The predicate does double duty: it's the search key in the `pipe_output` arm and the validator in the `main_stuff` arm. **Limitation:** `RunResults` does not surface `working_memory.json`, only `main_stuff` — fine here (every example wants the _main_ output), but a future durable pipeline needing an _intermediate_ stuff would need an SDK addition upstream in `pipelex-sdk-js`.

Conventions:

- **Bundle source**: ship `.mthds` files in the repo at `methods/<name>/main.mthds` and read them at request time with `fs.readFile`. Do **not** inline bundle TOML as a string in `.ts` — bundles are first-class.
- **One client**: instantiate `PipelexApiClient` once via `getPipelexClient()`. Never `new PipelexApiClient()` directly in actions or components.
- **Narrow at the boundary**: the SDK returns loosely-typed output. Always pass the whole `RunResults` through a `parseXxx(results)` narrower in `src/types/` that reads it via `findOutputContent` and throws a tagged subclass of `Error` (e.g. `BadPipelineOutputError`) on shape mismatch. Do not `as` your way through. The narrower is the same for both modes — the blocking response is adapted onto `RunResults` so it flows through the `pipe_output` arm.
- **Return classified errors, don't throw across the server→client boundary**: the shared helpers return `{ ok: true, ... } | { ok: false, error: PipelineError }`. Throwing works in dev but Next.js production builds strip server-action error messages to opaque digests, which destroys the developer-facing error UX. `executeBlockingRun` / `startDurableRun` / `pollDurableRun` wrap the SDK call in `try/catch`, hand the caught value to `classifyPipelineError(err, env)`, and return the structured error. Render it client-side with `<ErrorDisplay>`.
- **Classification stays server-side, in the helpers.** `classifyPipelineError` `instanceof`-matches SDK error classes, which only exist server-side (they're stripped to opaque digests crossing the boundary) — so it runs inside the helpers, never on a poll/blocking result the client received. The durable `failed` poll constructs a `RunFailedError` from the result lookup and classifies it there too.
- **Add new error kinds in `src/lib/errors.ts`**: extend `PipelineErrorKind`, add an `instanceof` branch in `classifyPipelineError` (import the class from `@pipelex/sdk`), and cover it in `src/lib/errors.test.ts`. Keep `classifyPipelineError` pure — env passed in by caller, no `process.env` reads inside. The dual-mode kinds (`execute_timeout`, `run_still_running`, `run_failed`, `run_timeout`, `lifecycle_unavailable`) follow this pattern. Two exceptions build a `PipelineError` inline (no thrown error to classify): pre-flight validation (`file_too_large`, `unsupported_file_type`, `bad_request`) in a Server Action, and the client-side poll ceiling (`buildClientTimeoutError`, kind `run_timeout`) in `useRun`.
- **`lifecycle_unavailable` has two sources.** A 404 from a bare runner with no run store arrives as the SDK's `RunLifecycleUnavailableError` (`instanceof` branch → `classifyLifecycleUnavailable`); a `/start` against a deployment whose orchestrator is blocking-only (the in-process `direct` mode) arrives as a 400 `ApiResponseError` with `error_type: "StartRequiresAsyncOrchestration"`, matched by an `errorType` branch in `classifyResponse` → `classifyStartRequiresAsync` (same pattern as `classifyServerError`'s `errorType` switch). Both restate the runtime's vocabulary ("orchestration mode", "fire-and-forget") in the starter's term — **durable execution** — and point at Blocking mode; the messages differ because the root causes differ (no route vs. blocking-only orchestrator).
- **`apiMessage` shows the raw API response alongside our interpretation.** When `classifyPipelineError` _re-frames_ a server message (rather than echoing it), set `apiMessage` to the verbatim `err.serverMessage`; `<ErrorDisplay>` renders it as its own "What the Pipelex API returned" block so the template demonstrates raw-response-vs-handled-error UX side by side. Omit it when our `message` already is the server's text. `classifyStartRequiresAsync` is the canonical example.
- **The blocking cap is a 502/504, not the SDK timeout (verified live).** Behind the hosted gateway, a synchronous `execute` that overruns ~30s comes back as `ApiResponseError` HTTP 502/504 ("the runner did not complete the request") — a _response_, so the SDK does **not** raise `PipelineExecuteTimeoutError` (its own client-side timeout is longer). `executeBlockingRun` passes `{ blocking: true }` to `classifyPipelineError`, which maps a blocking-path 502/504 to `execute_timeout` (the "switch to Durable" guidance). The `PipelineExecuteTimeoutError` branch is kept for configs where the SDK timeout fires first. A 502/504 on the **durable** poll path is left as a transient `server_error` — the `blocking` flag scopes the mapping.
- **Transport-reject wrapping lives in `useRun`, not the forms.** Even though a helper's catch turns application errors into `{ ok: false, error }`, the awaited Server Action call itself can still reject (network drop, dev server crash, stale Server Action ID after a deploy). The hook wraps every awaited boundary (start, blocking, each poll) in `try/catch` → `classifyTransportError(err)`, so the rejection becomes a `<ErrorDisplay>` error instead of escaping to React's error boundary. Forms just call `run(input)`.

### File & image inputs

Text inputs are plain strings. File inputs (PDFs, images) take one extra step, demonstrated by the PDF example:

- **Encode client-side, never cross the boundary with a `File`.** The browser reads the `File` into a base64 data URL via `fileToDataUrl` (`src/lib/clientFile.ts`). Server Actions accept only serializable arguments — pass the `string` data URL + filename, never a `File`, `Blob`, or `FormData`.
- **Validate, then build the envelope server-side.** The Server Action calls `validateDataUrl` (authoritative MIME + size gate) and `buildDocumentInput` (`src/lib/fileEncoding.ts`), which produces a Pipelex `Document` input: `{ concept: "Document", content: { url, filename, mime_type } }`. Images use the same shape with `concept: "Image"`. The Pipelex API decodes the base64 data URL server-side.
- **Re-validate on the server.** The client may also pre-check for fast UX feedback, but that is trivially bypassed — the Server Action's `validateDataUrl` call is the real gate.
- **Mind the Server Action body limit.** Next.js caps Server Action bodies at 1 MB by default; base64 inflates payloads ~37%. `next.config.js` raises `serverActions.bodySizeLimit`, and `MAX_PDF_BYTES` in `fileEncoding.ts` caps the raw file size with margin.
- **File/image outputs come back as a URL** — a storage URL or a base64 data URL — in the output content. On the hosted durable path the runtime returns both a non-web `url` (`pipelex-storage://…`) and a web `public_url` (a signed S3 URL); `parseGeneratedImage` keeps both and validates the one `<ImageResult>` actually displays (`publicUrl ?? url`), so a non-web `url` can't ship a silently-broken image. Render it directly in an `<img>` (see `ImageResult.tsx`).

To add a new pipeline:

1. Create `methods/<name>/main.mthds` (use `/mthds-build`).
2. Add `loadXxxBundle()` in `src/lib/loadBundle.ts` (or one helper per bundle).
3. Add the type + narrower `parseXxx(results: RunResults)` (via `findOutputContent`, throwing a tagged error subclass) in `src/types/<name>.ts`.
4. Add the action **trio** in `src/actions/run<Name>Pipeline.ts` — `run<Name>Blocking` (→ `executeBlockingRun`), `start<Name>Run` (→ `startDurableRun`), `poll<Name>Run` (→ `pollDurableRun`) — sharing a `buildOptions` closure and the pre-flight guard.
5. Wire it from a component: `useState<ExecutionMode>(DEFAULT_EXECUTION_MODE)`, `useRun({ mode, blocking, start, poll })`, then render `<ModeToggle>` (disabled while running), `<RunStatus>` while running, `<ErrorDisplay>` on error, and the result component on done — all keyed off `state.phase`. See `src/components/EntityForm.tsx` for the canonical pattern.

## Component Conventions

- **Named exports** for all components: `export function MyComponent() {}`
- **Default exports** only for App Router pages/layouts (`export default function Page()`)
- Add `"use client"` only when the component needs hooks, event handlers, or browser APIs
- Use the `@/` path alias for all imports (maps to `./src/`)
- **No barrel files** (`index.ts` re-exports) — import directly from the source file
- **No relative imports** across folders — always use `@/`

## Code Style (Prettier)

Configured in `.prettierrc`:

- Double quotes
- Semicolons
- Trailing commas (all)
- Print width: 100
- Tab width: 2 (spaces)

Enforced via Husky + lint-staged on commit.

## Testing

### Unit (Vitest, default)

- **Runner**: Vitest with happy-dom environment
- **Library**: `@testing-library/react` + `@testing-library/jest-dom`
- **Location**: co-located `.test.ts` / `.test.tsx` next to the source file
- **Queries**: prefer accessible queries (`getByRole`, `getByLabelText`) over `getByTestId`
- **Mocking the SDK**: mock `@/lib/pipelexClient` with `vi.mock`, returning the methods the code under test calls — `{ execute, start, getRunStatus, getRunResult }` (each a `vi.fn()`). Do **not** mock the `@pipelex/sdk` package directly — it's harder to wire as a constructor and the indirection adds noise. **Use `mockResolvedValueOnce`/`mockRejectedValueOnce`, not the persistent `mockResolvedValue`/`mockRejectedValue`, on these spies**: a persistent resolved mock followed by a rejected one on the same spy trips vitest's async-result tracking and reports a spurious unhandled rejection. (The persistent `vi.fn().mockResolvedValue(...)` on the `loadBundle` mock is fine — it's resolve-only.)
- **Mocking the actions (form/hook tests)**: mock `@/actions/run<Name>Pipeline` returning `{ run<Name>Blocking, start<Name>Run, poll<Name>Run }` as `vi.fn()`s. `useRun`'s durable poll loop runs on `setTimeout`/`setInterval`, so durable form/hook tests use `vi.useFakeTimers()` and drive with `await vi.advanceTimersByTimeAsync(...)` inside `act()`, querying synchronously (`getByRole`/`getByText`) — `findBy`/`waitFor` conflict with fake timers. `PdfForm` keeps **real** timers (its `FileReader` encoding needs them) and has the durable poll complete on the first tick so `findBy` works.

### E2E (Playwright)

- **Location**: `e2e/*.spec.ts`
- **Optional, and gated.** The three live-API specs (`extract`, `summarize-pdf`, `generate-image`) hit the live Pipelex API using `PIPELEX_API_KEY` from `.env.local` and cost an LLM call each. Two guards make this safe: (1) they **auto-skip** when no key is set — `requireLiveApi()` in `e2e/liveApi.ts` calls `test.skip()`, and `playwright.config.ts` loads `.env.local` via `@next/env` so a configured key is visible to the runner; (2) `make test-e2e` **prompts for confirmation** before spending (the `confirm-live-e2e` target — skipped in CI / non-TTY shells, bypass with `CONFIRM=1`). The fourth spec, `error-display`, tests the offline error UX — it needs no key, is **not** guarded, and runs out of the box.
- **Excluded from `make all`** — run explicitly with `make test-e2e`
- **First-time setup**: `npx playwright install chromium`
- **Excluded from**: `vitest.config.mts` (`exclude: ["e2e/**", ...]`) and the base `tsconfig.json` (`exclude: [..., "e2e"]`) so unit-test infra and Next's build typecheck don't pick up Playwright specs
- **Still type-checked and linted**, just not by the base config: `tsconfig.e2e.json` (a thin `extends` of the base, scoped to `e2e/**`) type-checks the specs via `make typecheck`, and `lint` (`eslint .`) covers the whole repo, e2e specs included — so `make all` lints exactly the files the pre-commit hook (lint-staged) does, and never passes while the commit gate fails. Keeping a dedicated e2e tsconfig out of the base is the pipelex-sdk-js `tsconfig.test.json` pattern — it gives the specs a type/lint safety net without making Next's build choke on Playwright globals.

## Scripts (via Make)

| Target              | Purpose                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `make dev`          | Start the Next.js dev server                                                                   |
| `make build`        | Production build                                                                               |
| `make lint`         | ESLint                                                                                         |
| `make format`       | Prettier write                                                                                 |
| `make format-check` | Prettier check (CI)                                                                            |
| `make typecheck`    | `tsc --noEmit` (app) + `tsc -p tsconfig.e2e.json` (e2e)                                        |
| `make test`         | Vitest single pass                                                                             |
| `make agent-test`   | Vitest, silent on success (preferred for AI agents)                                            |
| `make test-e2e`     | Optional Playwright e2e (live API, costs an LLM call; prompts first, auto-skips without a key) |
| `make check`        | lint + format-check + typecheck                                                                |
| `make all`          | check + test + build (does **not** include e2e)                                                |
| `make use-local`    | Pack and install sibling `../pipelex-sdk-js` (alias: `ul`)                                     |
| `make use-npm`      | Restore the npm-published `@pipelex/sdk` package (alias: `un`)                                 |

## Local SDK development (`use-local`)

When working on this starter alongside the SDK, use `make use-local` to install `../pipelex-sdk-js` (sibling) into `node_modules/@pipelex/sdk` instead of the npm package. The target builds `../pipelex-sdk-js`, packs it with `npm pack`, then installs the resulting tarball.

We use a tarball install rather than a symlink (`ln -s`) because Next.js 16's Turbopack does not follow symlinked workspace packages — both `npm run dev` and `npm run build` fail with `Module not found: Can't resolve '@pipelex/sdk'` against a symlinked entry. **Re-run `make use-local` after every SDK edit** to pick up changes. `make use-npm` restores the published version.

## Workflow Rules

**After any code change, run `make all`.** It runs `check` (lint + format-check + typecheck) + `test` + `build`, which catches the four failure classes that block CI: ESLint violations, Prettier formatting drift, TypeScript errors, and broken unit tests / production build. Do not declare a task done if `make all` doesn't pass cleanly.

If `make format-check` fails, run `make format` to auto-fix and re-run `make all`. Don't hand-edit files to satisfy Prettier — let the formatter do it.

Other targets that matter:

- **`make agent-test`** instead of `make test` when an AI agent runs the suite. It's silent on success; only failures hit the context.
- **`make test-e2e`** before shipping changes that touch the SDK call path (`src/actions/`, `src/lib/pipelexClient.ts`, `src/lib/loadBundle.ts`, `src/lib/blockingRun.ts`, `src/lib/durableRun.ts`, `src/lib/runOutput.ts`, `src/lib/errors.ts`, `src/lib/fileEncoding.ts`, `src/hooks/useRun.ts`, `methods/`). Unit tests mock the SDK; only e2e exercises the real API, the durable poll loop, and the rendered error UX. Not part of `make all` (costs an LLM call per run).
- **`make use-local`** after editing the sibling `../pipelex-sdk-js` SDK, before re-running tests or the dev server. The tarball install only refreshes when the target re-runs.

## Git Workflow

- **PR target branch**: `main`.

## Anti-patterns to Avoid

- **No bundle TOML inlined in `.ts` files** — bundles live in `methods/<name>/main.mthds`.
- **No raw `fetch()` to the Pipelex API** — always go through `PipelexApiClient`. (If you find a missing capability in the SDK, fix it upstream in `pipelex-sdk-js`, don't bypass it here.)
- **No `as ExtractedEntities` casts on SDK output** — write or extend a `parseXxx()` narrower instead.
- **No `try/catch` that swallows errors silently** in narrowers — throw a tagged subclass. The action's outer catch routes it through `classifyPipelineError`.
- **No `throw new Error(...)` from server actions for known failure modes** — return `{ ok: false, error: classifyPipelineError(err, env) }` so the structured error survives the server→client boundary in production.
- **No relative imports** across folders — always `@/`.
- **No default exports** for components (only for App Router pages/layouts).
- **No `index.ts` barrel files**.
- **No inline styles** — use Tailwind classes.

## Gotchas

- **Husky `prepare` warning**: `npm install` prints `.git can't be found` if you install before `git init`. Harmless — just re-run `npm install` after `git init` to wire `.husky/_/`.
- **Renaming App Router directories**: delete `.next/` before running `make check` — stale type references in `.next/types/` will fail typecheck.
- **`next-env.d.ts` is generated** (gitignored). Next regenerates it on dev/build. Don't edit by hand.
- **Tailwind `content` globs** are scoped to `src/app/` and `src/components/`. If you add a new top-level dir with classes, extend `tailwind.config.ts`.
