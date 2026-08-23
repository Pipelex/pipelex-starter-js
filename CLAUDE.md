# pipelex-starter-js

Minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

This repo is a **reference template**. Keep it small, clear, and high-quality — clarity beats features. When adding anything, ask: "would I want every consumer of this template to inherit this?"

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS 3 (minimal, no design system — keep classes inline and obvious), plus the form kernel's shadcn semantic tokens, which the kernel's controls require
- **Testing**: Vitest 4 + Testing Library (happy-dom) for unit; Playwright for e2e
- **Linting**: ESLint 9 (flat config via `eslint-config-next`)
- **Formatting**: Prettier 3
- **Git hooks**: Husky + lint-staged
- **SDK**: [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) (`PipelexApiClient`)
- **Forms**: [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form) — the headless kernel (`.`) plus its React control set (`./react`). Every method input is rendered from the method's own contract

## Project Structure

```
methods/                      # the source of truth — everything in src/generated/ comes from here
  extract-entities/main.mthds # text → entities pipeline (TOML)
  summarize-pdf/main.mthds    # PDF Document → structured summary
  generate-image/main.mthds   # text prompt → image (gpt-image-1-mini)
public/
  sample-invoice.pdf          # sample PDF the PDF example loads out of the box
scripts/                      # native-Node TypeScript (node --experimental-strip-types)
  codegen.mts                 # npm run codegen — CLI entry, one line over lib/generate
  codegen-check.mts           # npm run codegen:check — CLI entry over lib/check
  codegen-verify.mts          # npm run codegen:verify — CLI entry over lib/verify
  lib/                        # the behavior, importable so it can be tested
    generate.mts              # runGenerate + writeTree — regenerates src/generated/
    check.mts                 # runCheck + checkMethod + summarizeVerdicts — the offline gate
    verify.mts                # runVerify — the keyed semantic gate
    shared.mts                # paths, tree walk, sha256, sources.json — shared by all three
    *.test.mts                # vitest over the lib (vitest's glob matches .mts)
src/
  config.ts                   # ExecutionMode + DEFAULT_EXECUTION_MODE (client-safe)
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — a trio per pipeline
    runExtractEntitiesPipeline.ts         # runExtractEntitiesBlocking + startExtractEntitiesRun + pollExtractEntitiesRun
    runSummarizePdfPipeline.ts  # …Blocking + start… + poll…
    runGenerateImagePipeline.ts # …Blocking + start… + poll…
  generated/                  # COMMITTED and GENERATED — never hand-edit (see "Generated types")
    extract-entities/
      types.ts                # zod schemas + z.infer types, stamped
      binder.ts               # parseXxx / serializeXxx over those schemas, stamped
      contracts.ts            # PIPE_IO_CONTRACTS — what the input forms render from (unstamped)
      codegen.lock            # pipelex trust-chain lock, written verbatim
      sources.json            # starter-owned sidecar — SHA-256 of each source .mthds + derived
    summarize-pdf/ …          # same set per method
    generate-image/ …
  lib/
    pipelexClient.ts          # PipelexApiClient singleton factory
    loadBundle.ts             # fs.readFile of the .mthds bundles
    blockingRun.ts            # executeBlockingRun — the blocking `execute` path (server)
    durableRun.ts             # startDurableRun + pollDurableRun — the durable start/poll path (server)
    wireOutput.ts             # wireOutput + schema-guided dropWireNulls + describeSchemaFailure (pure; `import "server-only"` build-enforces the boundary)
    errors.ts                 # classifyPipelineError + classifyTransportError + PipelineError model
    serverEnv.ts              # readClassifyEnv — the ClassifyEnv process.env read (server)
    fileEncoding.ts           # data-URL MIME + size validation (pure)
    usageReport.ts            # tokens_usages → the render-ready cost report (pure)
    clientFile.ts             # browser File → base64 data URL (client)
  hooks/
    useRun.ts                 # unified blocking|durable state machine (client)
    useRunInputs.ts           # form values + derived fields + readiness + wire shape (client)
  components/
    ExampleTabs.tsx           # client component — tab switcher for the 3 examples
    RunInputsForm.tsx         # client component — the one kernel composition (FieldRenderer per field)
    EntityForm/PdfForm/ImageForm.tsx        # client components (per-example chrome, mode-agnostic)
    ModeToggle.tsx            # client component — Blocking|Durable segmented control
    RunStatus.tsx             # live-status card (spinner + status label + elapsed)
    EntityResult/PdfSummaryResult/ImageResult.tsx  # server components (render output)
    CostReport.tsx            # per-run token usage + cost breakdown
    ErrorDisplay.tsx          # server component (renders classified PipelineError)
  types/                      # the adapter layer over src/generated/ — no shapes re-declared
    pipelineError.ts          # BadPipelineOutputError + BadImageOutputError (tagged)
    extractEntitiesPipeline.ts          # re-exports ExtractedEntities + parseEntities(RunResults)
    summarizePipeline.ts      # re-exports DocumentSummary + parseDocumentSummary(RunResults)
    generateImagePipeline.ts  # aliases Image as GeneratedImage + parseGeneratedImage(RunResults)
e2e/
  extract.spec.ts             # Playwright e2e (hits live API)
  summarize-pdf.spec.ts
  generate-image.spec.ts
```

### What lives where

- **`methods/`** — `.mthds` bundles (TOML). Treat them as first-class artifacts, not embedded strings. Use the `/mthds-build`, `/mthds-edit`, `/mthds-check`, `/mthds-run` skills from the `mthds-plugins` marketplace to author and validate them.
- **`src/actions/`** — Server Actions (`"use server"`). The only place that calls the Pipelex SDK. Each pipeline exports a **trio**: `run<Name>Blocking` (the blocking `execute` path), `start<Name>Run` + `poll<Name>Run` (the durable start/poll path). They are thin: pre-flight guard → build options → delegate to `executeBlockingRun` / `startDurableRun` / `pollDurableRun`.
- **`src/lib/`** — Server-side utilities. No React. `runInputs.ts` is pure (kernel core only, no `process.env`, no Node built-ins) so both sides import it — that shared import is the point. The two execution helpers `blockingRun.ts` and `durableRun.ts` are server-only (they construct the SDK client and read `process.env` through `serverEnv.ts`'s shared `readClassifyEnv`, so the two paths can't drift on classification env); `wireOutput.ts` is pure (it reads `main_stuff` and normalizes it — the generated schema does the shape-checking) and carries `import "server-only"`, so a `"use client"` import of a narrower fails the Next build instead of shipping zod plus every generated schema to the browser (vitest aliases the package to `vitest.server-only-stub.ts` so unit tests keep passing). Deliberate client-touching exceptions: `errors.ts` (its types cross the server→client boundary, and `classifyTransportError` + `buildClientTimeoutError` run client-side), and `clientFile.ts` (a browser `FileReader` wrapper imported only by client components). `fileEncoding.ts` is pure (no React, no `process.env`) so it is safe to import from either side. Because `errors.ts` is bundled into the client, it imports the SDK error classes from **`@pipelex/sdk`**. That barrel is client-safe — `PipelexApiClient` is fetch-based and pulls no `node:fs` into the graph — so a client bundler handles it without breaking `make build`. Only `pipelexClient.ts` (server-only) constructs `PipelexApiClient` from `@pipelex/sdk`. The forms import `blockingRun`/`durableRun` **types only** (`import type`), so no server code leaks into the client bundle.
- **`src/hooks/`** — `useRun<TInput,TOutput>`, the unified client state machine (`idle → running → done|error`) that dispatches blocking vs durable by `mode`. Holds the durable poll loop, the staleness token, the elapsed ticker, the wall-clock ceiling, the `classifyTransportError` wrapping, and the **transient-failure budget** (a momentary 5xx/network blip on one poll tick — flagged `transient` by `pollDurableRun` — or a rejected poll await is retried up to `MAX_TRANSIENT_POLL_FAILURES`, surfacing `health: "retrying"` meanwhile, rather than abandoning a run that's still completing server-side). The running state's `health` field (`RunHealth | null`) names _why_ the poll loop is in a resilient state so `<RunStatus>` can show reassuring, cause-specific copy instead of one alarming "degraded" note: `"reconnecting"` when the **server** reported `degraded` (its status endpoint served a last-known DB status because Temporal was unreachable), `"retrying"` for a **client-side** poll blip, `null` when polling cleanly. A durable `start` that returns `lifecycle_unavailable` (the configured URL doesn't serve the durable run lifecycle) surfaces as an explicit error — `useRun` never silently downgrades durable to blocking. Forms never branch on mode — they just call `run(input)`.
- **`src/components/`** — React components. `"use client"` only when the component uses hooks, event handlers, or browser APIs (`ModeToggle` does; `RunStatus` is a pure render).
- **`src/types/`** — the **adapter layer over `src/generated/`**, not a place where shapes are declared. Each `parseXxx(results: RunResults)` hands `wireOutput(results)` to the binder generated from that method's own bundle, and translates a thrown `ZodError` into the template's tagged error model; the type itself is re-exported from the generated `types.ts`. Hand-written validation survives only where it adds semantics the concept does not declare — `parseGeneratedImage`'s web-renderable-URL check is the single example. Narrowers throw on mismatch; that's deliberate (system boundary).

## Generated types (`src/generated/`)

**The output shapes are projected from the `.mthds` bundles, not hand-written.** `npm run codegen` sends every method under `methods/` to `POST /v1/codegen` and writes back, byte-for-byte, a `types.ts` (zod schemas plus their `z.infer` types), a `binder.ts` (`parseXxx` / `serializeXxx` over those schemas), and a `codegen.lock`. The narrowers in `src/types/` are thin adapters over those binders, so a bundle and its TypeScript cannot drift apart. The same run also asks `POST /v1/validate` for the method's IO contracts and writes a `contracts.ts` — the **input** side of the same idea, and what the forms render from (see [`docs/input-form.md`](docs/input-form.md)). Design rationale and the decisions behind it: [`docs/codegen.md`](docs/codegen.md).

| Command                                          | Needs a key?                                   | When                                           |
| ------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| `npm run codegen` / `make codegen`               | Yes, plus a base URL that serves `/v1/codegen` | After editing any `.mthds` file                |
| `npm run codegen:check` / `make codegen-check`   | No — pure hashing, fully offline               | Every `make check`, so every `make all`        |
| `npm run codegen:verify` / `make codegen-verify` | Yes                                            | Before a release, or after touching `methods/` |

The rules below are each load-bearing — breaking one produces a wrong verdict rather than an error:

- **Never hand-edit anything under `src/generated/`.** Artifacts are written verbatim and each carries a stamp hashing its own body, so any edit — a reformat included — makes `codegen:check` report `hand-edited` and fails `make check`. To customize a generated type, wrap it rather than edit it: `src/types/` is that wrapper layer.
- **`src/generated/` is excluded from Prettier and ESLint on purpose** (`.prettierignore`, `eslint.config.mjs`, plus `--no-warn-ignored` on lint-staged's ESLint entry). The emitter targets Prettier's defaults (80 columns); this repo prints at 100, so `prettier --write` would rejoin its lines and break every stamp. Do not "fix" that exclusion. `tsc` still covers the trees in full — they live under `src/` — and that is the check that matters.
- **Two staleness gates, because they answer different questions.** `codegen:check` proves each tree still matches its own lock, and compares `sources.json` (the SHA-256 of every source `.mthds` in the closure) against the bundles on disk — that is what catches "edited a bundle, forgot to regenerate". It cannot know whether the _engine_ would produce something different today; `codegen:verify` asks the server exactly that, comparing live `crate_fingerprint`s against the committed locks and writing nothing.
- **Exit codes are a contract**: `0` current, `1` drift or stale sources, `2` no verdict (a missing or malformed lock). `make check` fails on `1` and `2` alike.
- **An engine bump rewrites every artifact.** `engine_version` rides in the stamp, so an upstream pipelex release restamps the whole tree with zero semantic change (`crate_fingerprint` is the semantic signal, and it stays put). A whole-tree diff after such a release is correct behaviour, not drift — which is why `codegen:verify` reports an engine difference as a **note**, not a failure, leaving the restamp to a deliberate commit.
- **Regeneration runs against the default hosted URL.** `POST /v1/codegen` is served on `api.pipelex.com`, so `npm run codegen` needs a key and nothing else — no base-URL override. `codegen:check` needs no server at all.
- **Field names stay wire-native snake_case, deliberately** — `doc_type`, `key_points`, `public_url`, `mime_type` travel unchanged from the bundle to the components. Do **not** add a camelCase mapping layer: a hand-maintained mirror of a generated shape is precisely the duplicated surface this removes.
- **`contracts.ts` is the one artifact the lock does not sign, and that is deliberate.** The SDK's orphan rule is "a _stamped_ file the lock does not track", and the writer deletes orphans — so a stamped `contracts.ts` would silently vanish on every regeneration. Its SHA-256 lives instead in `sources.json`'s `derived` map, written by the generator from the content it wrote and compared by `codegen:check`; `codegen:verify` re-fetches `/v1/validate` and compares the rendered bytes. It is still never hand-edited.

## Pipelex Integration Pattern

**Two execution modes, one hook.** Every example runs in either mode, chosen per-example at runtime via a `<ModeToggle>`:

- **Blocking** (`client.execute`) — one synchronous request. Simple, but behind the hosted gateway it is cut off at ~30s, so long pipelines surface a classified `execute_timeout` error. Use it to _see_ that limit.
- **Durable** (`client.start` then poll) — survives the ~30s cap and streams coarse live status. Hosted-safe everywhere; the default (`NEXT_PUBLIC_EXECUTION_MODE`, defaults `"durable"`). When the configured URL doesn't serve the run lifecycle it surfaces an explicit `lifecycle_unavailable` error (naming the endpoint URL, steering to `PIPELEX_BASE_URL`) — no silent downgrade.

The forms are **mode-agnostic** — they call `useRun({ mode, blocking, start, poll })` and render by `state.phase`. Only the unified hook knows which Server Actions to call.

**No method input is written by hand.** Each form renders its inputs from the method's committed contract through the `@pipelex/mthds-form` kernel — `useRunInputs(CONTRACT)` for values/readiness/wire shape, `<RunInputsForm>` for the controls — and the _same_ kernel gate runs again inside the Server Action, which is the trust boundary. One implementation (`src/lib/runInputs.ts`), two call sites, zero drift; the per-input guards that used to sit on both sides are deleted, not kept as belt-and-braces. Full reference: [`docs/input-form.md`](docs/input-form.md).

```ts
// src/actions/runExtractEntitiesPipeline.ts — a thin trio per pipeline
"use server";
import { PIPE_IO_CONTRACTS } from "@/generated/extract-entities/contracts";
import { gateRunInputs, requireContract } from "@/lib/runInputs";
import { loadExtractEntitiesBundle } from "@/lib/loadBundle";
import { parseEntities, type ExtractedEntities } from "@/types/extractEntitiesPipeline";
import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";
import {
  pollDurableRun,
  startDurableRun,
  type PollOutcome,
  type StartOutcome,
} from "@/lib/durableRun";
import type { StartOptions } from "@pipelex/sdk";

// The same generated contract the browser rendered the form from.
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");

// `execute` and `start` take the same options, so one closure drives both.
async function buildOptions(inputs: Record<string, unknown>): Promise<StartOptions> {
  return {
    pipe_code: "extract_entities",
    mthds_contents: [await loadExtractEntitiesBundle()],
    inputs,
  };
}

// The argument is the schema-shaped data dict, not a hand-typed `text: string`.
export async function runExtractEntitiesBlocking(
  data: Record<string, unknown>,
): Promise<BlockingOutcome<ExtractedEntities>> {
  const gated = gateRunInputs(CONTRACT, data); // the kernel's 4-step gate → a bad_request PipelineError, or the wire inputs
  if (!gated.ok) return gated;
  return executeBlockingRun(() => buildOptions(gated.inputs), parseEntities);
}
export async function startExtractEntitiesRun(
  data: Record<string, unknown>,
): Promise<StartOutcome> {
  const gated = gateRunInputs(CONTRACT, data);
  if (!gated.ok) return gated;
  return startDurableRun(() => buildOptions(gated.inputs));
}
export async function pollExtractEntitiesRun(
  runId: string,
): Promise<PollOutcome<ExtractedEntities>> {
  return pollDurableRun(runId, parseEntities);
}
```

The shared helpers in `src/lib/` own the SDK call + `classifyPipelineError` (server-side, where the SDK error classes still `instanceof`-match): `executeBlockingRun` wraps `client.execute` and **adapts its response onto `RunResults`** (`{ pipeline_run_id, main_stuff }`, reading the SDK-resolved `.main_stuff`) so one narrower serves both modes; `startDurableRun` wraps `client.start`; `pollDurableRun` does one `getRunStatus` (+ `getRunResult` on a terminal status) tick.

**One narrower contract — `parseXxx(results: RunResults)`, an adapter over the method's generated binder.** Both modes deliver the output the same way, so the narrower reads one field and hands it straight to the schema projected from the bundle:

- **`main_stuff`** is the single main output's **content directly** (confirmed live — _not_ a `{ concept, content }` wrapper, _not_ a working-memory map). On the durable path it is the `main_stuff.json` artifact; on the blocking `execute` path `@pipelex/sdk` resolves it out of the working memory via the response's `main_stuff_name` (its `PipelexExecuteResult.main_stuff` getter), so both paths carry the same resolved content.
- **`src/lib/wireOutput.ts` is the whole plumbing, and it validates nothing itself** — the generated zod schema owns that. `wireOutput(results)` reads `main_stuff` and normalizes it in one step; `describeSchemaFailure(err, typeName)` renders a `ZodError` through `z.prettifyError` into the field-by-field list `<ErrorDisplay>` shows under Details, because a `ZodError`'s own `.message` is a JSON dump of its issue array and unreadable in a UI.
- **`dropWireNulls` is a workaround with an expiry, not a design.** The ts-zod projection emits a non-required concept field as `.optional()`, which in zod means `| undefined` and **rejects `null`** — but the runtime serializes an unset optional field as an explicit `null`, so without this step the generated schemas reject the runtime's own payload (verified against a live image run). It normalizes **values, never names** — it re-declares no field, so it is not the duplicated surface codegen removes — and it is deletable the day the emitter emits `.nullish()`. Reported upstream to pipelex; the full evidence trail is in [`docs/codegen.md`](docs/codegen.md).
- **The strip is schema-guided, and that is load-bearing.** `dropWireNulls(value, schema)` takes the concept's generated zod schema and descends only declared shapes: an object field is dropped only when the schema says a `null` there means absence (it accepts `undefined`, rejects `null`, and carries no `.default()` to invent), arrays and record _values_ are descended for their declared element type, and anything opaque — `z.unknown()`, `z.any()`, a union, a `z.record()`'s keys — is passed through untouched. A blind deep strip is precisely what the ts-zod emitter's own design note rules out: inside a `z.record()` a `null` is _data_, and stripping it deletes a value before the schema can object, silently and with a green check. Descent is also depth-capped (`MAX_WIRE_DEPTH`): resolving `z.lazy()` is what lets the walk see through a concept reference, and it is also what makes a self-referential concept unbounded, so past the cap the value passes through untouched and the generated schema still owns the verdict. `src/lib/wireOutput.test.ts` pins each of those cases. Practical consequence: **a narrower passes its schema, not just its binder** — `parseXxx` imports `XxxSchema` alongside `parseXxx` from the generated tree.

There is no `pipe_output` search arm and no `findOutputContent` predicate anymore. The SDK resolving `.main_stuff` on both paths removed the shape-guessing (and with it the old "blocking vs durable disagree on which output is main" latent bug), and `Schema.parse` subsumed the predicate matching — it rejects arrays, primitives, and `null` with a message naming the offending field, which "not found" never could. **Limitation:** `RunResults` surfaces only the main output, not the whole `working_memory` — fine here (every example wants the _main_ output), but a future durable pipeline needing an _intermediate_ stuff would need an SDK addition upstream in `pipelex-sdk-js`.

Conventions:

- **Bundle source**: ship `.mthds` files in the repo at `methods/<name>/main.mthds` and read them at request time with `fs.readFile`. Do **not** inline bundle TOML as a string in `.ts` — bundles are first-class.
- **One client**: instantiate `PipelexApiClient` once via `getPipelexClient()`. Never `new PipelexApiClient()` directly in actions or components.
- **Narrow at the boundary, but never re-declare the shape**: the SDK returns loosely-typed output, so always pass the whole `RunResults` through a `parseXxx(results)` narrower in `src/types/`. That narrower hands `wireOutput(results)` to the generated binder and translates the thrown `ZodError` into a tagged subclass of `Error` (e.g. `BadPipelineOutputError`) via `describeSchemaFailure`. Do not `as` your way through, and do not hand-write the shape it validates — the bundle already declares it and `npm run codegen` projects it. The narrower is the same for both modes: the blocking response is adapted onto `RunResults` with the SDK-resolved `main_stuff`, the same field the durable path delivers.
- **Return classified errors, don't throw across the server→client boundary**: the shared helpers return `{ ok: true, ... } | { ok: false, error: PipelineError }`. Throwing works in dev but Next.js production builds strip server-action error messages to opaque digests, which destroys the developer-facing error UX. `executeBlockingRun` / `startDurableRun` / `pollDurableRun` wrap the SDK call in `try/catch`, hand the caught value to `classifyPipelineError(err, env)`, and return the structured error. Render it client-side with `<ErrorDisplay>`.
- **Classification stays server-side, in the helpers.** `classifyPipelineError` `instanceof`-matches SDK error classes, which only exist server-side (they're stripped to opaque digests crossing the boundary) — so it runs inside the helpers, never on a poll/blocking result the client received. The durable `failed` poll constructs a `RunFailedError` from the result lookup and classifies it there too.
- **Inputs are gated, never hand-guarded.** Every action starts with `gateRunInputs(CONTRACT, data)` over the method's committed contract — the same gate the browser ran for the Run button — and returns its `{ ok: false, error }` unchanged. Do not add a per-input `if (!x) return badRequest()` beside it; that is the second rule this pattern exists to remove. What legitimately sits _after_ the gate is a check the contract cannot express — the PDF action's byte/MIME check is the one example, and it runs over the _gated_ inputs.
- **Add new error kinds in `src/lib/errors.ts`**: extend `PipelineErrorKind`, add an `instanceof` branch in `classifyPipelineError` (import the class from `@pipelex/sdk`), and cover it in `src/lib/errors.test.ts`. Keep `classifyPipelineError` pure — env passed in by caller, no `process.env` reads inside. The dual-mode kinds (`execute_timeout`, `run_still_running`, `run_failed`, `run_timeout`, `lifecycle_unavailable`) follow this pattern. Two exceptions build a `PipelineError` inline (no thrown error to classify): pre-flight validation (`file_too_large`, `unsupported_file_type`, `bad_request`) in a Server Action, and the client-side poll ceiling (`buildClientTimeoutError`, kind `run_timeout`) in `useRun`.
- **`lifecycle_unavailable` has two sources.** A 404 from a URL that doesn't serve the run-lifecycle routes arrives as the SDK's `RunLifecycleUnavailableError` (`instanceof` branch → `classifyLifecycleUnavailable`); a `/start` against a deployment whose orchestrator is blocking-only (the in-process `direct` mode) arrives as a 400 `ApiResponseError` with `error_type: "StartRequiresAsyncOrchestration"`, matched by an `errorType` branch in `classifyResponse` → `classifyStartRequiresAsync` (same pattern as `classifyServerError`'s `errorType` switch). Both restate the runtime's vocabulary ("orchestration mode", "fire-and-forget") in the starter's term — **durable execution** — and frame the configured URL as the problem (the hosted API always provides durable execution), steering to `PIPELEX_BASE_URL`; the messages differ because the root causes differ (no route vs. blocking-only orchestrator).
- **`apiMessage` shows the raw API response alongside our interpretation.** When `classifyPipelineError` _re-frames_ a server message (rather than echoing it), set `apiMessage` to the verbatim `err.serverMessage`; `<ErrorDisplay>` renders it as its own "What the Pipelex API returned" block so the template demonstrates raw-response-vs-handled-error UX side by side. Omit it when our `message` already is the server's text. `classifyStartRequiresAsync` is the canonical example.
- **The blocking cap is a 502/504, not the SDK timeout (verified live).** Behind the hosted gateway, a synchronous `execute` that overruns ~30s comes back as `ApiResponseError` HTTP 502/504 ("the runner did not complete the request") — a _response_, so the SDK does **not** raise `PipelineExecuteTimeoutError` (its own client-side timeout is longer). `executeBlockingRun` passes `{ blocking: true }` to `classifyPipelineError`, which maps a blocking-path 502/504 to `execute_timeout` (the "switch to Durable" guidance). The `PipelineExecuteTimeoutError` branch is kept for configs where the SDK timeout fires first. A 502/504 on the **durable** poll path is left as a transient `server_error` — the `blocking` flag scopes the mapping.
- **Transport-reject wrapping lives in `useRun`, not the forms.** Even though a helper's catch turns application errors into `{ ok: false, error }`, the awaited Server Action call itself can still reject (network drop, dev server crash, stale Server Action ID after a deploy). The hook wraps every awaited boundary (start, blocking, each poll) in `try/catch` → `classifyTransportError(err)`, so the rejection becomes a `<ErrorDisplay>` error instead of escaping to React's error boundary. Forms just call `run(input)`.

### File & image inputs

Text inputs are plain strings. File inputs (PDFs, images) take one extra step, demonstrated by the PDF example:

- **The kernel never uploads — the host does.** `DocumentField` fires `env.onDropFile(id, file)` and waits; the host encodes and writes a `FileValue` (`{url, filename}`) back at the field's **dotted path** with `setValueAtPath`. While the id sits in `env.uploadingIds` the kernel disables that control, which is why no staleness token is needed for a second selection mid-encode.
- **Encode client-side, never cross the boundary with a `File`.** The browser reads the `File` into a base64 data URL via `fileToDataUrl` (`src/lib/clientFile.ts`). Server Actions accept only serializable arguments — the value that crosses is the `string` data URL inside the form value, never a `File`, `Blob`, or `FormData`.
- **Validate server-side, then let the SDK upload.** The action runs the shape gate, then `checkDocumentBytes` over the **gated** inputs (`validateDataUrl` in `src/lib/fileEncoding.ts` — the authoritative MIME + size gate), then hands the inputs to `client.prepareInputs()`, which reads the method's declared signature, recognizes the input as a file, uploads the bytes to Pipelex storage, and rewrites the input to a small `pipelex-storage://` URI. **`prepareInputs` takes the kernel's `{concept, content}` envelope as readily as a bare value** (verified live) and preserves it on output, so no conversion sits at that seam. It throws a typed `InputPreparationError` _before any run starts_, and because the options closure runs inside `executeBlockingRun` / `startDurableRun`'s `try/catch`, that error is classified like any other SDK error.
- **The byte gate no-ops on a non-`data:` URL.** The kernel's file control offers "paste a URL instead", so a document input can arrive as an `https://` or `pipelex-storage://` reference carrying no bytes — nothing to size-check, and resolving it is `prepareInputs`' job.
- **Re-validate on the server.** The browser's own size check is an early exit that saves an encode (past `MAX_PDF_BYTES` the payload cannot fit the body limit anyway), reading the same exported constant — not a second rule. The Server Action's `validateDataUrl` call is the gate. One thing that looks like a duplicated guard and is not: the empty-MIME re-wrap before encoding is an _encoding_ fix for browsers that report `file.type === ""` for a valid PDF, and deleting it breaks those uploads.
- **Mind the Server Action body limit.** Next.js caps Server Action bodies at 1 MB by default; base64 inflates payloads ~37%. `next.config.js` raises `serverActions.bodySizeLimit`, and `MAX_PDF_BYTES` in `fileEncoding.ts` caps the raw file size with margin.
- **File/image outputs come back as a URL** — a storage URL or a base64 data URL — in the output content. On the hosted durable path the runtime returns both a non-web `url` (`pipelex-storage://…`) and a web `public_url` (a signed S3 URL); `parseGeneratedImage` keeps both and validates the one `<ImageResult>` actually displays (`public_url ?? url`), so a non-web `url` can't ship a silently-broken image. Render it directly in an `<img>` (see `ImageResult.tsx`).

To add a new pipeline:

1. Create `methods/<name>/main.mthds` (use `/mthds-build`).
2. Run `npm run codegen`. It writes `src/generated/<name>/` — the zod schemas, the binders, the IO contracts, the lock, and the sources sidecar — for every concept that method declares. Commit that tree alongside the bundle.
3. Add `loadXxxBundle()` in `src/lib/loadBundle.ts` (or one helper per bundle).
4. Add the adapter in `src/types/<name>.ts`: re-export the generated type, and write `parseXxx(results)` as the generated binder applied to `wireOutput(results)` inside a `try/catch` that rethrows `describeSchemaFailure(err, "<Name>")` as a tagged error subclass. Write no shape by hand — if you find yourself declaring fields, the bundle already declares them.
5. Add the action **trio** in `src/actions/run<Name>Pipeline.ts` — `run<Name>Blocking` (→ `executeBlockingRun`), `start<Name>Run` (→ `startDurableRun`), `poll<Name>Run` (→ `pollDurableRun`) — sharing a `buildOptions` closure and a module-level `CONTRACT = requireContract(PIPE_IO_CONTRACTS, "<domain>", "<pipe_code>")`. Each entry point opens with `gateRunInputs(CONTRACT, data)`.
6. Wire it from a component: `useRunInputs(CONTRACT, seed?)` for the inputs, `useState<ExecutionMode>(DEFAULT_EXECUTION_MODE)` and `useRun({ mode, blocking, start, poll })` for the run. Render `<RunInputsForm fields values onValuesChange disabled>`, `<ModeToggle>` (disabled while running), a submit button gated on `ready`, then `<RunStatus>` while running, `<ErrorDisplay>` on error, and the result component on done — all keyed off `state.phase`. Submit with `run(toData())`. **Write no form fields**; the contract declares them. See `src/components/EntityForm.tsx` for the canonical pattern, and `PdfForm.tsx` for the `onDropFile` file seam.

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
- **Optional, and gated.** The three live-API specs (`extract`, `summarize-pdf`, `generate-image`) hit the live Pipelex API using `PIPELEX_API_KEY` from `.env.local` and cost an LLM call each. Two guards make this safe: (1) they **auto-skip** when no key is set — `requireLiveApi()` in `e2e/liveApi.ts` calls `test.skip()`, and `playwright.config.ts` loads `.env.local` via `@next/env` so a configured key is visible to the runner; (2) `make test-e2e` **prompts for confirmation** before spending (the `confirm-live-e2e` target — skipped in CI / non-TTY shells, bypass with `CONFIRM=1`). Additionally, the blocking-cap case in `generate-image` skips unless `PIPELEX_BASE_URL` is a **hosted gateway** (`api[-env].pipelex.com`) — other endpoints may not enforce the ~30s blocking cap, so the spec would be flaky there. The fourth spec, `error-display`, tests the offline error UX — it needs no key and is **not** key-guarded; it probes the same URL the app will use (`PIPELEX_BASE_URL`, defaulting to the SDK's hosted URL) and skips when that API is reachable, so it runs exactly when the app would render `api_unreachable`.
- **Excluded from `make all`** — run explicitly with `make test-e2e`
- **First-time setup**: `npx playwright install chromium`
- **Excluded from**: `vitest.config.mts` (`exclude: ["e2e/**", ...]`) and the base `tsconfig.json` (`exclude: [..., "e2e"]`) so unit-test infra and Next's build typecheck don't pick up Playwright specs
- **Still type-checked and linted**, just not by the base config: `tsconfig.e2e.json` (a thin `extends` of the base, scoped to `e2e/**`) type-checks the specs via `make typecheck`, and `lint` (`eslint .`) covers the whole repo, e2e specs included — so `make all` lints exactly the files the pre-commit hook (lint-staged) does, and never passes while the commit gate fails. Keeping a dedicated e2e tsconfig out of the base is the pipelex-sdk-js `tsconfig.test.json` pattern — it gives the specs a type/lint safety net without making Next's build choke on Playwright globals.

## Scripts (via Make)

| Target                | Purpose                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `make dev`            | Start the Next.js dev server                                                                   |
| `make build`          | Production build                                                                               |
| `make lint`           | ESLint                                                                                         |
| `make format`         | Prettier write                                                                                 |
| `make format-check`   | Prettier check (CI)                                                                            |
| `make typecheck`      | `tsc --noEmit` (app) + `tsc -p tsconfig.e2e.json` (e2e) + `tsc -p tsconfig.scripts.json`       |
| `make codegen`        | Regenerate `src/generated/` from `methods/` (needs `PIPELEX_API_KEY`; **not** in `make all`)   |
| `make codegen-check`  | Prove `src/generated/` is current — offline, no key. Part of `make check`                      |
| `make codegen-verify` | Ask the engine whether the committed crates are still current (needs a key; not in `make all`) |
| `make test`           | Vitest single pass                                                                             |
| `make agent-test`     | Vitest, silent on success (preferred for AI agents)                                            |
| `make test-e2e`       | Optional Playwright e2e (live API, costs an LLM call; prompts first, auto-skips without a key) |
| `make check`          | lint + format-check + typecheck + codegen-check                                                |
| `make all`            | check + test + build (does **not** include e2e, `codegen`, or `codegen-verify`)                |
| `make use-local`      | Pack and install sibling `../pipelex-sdk-js` (alias: `ul`)                                     |
| `make use-npm`        | Restore the latest npm-published `@pipelex/sdk` package (alias: `un`)                          |

## Local SDK development (`use-local`)

When working on this starter alongside the SDK, use `make use-local` to install `../pipelex-sdk-js` (sibling) into `node_modules/@pipelex/sdk` instead of the npm package. The target builds `../pipelex-sdk-js`, packs it with `npm pack`, then installs the resulting tarball.

We use a tarball install rather than a symlink (`ln -s`) because Next.js 16's Turbopack does not follow symlinked workspace packages — both `npm run dev` and `npm run build` fail with `Module not found: Can't resolve '@pipelex/sdk'` against a symlinked entry. **Re-run `make use-local` after every SDK edit** to pick up changes.

`make use-npm` switches back, and it installs `@pipelex/sdk@latest` rather than plain `@pipelex/sdk` on purpose: the bare form re-resolves whatever range `package.json` already declares, so returning from a `use-local` session with a stale caret range would restore that range's newest match instead of the current release — a silent **downgrade**, since the SDK is pre-1.0 and `^0.a.b` never crosses a minor. The `@latest` tag fetches the published release and re-pins the range to it.

## Workflow Rules

**After any code change, run `make all`.** It runs `check` (lint + format-check + typecheck + the offline codegen check) + `test` + `build`, which catches the failure classes that block CI: ESLint violations, Prettier formatting drift, TypeScript errors, generated types that no longer match their bundles, and broken unit tests / production build. Do not declare a task done if `make all` doesn't pass cleanly.

**After editing anything under `methods/`, run `npm run codegen`.** `make check` compares each generated tree against a hash of the `.mthds` files it was projected from, so a bundle edit without a regeneration fails with "Run `npm run codegen` to regenerate." rather than shipping types that quietly lie. Regeneration needs `PIPELEX_API_KEY`; the default hosted URL serves `/v1/codegen`. Commit the regenerated tree in the same commit as the bundle edit.

If `make format-check` fails, run `make format` to auto-fix and re-run `make all`. Don't hand-edit files to satisfy Prettier — let the formatter do it.

Other targets that matter:

- **`make agent-test`** instead of `make test` when an AI agent runs the suite. It's silent on success; only failures hit the context.
- **`make test-e2e`** before shipping changes that touch the SDK call path (`src/actions/`, `src/lib/pipelexClient.ts`, `src/lib/loadBundle.ts`, `src/lib/blockingRun.ts`, `src/lib/durableRun.ts`, `src/lib/wireOutput.ts`, `src/lib/errors.ts`, `src/lib/fileEncoding.ts`, `src/hooks/useRun.ts`, `src/generated/`, `methods/`). Unit tests mock the SDK; only e2e exercises the real API, the durable poll loop, and the rendered error UX. Not part of `make all` (costs an LLM call per run).
- **`make use-local`** after editing the sibling `../pipelex-sdk-js` SDK, before re-running tests or the dev server. The tarball install only refreshes when the target re-runs.

## Git Workflow

- **PR target branch**: `dev`. The one exception is a `release/vX.Y.Z` branch, which targets `main`.
- **Branch naming**: prefix with `feature/`, `refactor/`, `docs/`, or `chore/` (e.g. `feature/durable-runs-dual-mode`).

## Anti-patterns to Avoid

- **No bundle TOML inlined in `.ts` files** — bundles live in `methods/<name>/main.mthds`.
- **No raw `fetch()` to the Pipelex API** — always go through `PipelexApiClient`. (If you find a missing capability in the SDK, fix it upstream in `pipelex-sdk-js`, don't bypass it here.)
- **No `as ExtractedEntities` casts on SDK output** — go through the `parseXxx()` narrower instead.
- **No hand-written output shapes** — the `.mthds` bundle declares them and `npm run codegen` projects them. If a type in `src/types/` lists fields, it is duplicating the bundle.
- **No hand-rolled input markup for method inputs** — no `<textarea>`, `<input>`, or file picker for something a method declares. The bundle declares it, `contracts.ts` carries it, and `<RunInputsForm>` renders it. App chrome (mode toggle, submit button, the sample-file shortcut) is still hand-written, as it should be.
- **No per-input validation beside the gate** — one `gateRunInputs` call per action, and no client-side twin of it. A check the contract genuinely cannot express (the PDF byte cap) runs _after_ the gate, over its output, and reads a shared constant.
- **No edits to `src/generated/`** — reformatting included. Wrap it from `src/types/`; a stamped file that changed is a `make check` failure.
- **No camelCase mirror of a generated type** — keys stay wire-native (`doc_type`, `public_url`) all the way to the components.
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
- **`src/generated/` is out of Prettier's and ESLint's reach on purpose.** A reformat rewrites bytes and breaks every stamp, which `make check` then reports as `hand-edited`. See "Generated types" — do not add it back.
- **A kernel-rendered control has no label of your choosing, and sometimes no label at all.** Labels are `humanizeFieldName` of the contract's input name (`image_prompt` → "Image prompt"), so a bundle rename breaks selectors. Query by **role plus name** (`getByRole("textbox", { name: "Text" })`): the humanized names are short and collide with page chrome under strict-mode queries. The file control links no label at all — reach its `input[type="file"]` directly.
- **The form kernel's classes live in its package bundle, not in `src/`.** `tailwind.config.ts` must keep `"./node_modules/@pipelex/mthds-form/dist/**/*.js"` in `content`, or the controls render _mostly_ styled — a silent failure that looks like a broken design system. The deterministic check is diffing the built stylesheet with and without the glob; see [`docs/input-form.md`](docs/input-form.md).
- **A whole-tree diff in `src/generated/` after an upstream pipelex release is expected.** `engine_version` is part of the stamp, so a new engine restamps every artifact with no semantic change. `npm run codegen:verify` calls that out as a note rather than failing.
- **`scripts/*.mts` is skipped by the pre-commit hook.** lint-staged's globs (`*.{ts,tsx}`, `*.{css,json,md}`, `*.mjs`) do not match `.mts`. Nothing ships unlinted — `make check` covers those files fully via `format:check`'s explicit `mts` glob, `eslint .`, and `typecheck:scripts` — but do not rely on the commit hook to catch a script.
- **`next dev` writes the `BEGIN:nextjs-agent-rules` block at the bottom of `AGENTS.md`**, when it detects that an AI coding agent is driving (`node_modules/next/dist/server/lib/generate-agent-files.js`) — so it appears after `make dev` or `make test-e2e`, not after `make build`. Next prefers an `AGENTS.md` over this file when one exists, and this repo has one, so the block lives there. Next.js manages it and re-adds it on the next dev run, so it is committed rather than deleted each time; treat it as generated, keep hand-written guidance above it, and do not reword it. One trap worth knowing: Next locates the block by searching for its opening marker, so **never write that marker verbatim in prose** (that is why this bullet names it without the surrounding comment delimiters) — the upsert would treat the first match as the block's start and swallow everything between your sentence and the real block.
