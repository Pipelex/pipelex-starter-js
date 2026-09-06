# pipelex-starter-js

Minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

This repo is a **reference template**. Keep it small, clear, and high-quality — clarity beats features. When adding anything, ask: "would I want every consumer of this template to inherit this?"

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS 4 (minimal, no design system — keep classes inline and obvious), configured entirely in `src/app/globals.css`; plus the form kernel's shadcn semantic tokens, which the kernel's controls require and which v4 asks for as an `@theme inline` block
- **Testing**: Vitest 4 + Testing Library (happy-dom) for unit; Playwright for e2e
- **Linting**: ESLint 9 (flat config via `eslint-config-next`)
- **Formatting**: Prettier 3
- **Git hooks**: Husky + lint-staged
- **SDK**: [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) (`PipelexApiClient`)
- **Forms**: [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form) — the headless kernel (`.`) plus its React control set (`./react`). Every method input is rendered from the method's own contract
- **Designed pages**: the same package's `./generative` entry — the element catalog, the designer method it ships as data, and the renderer. A page is produced once by `make design` and committed; nothing designs at request time

## Project Structure

```
methods/                      # the source of truth — everything in src/generated/ comes from here
  extract-entities/main.mthds # text → entities pipeline (TOML)
  extract-entities/design.*   # design.jsonl (the layout) + design.json (its provenance)
  summarize-pdf/main.mthds    # PDF Document → structured summary
  summarize-pdf/design.*      # every method has a pair; this one delegates its document input
  generate-image/main.mthds   # text prompt → image (gpt-image-2)
  complex-form/main.mthds     # text + optional struct + plural text → brief
  text-stats/method.json      # a SELECTOR, not a bundle — the method lives in a published package
public/
  sample-invoice.pdf          # sample PDF the PDF example loads out of the box
scripts/                      # native-Node TypeScript (node --experimental-strip-types)
  codegen.mts                 # npm run codegen — CLI entry, one line over lib/generate
  codegen-check.mts           # npm run codegen:check — CLI entry over lib/check
  codegen-verify.mts          # npm run codegen:verify — CLI entry over lib/verify
  add-method.mts              # npm run add-method — CLI entry over lib/add-method
  design.mts                  # npm run design — CLI entry over lib/design
  design-check.mts            # npm run design:check — CLI entry over lib/design
  lib/                        # the behavior, importable so it can be tested
    generate.mts              # runGenerate + generateMethod (= fetchGenerated + writeGenerated)
    check.mts                 # runCheck + checkMethod + summarizeVerdicts — the offline gate
    verify.mts                # runVerify — the keyed semantic gate
    shared.mts                # paths, tree walk, sha256, MethodSource, readManifest, sources.json
    api.mts                   # assertSelectorSupport + explainSelectorFailure — the network half
    add-method.mts            # runAddMethod — the scaffold, over generate.mts's two halves
    design.mts                # designMethod (produce) + checkMethodDesign (the offline gate)
    *.test.mts                # vitest over the lib (vitest's glob matches .mts)
src/
  config.ts                   # ExecutionMode + DEFAULT_EXECUTION_MODE (client-safe)
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — a trio per pipeline
    runExtractEntitiesPipeline.ts         # runExtractEntitiesBlocking + startExtractEntitiesRun + pollExtractEntitiesRun
    runSummarizePdfPipeline.ts  # …Blocking + start… + poll…
    runGenerateImagePipeline.ts # …Blocking + start… + poll…
    runComplexFormPipeline.ts   # …Blocking + start… + poll…
    runTextStatsPipeline.ts     # …Blocking + start… + poll… — SCAFFOLDED by `make add-method`
  generated/                  # COMMITTED and GENERATED — never hand-edit (see "Generated types")
    extract-entities/
      types.ts                # zod schemas + z.infer types, stamped
      binder.ts               # parseXxx / serializeXxx over those schemas, stamped
      contracts.ts            # PIPE_IO_CONTRACTS + INPUT_FORM + OUTPUT_FORM — the gate's contract, the forms' descriptor, the result's (unstamped)
      design.ts               # DESIGN: MethodDesign | null — the committed layout, projected (unstamped)
      codegen.lock            # pipelex trust-chain lock, written verbatim
      sources.json            # starter-owned sidecar — SHA-256 of each source .mthds + derived
    summarize-pdf/ …          # same set per method
    generate-image/ …
    complex-form/ …
    text-stats/ …             # same set — projected from a selector, not from local .mthds files
  brand.ts                    # BRAND: BrandManifest — what a designed page renders under (client-safe)
  lib/
    pipelexClient.ts          # PipelexApiClient singleton factory
    design.ts                 # MethodDesign + DesignRecord + acceptDesign + describeFallback (pure)
    loadBundle.ts             # fs.readFile of the .mthds bundles
    blockingRun.ts            # executeBlockingRun — the blocking `execute` path (server)
    durableRun.ts             # startDurableRun + pollDurableRun — the durable start/poll path (server)
    wireOutput.ts             # wireOutput + wireListOutput (plural) + schema-guided dropWireNulls + describeSchemaFailure (pure; `import "server-only"` build-enforces the boundary)
    errors.ts                 # classifyPipelineError + classifyTransportError + PipelineError model
    serverEnv.ts              # readClassifyEnv — the ClassifyEnv process.env read (server)
    runInputs.ts              # requireContract + requireInputForm + gateRunInputs — the server-side input gate (pure)
    resultField.ts            # requireResultField — the output descriptor + payload schema → one RunField (pure)
    resultUrls.ts             # scrubResultUrls — the result's URL policy, the output twin of fileEncoding's gate (pure)
    fileEncoding.ts           # data-URL MIME + size validation (pure)
    usageReport.ts            # tokens_usages → the render-ready cost report (pure)
    clientFile.ts             # browser File → base64 data URL (client)
  hooks/
    useRun.ts                 # unified blocking|durable state machine (client)
    useRunInputs.ts           # form values + derived fields + readiness + wire shape (client)
    useFileInputs.ts          # drop → encode → write-back the FileValue; the kernel's file seam (client)
                              #   takes `pathOf` — the id→path inverse a designed page needs
  components/
    ExampleTabs.tsx           # client component — tab switcher across the examples
    RunInputsForm.tsx         # client component — the one kernel composition (FieldRenderer per field)
    EntityForm/PdfForm/ImageForm/ComplexForm.tsx  # client components (per-example chrome, mode-agnostic)
    TextStatsForm.tsx         # client component — SCAFFOLDED, and designed by the same gesture
    DesignedPage.tsx          # client component — the one composition on the designed side
    DesignFallbackNote.tsx    # the one line saying why the plain form is rendering
    SegmentedControl.tsx      # the ARIA radiogroup both toggles are built on
    ModeToggle.tsx            # client component — Blocking|Durable segmented control
    ViewToggle.tsx            # client component — Designed|Plain form segmented control
    RunStatus.tsx             # live-status card (spinner + status label + elapsed)
    RunResult.tsx             # client component — the one kernel composition on the output side
    CostReport.tsx            # per-run token usage + cost breakdown
    ErrorDisplay.tsx          # server component (renders classified PipelineError)
  types/                      # the adapter layer over src/generated/ — no shapes re-declared
    pipelineError.ts          # BadPipelineOutputError + BadImageOutputError (tagged)
    extractEntitiesPipeline.ts          # re-exports ExtractedEntities + parseEntities(RunResults)
    summarizePipeline.ts      # re-exports DocumentSummary + parseDocumentSummary(RunResults)
    generateImagePipeline.ts  # aliases Image as GeneratedImage + parseGeneratedImage(RunResults)
    complexFormPipeline.ts    # re-exports ExtractionBrief + parseExtractionBriefResult(RunResults)
    textStatsPipeline.ts      # re-exports Text as TextStatsOutput + parseTextStatsOutput — SCAFFOLDED
e2e/
  extract.spec.ts             # Playwright e2e (hits live API)
  summarize-pdf.spec.ts
  generate-image.spec.ts
  text-stats.spec.ts
  designed-page.spec.ts       # runs a method from its designed page, live
  designedPage.ts             # showPlainForm + ctaLabel — the two views' shared handles
```

### What lives where

- **`methods/`** — one directory per method, saying where that method lives: `.mthds` bundles (TOML) for a method authored here, or a `method.json` manifest naming one that lives on the platform or in a published package. Treat bundles as first-class artifacts, not embedded strings. Use the `/mthds-build`, `/mthds-edit`, `/mthds-check`, `/mthds-run` skills from the `mthds-plugins` marketplace to author and validate them.
- **`src/actions/`** — Server Actions (`"use server"`). The only place that calls the Pipelex SDK. Each pipeline exports a **trio**: `run<Name>Blocking` (the blocking `execute` path), `start<Name>Run` + `poll<Name>Run` (the durable start/poll path). They are thin: pre-flight guard → build options → delegate to `executeBlockingRun` / `startDurableRun` / `pollDurableRun`.
- **`src/lib/`** — Server-side utilities. No React. `runInputs.ts` is pure (kernel core only, no `process.env`, no Node built-ins) so both sides import it — that shared import is the point. The two execution helpers `blockingRun.ts` and `durableRun.ts` are server-only (they construct the SDK client and read `process.env` through `serverEnv.ts`'s shared `readClassifyEnv`, so the two paths can't drift on classification env); `wireOutput.ts` is pure (it reads `main_stuff` and normalizes it — the generated schema does the shape-checking) and carries `import "server-only"`, so a `"use client"` import of a narrower fails the Next build instead of shipping zod plus every generated schema to the browser (vitest aliases the package to `vitest.server-only-stub.ts` so unit tests keep passing). Deliberate client-touching exceptions: `errors.ts` (its types cross the server→client boundary, and `classifyTransportError` + `buildClientTimeoutError` run client-side), and `clientFile.ts` (a browser `FileReader` wrapper imported only by client components). `fileEncoding.ts` and `resultUrls.ts` are pure (no React, no `process.env`) so they are safe to import from either side — `resultUrls.ts` is the output twin of `fileEncoding.ts`'s scheme gate and is imported by `<RunResult>`. Because `errors.ts` is bundled into the client, it imports the SDK error classes from **`@pipelex/sdk`**. That barrel is client-safe — `PipelexApiClient` is fetch-based and pulls no `node:fs` into the graph — so a client bundler handles it without breaking `make build`. Only `pipelexClient.ts` (server-only) constructs `PipelexApiClient` from `@pipelex/sdk`. The forms import `blockingRun`/`durableRun` **types only** (`import type`), so no server code leaks into the client bundle. Both take a `() => Promise<PipelexStartOptions>`, not the pure-protocol `StartOptions`: the run selectors `method_ref` / `method_id` live on the SDK's Pipelex run extensions, which is what lets a scaffolded action name a method that is not shipped as a bundle. Every extension is optional, so the four hand-written actions satisfy the wider type unchanged.
- **`src/hooks/`** — `useRun<TInput,TOutput>`, the unified client state machine (`idle → running → done|error`) that dispatches blocking vs durable by `mode`. Holds the durable poll loop, the staleness token, the elapsed ticker, the wall-clock ceiling, the `classifyTransportError` wrapping, and the **transient-failure budget** (a momentary 5xx/network blip on one poll tick — flagged `transient` by `pollDurableRun` — or a rejected poll await is retried up to `MAX_TRANSIENT_POLL_FAILURES`, surfacing `health: "retrying"` meanwhile, rather than abandoning a run that's still completing server-side). The running state's `health` field (`RunHealth | null`) names _why_ the poll loop is in a resilient state so `<RunStatus>` can show reassuring, cause-specific copy instead of one alarming "degraded" note: `"reconnecting"` when the **server** reported `degraded` (its status endpoint served a last-known DB status because Temporal was unreachable), `"retrying"` for a **client-side** poll blip, `null` when polling cleanly. A durable `start` that returns `lifecycle_unavailable` (the configured URL doesn't serve the durable run lifecycle) surfaces as an explicit error — `useRun` never silently downgrades durable to blocking. Forms never branch on mode — they just call `run(input)`. `useFileInputs` is the file seam — drop, size early-exit, encode through `fileToDataUrl`, write the `FileValue` back at the field's dotted path, and hold the id in the set the kernel reads as `uploadingIds` meanwhile — extracted from `PdfForm` so a scaffolded form with a file input composes it rather than restating it.
- **`src/components/`** — React components. `"use client"` only when the component uses hooks, event handlers, or browser APIs (`ModeToggle` does; `RunStatus` is a pure render). `RunResult` is the one kernel composition on the output side — `RunInputsForm`'s twin — and every tab renders it, the scaffolded one included: the kernel's `<StuffViewer>` under the same `presentation="app"` the form uses, inside a labelled `<section>` so the result is a region a screen reader can name and jump to. There is no per-output-shape component left, and that is the point: a result view stopped being a design decision the app has to take the moment the method's own declaration of what it produces became a committed artifact.
- **`src/types/`** — the **adapter layer over `src/generated/`**, not a place where shapes are declared. Each `parseXxx(results: RunResults)` hands `wireOutput(results)` to the binder generated from that method's own bundle, and translates a thrown `ZodError` into the template's tagged error model; the type itself is re-exported from the generated `types.ts`. Hand-written validation survives only where it adds semantics the concept does not declare — `parseGeneratedImage`'s web-renderable-URL check is the single example. Narrowers throw on mismatch; that's deliberate (system boundary).

## Generated types (`src/generated/`)

**The output shapes are projected from the `.mthds` bundles, not hand-written.** `npm run codegen` sends every method under `methods/` to `POST /v1/codegen` and writes back, byte-for-byte, a `types.ts` (zod schemas plus their `z.infer` types), a `binder.ts` (`parseXxx` / `serializeXxx` over those schemas), and a `codegen.lock`. The narrowers in `src/types/` are thin adapters over those binders, so a bundle and its TypeScript cannot drift apart. The same run also asks `POST /v1/validate` for the method's IO contracts and **both** of its wire form descriptors (`views: ["input_form", "output_form"]`) and writes all three into a `contracts.ts` — the two halves of the same idea. On the way in, the forms derive their fields from `INPUT_FORM` (co-walking the contract) and the run gate validates against the contract; on the way out, `OUTPUT_FORM` says what the result IS and the contract's `output.json_schema` names the property its payload sits under, and the kernel's `buildResultField` pairs them into the one field the result view renders (see [`docs/input-form.md`](docs/input-form.md)). Design rationale and the decisions behind it: [`docs/codegen.md`](docs/codegen.md). The tree carries a third artifact from a different source and a different gesture — `design.ts`, the projection of the page a model designed for the method; see "Designed pages" below and [`docs/design.md`](docs/design.md).

| Command                                          | Needs a key?                                   | When                                           |
| ------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| `npm run codegen` / `make codegen`               | Yes, plus a base URL that serves `/v1/codegen` | After editing any `.mthds` file                |
| `npm run codegen:check` / `make codegen-check`   | No — pure hashing, fully offline               | Every `make check`, so every `make all`        |
| `npm run codegen:verify` / `make codegen-verify` | Yes                                            | Before a release, or after touching `methods/` |

**Selector-sourced methods.** A method directory says where its method lives, and there are two answers: `.mthds` files (the bundle is here) or a `method.json` manifest carrying exactly one selector — `method_ref` (a published package address) or `method_id` (a method in the key's org catalog). Never both in one directory; that is refused. `discoverMethods` returns a `MethodSource` discriminated on `kind`, with `name` and `sourceHashes` common, so every kind-blind gate reads those two and needed no change: `sources.json` hashes the manifest the way it hashes a bundle, orphan detection is unchanged, and `npm run codegen` regenerates both kinds in one pass. Two consequences to hold on to: **a `method_id` slice regenerates only with a key of the same organization**, which is why the template ships only an address-sourced slice; and a selector is resolved server-side, so the three keyed scripts ask `GET /v1/version` once and refuse when `extensions` lacks the kind, naming the base URL rather than surfacing a bare `403`. `make add-method` (see below) is what writes a manifest and the app files around it; [`docs/add-method.md`](docs/add-method.md) is its reference.

The rules below are each load-bearing — breaking one produces a wrong verdict rather than an error:

- **Never hand-edit anything under `src/generated/`.** Artifacts are written verbatim and each carries a stamp hashing its own body, so any edit — a reformat included — makes `codegen:check` report `hand-edited` and fails `make check`. To customize a generated type, wrap it rather than edit it: `src/types/` is that wrapper layer.
- **`src/generated/` is excluded from Prettier and ESLint on purpose** (`.prettierignore`, `eslint.config.mjs`, plus `--no-warn-ignored` on lint-staged's ESLint entry). The emitter targets Prettier's defaults (80 columns); this repo prints at 100, so `prettier --write` would rejoin its lines and break every stamp. Do not "fix" that exclusion. `tsc` still covers the trees in full — they live under `src/` — and that is the check that matters.
- **Two staleness gates, because they answer different questions.** `codegen:check` proves each tree still matches its own lock, and compares `sources.json` (the SHA-256 of every source `.mthds` in the closure) against the bundles on disk — that is what catches "edited a bundle, forgot to regenerate". It cannot know whether the _engine_ would produce something different today; `codegen:verify` asks the server exactly that, comparing live `crate_fingerprint`s against the committed locks and writing nothing.
- **Exit codes are a contract**: `0` current, `1` drift or stale sources, `2` no verdict (a missing or malformed lock). `make check` fails on `1` and `2` alike.
- **An engine bump rewrites every artifact.** `engine_version` rides in the stamp, so an upstream pipelex release restamps the whole tree with zero semantic change (`crate_fingerprint` is the semantic signal, and it stays put). A whole-tree diff after such a release is correct behaviour, not drift — which is why `codegen:verify` reports an engine difference as a **note**, not a failure, leaving the restamp to a deliberate commit.
- **Regeneration currently wants `PIPELEX_BASE_URL=https://api-dev.pipelex.com`.** Measured 2026-09-05: `api.pipelex.com` (hosted `0.10.1`) returns neither of `/v1/validate`'s `input_form` and `output_form` views, both of which codegen needs for **every** method, and does not advertise `method_ref`, which a package-sourced manifest needs. Both scripts name the missing capability rather than failing obscurely, and the gap is a deploy away. `codegen:check` needs no server at all, so `make all` stays green offline regardless — which is the property that makes the gap survivable.
- **Field names stay wire-native snake_case, deliberately** — `doc_type`, `key_points`, `public_url`, `mime_type` travel unchanged from the bundle to the components. Do **not** add a camelCase mapping layer: a hand-maintained mirror of a generated shape is precisely the duplicated surface this removes.
- **`contracts.ts` and `design.ts` are the artifacts the lock does not sign, and that is deliberate.** The SDK's orphan rule is "a _stamped_ file the lock does not track", and the writer deletes orphans — so a stamped `contracts.ts` would silently vanish on every regeneration. Each one's SHA-256 lives instead in `sources.json`'s `derived` map, written by the generator from the content it wrote and compared by `codegen:check`; the expected set is the `DERIVED_ARTIFACTS` **constant**, never the sidecar's own keys, or an empty map certifies itself. `codegen:verify` covers `contracts.ts` by re-fetching `/v1/validate` and comparing the rendered bytes; `design.ts` needs no keyed twin, because `design-check` re-projects it offline from the design on disk. Both gates are shape-blind, which is why adding `OUTPUT_FORM` to the file needed no change to either, and why adding a second derived artifact needed none. Neither is ever hand-edited.
- **The `views` opt-in is declared once, as `VALIDATE_VIEWS` in `scripts/lib/shared.mts`.** `generate.mts` writes the bytes and `verify.mts` re-renders a live response to compare against them, so one script asking for a view the other does not would read as drift on a tree nobody touched. A view token is lenient-ignored by an API too old to serve it, so both scripts refuse on the absent payload instead — naming which view was missing, because a `contracts.ts` without `input_form` renders an empty form and one without `output_form` renders an empty result.

## Designed pages (`methods/<name>/design.jsonl`)

**A third committed artifact about a method: the page a model designed for it.** `make design NAME=<method>` renders a brief from the method's committed contracts, runs the designer method `@pipelex/mthds-form` ships as data (`ui_designer`, resolved through `createRequire`), and writes `methods/<name>/design.jsonl` (the layout, byte-for-byte as emitted) plus `design.json` (its provenance and the hashes the offline gate compares). `npm run codegen` projects the pair into `src/generated/<name>/design.ts` as `DESIGN`, which is `null` for a method nobody has designed a page for — that unconditional projection is what lets a form import it at module level beside `CONTRACT` and `DESCRIPTOR`. Full reference: [`docs/design.md`](docs/design.md).

| Command                                      | Needs a key? | Costs inference?                      | When                                    |
| -------------------------------------------- | ------------ | ------------------------------------- | --------------------------------------- |
| `make design` / `npm run design`             | Yes          | **Yes** — one designer run per method | Deliberately, to give a method a page   |
| `make design-check` / `npm run design:check` | No — offline | No                                    | Every `make check`, so every `make all` |

The rules below are each load-bearing:

- **Rule 1 — a layout names a path and nothing more.** A design says "a `Textarea` here, bound to `/inputs/text`". It never restates a field's kind, requiredness, bounds or choices; the descriptor still owns all of that. So a design cannot go stale about a fact it never stated, and the two gates only ever ask the two questions that remain: is it written in the vocabulary this kernel renders, and does it still fit this method.
- **Never repair a refused or imperfect design by hand.** A refusal writes `methods/<name>/design.rejected.jsonl` (gitignored — evidence, not an artifact) and leaves any previous design committed. Re-run, with `SEED=` if the first run had none. A second refusal is filed against `mthds-form` with the problems and the brief — the catalog and the prompt are the package's. A hand-edited layout fails its own record's signature, and the next production silently undoes the edit.
- **The fallback is the product's safety, and it is a normal path.** `acceptDesign(design, fields)` (`src/lib/design.ts`) names five causes — `none`, `prompt_hash`, `invalid`, `unfit`, `render_error` — and the plain form renders for each. `none` is where every method starts and where a scaffolded one stays until `make design` is run; the five shipped methods have all been designed, so the cause is covered by `src/lib/design.test.ts` rather than by a permanently plain tab. `render_error` is the one the gate cannot reach: `DesignedPage`'s boundary reports it up and the form swaps views.
- **`acceptDesign` runs cheapest-first, and the order matters.** The prompt hash is a string comparison against a constant, and it is the condition a package bump moves — so a design produced for an older catalog is refused before anything tries to compile it in a vocabulary that has since changed.
- **The offline gate asks the runtime's three questions with the runtime's own functions** (`specFromJsonl`, `validateAgainstCatalog`, `layoutProblems`), plus two staleness questions the runtime cannot ask: was the JSONL hand-edited, and did the method move since. So a fallback in a browser is never news `make check` could have delivered first. Exit codes match `codegen:check`: `0` current, `1` drift, `2` no verdict (half a design on disk, or a missing projection).
- **Every shipped method is designed, and every tab therefore carries the toggle.** That is the point of the toggle: the same method rendered two ways, with one store, one gate and one wire behind both, so the contrast is the design and nothing else. A tab loses its toggle only when its design stops being accepted — which is the fallback working.
- **One store, both views.** `useRunInputs(CONTRACT, DESCRIPTOR, seed, DESIGN)` calls `acceptDesign` and, when the verdict is `ok`, creates one json-render store that `values` / `setValues` / `ready` / `toData` read instead of React state. `ViewToggle` copies nothing, and both views deflate to the same wire shape through the same contract — pinned by a form test, not by a comment.
- **`DesignedPage` owns three things that are the app's, not the model's**: the full-bleed band (a product page inside `max-w-2xl` reads as a phone screenshot), `FieldPresentationProvider presentation="app"` (without it a delegated `MthdsField` shows its raw contract name and concept pill, and the two views disagree about a field neither wrote), and the credit line naming what produced the page.
- **The toggles are chrome, above the form, in every example.** `ModeToggle` inside the plain `<form>` would vanish with it on the designed view. `PdfForm`'s sample-PDF shortcut sits in the same row for the same reason.
- **A file input on a designed page needs the id inverse.** `MthdsField` mints the field id from the store pointer, so `useFileInputs` takes a `pathOf` mapper (default `id.split(".")`) and the designed form passes `pathFromDomId` → `segmentsUnder(INPUTS_ROOT, …)`. An id neither form recognises is a loud inline `bad_request` naming it, never a silent no-op — a dropped file that writes nowhere looks exactly like an upload still running.

## Pipelex Integration Pattern

**Two execution modes, one hook.** Every example runs in either mode, chosen per-example at runtime via a `<ModeToggle>`:

- **Blocking** (`client.execute`) — one synchronous request. Simple, but behind the hosted gateway it is cut off at ~30s, so long pipelines surface a classified `execute_timeout` error. Use it to _see_ that limit.
- **Durable** (`client.start` then poll) — survives the ~30s cap and streams coarse live status. Hosted-safe everywhere; the default (`NEXT_PUBLIC_EXECUTION_MODE`, defaults `"durable"`). When the configured URL doesn't serve the run lifecycle it surfaces an explicit `lifecycle_unavailable` error (naming the endpoint URL, steering to `PIPELEX_BASE_URL`) — no silent downgrade.

The forms are **mode-agnostic** — they call `useRun({ mode, blocking, start, poll })` and render by `state.phase`. Only the unified hook knows which Server Actions to call.

**Nothing about a method's IO is written by hand — neither the form nor the result view.** The two halves are the same idea applied to the two sides of one contract, and both are rendered by the `@pipelex/mthds-form` kernel from what `npm run codegen` committed.

**On the way out:** `requireResultField(OUTPUT_FORM, CONTRACT, …)` (`src/lib/resultField.ts`) pairs the pipe's output-form descriptor with the payload schema on its contract into one `RunField`, built at module level beside `CONTRACT` and `DESCRIPTOR`, and `<RunResult field value name>` renders it. The two artifacts answer different questions and neither is sufficient alone — the descriptor says what the result IS (its kind, its nesting, whether it is plural), the schema names the property the payload sits under — and a renderer holding one but not the other is back to inferring the other from the value. No arm of that view inspects a payload to decide how to lay it out, which is the difference between reading the standard and guessing at it. The `name` is app chrome, like the tab label: the descriptor's own name is the engine's `output` for every pipe there has ever been, so only the caller knows what the reader is looking at.

**On the way in:** each form renders its inputs from the method's committed wire descriptor and contract through the same kernel — `useRunInputs(CONTRACT, DESCRIPTOR)` for values/readiness/wire shape (`DESCRIPTOR` from `requireInputForm(INPUT_FORM, …)`, `requireContract`'s twin), `<RunInputsForm>` for the controls — and the Server Action gates the contract with `gateRunInputs` (`src/lib/runInputs.ts`), which is the trust boundary and deliberately never needs the descriptor. Both sides take their rules from the one kernel, so the per-input guards that used to sit on either side are deleted rather than kept as belt-and-braces; the two calls differ deliberately, and **the server's must stay a strict superset of the browser's**. That superset is the kernel's own `gateRunInputs` — it validates shapes, re-applies readiness's own functions over the same derived fields, and builds the wire envelope — and `src/lib/runInputs.ts` is a thin shim that renders its refusal as a `bad_request` `PipelineError`. Do not re-assemble the gate from the kernel's lower-level steps: the emptiness step is where assemblies go wrong (`inputMustBeFilled` + `isFilled` is the trap — it agrees on every field kind this repo's methods produce and diverges on a structured concept). The invariant is pinned by a test that runs both sides over one table (`src/lib/runInputs.test.ts`), not by a comment. Full reference: [`docs/input-form.md`](docs/input-form.md).

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
- **A plural output is read through `wireListOutput`, because the runtime renders a list two ways.** A `multiplicity` other than `single` is one `ListContent`, and `main_stuff` carries it as a `{ items: [...] }` envelope on the blocking path (the working memory is hydrated before it is serialized) but as a **bare array** on the durable path whenever the worker cannot hydrate the concept's class — which is every concept a method declares itself; a native concept such as `native.Page` gets the envelope there too. Measured live on 2026-09-05 (see [`docs/codegen.md`](docs/codegen.md)): the first scaffolded plural slice answered `{ items }` in Blocking mode and an array in Durable mode. So a plural narrower types its output as `<Code>[]` and parses `z.array(<Code>Schema)` over `wireListOutput(results, <Code>Schema)`, which unwraps a top-level `{ items }` when it sees one and passes anything else through for the schema to reject. Like `dropWireNulls` it normalizes values, never names, and it expires the day the runtime settles on one rendering (reported upstream to pipelex). Never declare the envelope in an adapter — that is the bug `make add-method` shipped once.
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

- **The kernel never uploads — the host does.** `DocumentField` fires `env.onDropFile(id, file)` and waits; the host encodes and writes a `FileValue` (`{url, filename}`) back at the field's **dotted path** with `setValueAtPath`. While the id sits in `env.uploadingIds` the kernel shuts **every door into that value** — the dropzone, the "paste a URL instead" toggle and the URL input behind it — which is why no staleness token is needed for a second selection mid-encode and why the form's `disabled` is plain run state. The one write path that guarantee cannot cover is the host's own chrome: a shortcut that writes into the field (the sample-PDF button) disables itself while the field is resolving (`running || encodingIds.size > 0`).
- **Encode client-side, never cross the boundary with a `File`.** The browser reads the `File` into a base64 data URL via `fileToDataUrl` (`src/lib/clientFile.ts`). Server Actions accept only serializable arguments — the value that crosses is the `string` data URL inside the form value, never a `File`, `Blob`, or `FormData`.
- **Validate server-side, then let the SDK upload.** The action runs the shape gate, then `checkFileInputs(DESCRIPTOR, gated.inputs, …)` over the **gated** inputs (`src/lib/fileEncoding.ts` — the authoritative scheme + MIME + size gate, which walks the pipe's wire descriptor to find every file position: top-level, inside a list, nested in a structured concept), then hands the inputs to `client.prepareInputs()`, which reads the method's declared signature, recognizes the input as a file, uploads the bytes to Pipelex storage, and rewrites the input to a small `pipelex-storage://` URI. **`prepareInputs` takes the kernel's `{concept, content}` envelope as readily as a bare value** (verified live) and preserves it on output, so no conversion sits at that seam. It throws a typed `InputPreparationError` _before any run starts_, and because the options closure runs inside `executeBlockingRun` / `startDurableRun`'s `try/catch`, that error is classified like any other SDK error.
- **The scheme is checked before the bytes, and refused by default.** The kernel's file control offers "paste a URL instead", so a document input can arrive carrying no bytes — but "nothing to size-check" is not "nothing to verify". `prepareInputs` resolves any string it does not recognise as `data:`, `http(s)://` or `pipelex-storage://` as a **local filesystem path**, reads it and uploads it, so a Server Action that waves through every non-`data:` URL is an arbitrary server-side file read. `checkFileInputs` validates against a closed set first (`data:`, `https://`, `pipelex-storage://` — no cleartext `http://`), then MIME and size for `data:` only. It finds the files by walking the method's **wire descriptor** (`requireInputForm(INPUT_FORM, …)`, the same artifact the form is rendered from and the SDK's `prepareInputs` uploads by), never by the literal name `document` and never by sniffing values for a `url` key: a name-keyed gate fails open the day the bundle renames that input, while codegen carries the rename everywhere else, and a value-keyed one cannot tell a text field named `url` from a `Document` two levels down. Because the two walks agree by construction, a plural file input (`cvs: Document[]`) or a nested one is gated like a single top-level one, not refused.
- **Re-validate on the server.** The browser's own size check is an early exit that saves an encode (past `MAX_PDF_BYTES` the payload cannot fit the body limit anyway), reading the same exported constant — not a second rule. The Server Action's `checkFileInputs` call is the gate. One thing that looks like a duplicated guard and is not: the empty-MIME re-wrap before encoding is an _encoding_ fix for browsers that report `file.type === ""` for a valid PDF, and deleting it breaks those uploads.
- **Mind the Server Action body limit.** Next.js caps Server Action bodies at 1 MB by default; base64 inflates payloads ~37%. `next.config.js` raises `serverActions.bodySizeLimit`, and `MAX_PDF_BYTES` in `fileEncoding.ts` caps the raw file size with margin.
- **File/image outputs come back as a URL** — a storage URL or a base64 data URL — in the output content. On the hosted durable path the runtime returns both a non-web `url` (`pipelex-storage://…`) and a web `public_url` (a signed S3 URL); `parseGeneratedImage` keeps both and validates the one that will actually be displayed (`public_url ?? url`), so a non-web `url` can't ship a silently-broken image. The kernel's file arms prefer `public_url` for the same reason, which is why every file this template produces paints without a resolver. **The result view applies a URL policy of its own, and it is the one thing it re-reads.** The form kernel decides what to paint, link and frame from its own `isViewableUrl`, which accepts `http:`, **any** `data:` media type and `blob:` — and one of the sinks behind that verdict is a `DocumentPreview` `<iframe>` with no `sandbox` attribute, offered whenever the payload's own `filename` or `mime_type` looks previewable. So `scrubResultUrls` (`src/lib/resultUrls.ts`) walks the result descriptor exactly as `checkFileInputs` walks the input one, and removes any file URL the kernel would act on that is not `https:` or a PNG/JPEG/WebP `data:` URL, reporting what it removed so `<RunResult>` can say so rather than quietly differ. It normalizes an accepted URL too, so the string this judged is the string the kernel gets — untrimmed leading whitespace passes `new URL` and fails the kernel's `/^https?:/`, which is how a validated `public_url` gets skipped in favour of an unvalidated `url`. A reference the kernel would never touch (`pipelex-storage://`) is left verbatim: it reaches no sink, so removing it would strip the JSON receipt for nothing. **This is a stopgap owned upstream** — the fixes belong in `@pipelex/mthds-form` — and it does not cover the markdown a `native.Text` result carries, where a `![](https://…)` in the model's own answer loads on paint.
- **A `pipelex-storage://` reference on its own resolves nowhere in a browser**, and the kernel's seam for exchanging one is a `<ResultEnvProvider resolveUrl>` mounted above the result — one provider high in the tree, not a prop threaded through `<RunResult>`. Wiring it over the SDK's `resolveStorageUrl` is a follow-up this template has not needed.

To add a new pipeline **whose method lives elsewhere** — on the platform (a `mt_…` catalog id) or in a published package (a `github.com/owner/repo[/pkg][@tag]` address) — do not follow the checklist below by hand. Run `make add-method METHOD=<selector>`: it writes the manifest, the generated tree, the adapter, the action trio, an action test, the form and the tab entry, refusing rather than overwriting anything that already exists. `src/components/TextStatsForm.tsx` and its siblings are one such slice, committed untouched. The gesture prints the optional second one when it finishes — `make design NAME=<name>` — because a scaffolded tab opens on the plain form until a method has a design. [`docs/add-method.md`](docs/add-method.md) is the reference; the checklist below is what it automates, and remains the path for a bundle you author here.

To add a new pipeline whose bundle lives in this repo:

1. Create `methods/<name>/main.mthds` (use `/mthds-build`).
2. Run `npm run codegen`. It writes `src/generated/<name>/` — the zod schemas, the binders, the IO contracts, the design projection (`null` until there is one), the lock, and the sources sidecar — for every concept that method declares. Commit that tree alongside the bundle.
3. Add `loadXxxBundle()` in `src/lib/loadBundle.ts` (or one helper per bundle).
4. Add the adapter in `src/types/<name>.ts`: re-export the generated type, and write `parseXxx(results)` as the generated binder applied to `wireOutput(results)` inside a `try/catch` that rethrows `describeSchemaFailure(err, "<Name>")` as a tagged error subclass. A plural output is `z.array(<Code>Schema)` over `wireListOutput(results, <Code>Schema)` instead, typed `<Code>[]`. Write no shape by hand — if you find yourself declaring fields, the bundle already declares them.
5. Add the action **trio** in `src/actions/run<Name>Pipeline.ts` — `run<Name>Blocking` (→ `executeBlockingRun`), `start<Name>Run` (→ `startDurableRun`), `poll<Name>Run` (→ `pollDurableRun`) — sharing a `buildOptions` closure and a module-level `CONTRACT = requireContract(PIPE_IO_CONTRACTS, "<domain>", "<pipe_code>")`. Each entry point opens with `gateRunInputs(CONTRACT, data)`.
6. Wire it from a component: `useRunInputs(CONTRACT, DESCRIPTOR, seed?, DESIGN)` for the inputs (module-level `DESCRIPTOR = requireInputForm(INPUT_FORM, "<domain>", "<pipe_code>")` beside the `CONTRACT` lookup), a module-level `RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, "<domain>", "<pipe_code>")` beside both, `useState<ExecutionMode>(DEFAULT_EXECUTION_MODE)` and `useRun({ mode, blocking, start, poll })` for the run. Render `<RunInputsForm fields values onValuesChange disabled>`, `<ModeToggle>` (disabled while running), a submit button gated on `ready`, then `<RunStatus>` while running, `<ErrorDisplay>` on error, and `<RunResult field={RESULT_FIELD} value={state.output} name="<stuff_name>">` on done — all keyed off `state.phase`. Submit with `run(toData())`. **Write neither the form fields nor the result view**; the contract declares both. The hook's `design` verdict and `store` drive the designed arm: render `<DesignedPage>` when the verdict is `ok` and the view is `"designed"`, the plain `<form>` plus `<DesignFallbackNote>` otherwise, with `<ViewToggle>` in the chrome row only when there is a page to toggle to. All five examples carry the whole composition whether or not the method has a design, so adding one later is `make design NAME=<name>` and nothing else. See `src/components/EntityForm.tsx` for the canonical pattern, and `PdfForm.tsx` for the `onDropFile` file seam and its `pathOf` inverse.
7. Optional: `make design NAME=<name>` for a designed page. Commit `methods/<name>/design.{jsonl,json}` with the re-projected `design.ts` and `sources.json`, and put the provenance in the commit message.

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
- **Optional, and gated.** The live-API specs (`extract`, `summarize-pdf`, `generate-image`, `text-stats`) hit the live Pipelex API using `PIPELEX_API_KEY` from `.env.local` and cost an LLM call each. Two guards make this safe: (1) they **auto-skip** when no key is set — `requireLiveApi()` in `e2e/liveApi.ts` calls `test.skip()`, and `playwright.config.ts` loads `.env.local` via `@next/env` so a configured key is visible to the runner; (2) `make test-e2e` **prompts for confirmation** before spending (the `confirm-live-e2e` target — skipped in CI / non-TTY shells, bypass with `CONFIRM=1`). Additionally, the blocking-cap case in `generate-image` skips unless `PIPELEX_BASE_URL` is a **hosted gateway** (`api[-env].pipelex.com`) — other endpoints may not enforce the ~30s blocking cap, so the spec would be flaky there. `text-stats` additionally needs a base URL that advertises `method_ref`, since its method is resolved by address. The remaining spec, `error-display`, tests the offline error UX — it needs no key and is **not** key-guarded; it probes the same URL the app will use (`PIPELEX_BASE_URL`, defaulting to the SDK's hosted URL) and skips when that API is reachable, so it runs exactly when the app would render `api_unreachable`.
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
| `make add-method`     | Scaffold a method that lives elsewhere into the app — `METHOD=<mt_… \| address>` (needs a key) |
| `make design`         | Produce a method's designed page — `NAME=` `PIPE=` `SEED=` (needs a key; **costs inference**)  |
| `make design-check`   | Prove the committed designs are current — offline, no key. Part of `make check`                |
| `make test`           | Vitest single pass                                                                             |
| `make agent-test`     | Vitest, silent on success (preferred for AI agents)                                            |
| `make test-e2e`       | Optional Playwright e2e (live API, costs an LLM call; prompts first, auto-skips without a key) |
| `make check`          | lint + format-check + typecheck + codegen-check + design-check                                 |
| `make all`            | check + test + build (no e2e, `codegen`, `codegen-verify` or `design` — each needs a key)      |
| `make use-local`      | Pack and install siblings `../pipelex-sdk-js` + `../mthds-form` (alias: `ul`)                  |
| `make use-npm`        | Restore the latest npm-published `@pipelex/sdk` + `@pipelex/mthds-form` (alias: `un`)          |

## Local package development (`use-local`)

When working on this starter alongside the SDK or the form kernel, use `make use-local` to install the siblings `../pipelex-sdk-js` and `../mthds-form` into `node_modules/@pipelex/sdk` and `node_modules/@pipelex/mthds-form` instead of the npm packages. The target builds each sibling, packs it with `npm pack`, then installs both resulting tarballs — in **one** `npm install` call, deliberately: a second `--no-save` install re-reconciles `node_modules` against the lockfile and can silently revert the first tarball to the registry version.

We use a tarball install rather than a symlink (`ln -s`) because Next.js 16's Turbopack does not follow symlinked workspace packages — both `npm run dev` and `npm run build` fail with `Module not found: Can't resolve '@pipelex/sdk'` against a symlinked entry. **Re-run `make use-local` after every edit to either sibling** to pick up changes.

`make use-npm` switches back, and it installs `@pipelex/sdk@latest` and `@pipelex/mthds-form@latest` rather than the plain names on purpose: the bare form re-resolves whatever range `package.json` already declares, so returning from a `use-local` session with a stale caret range would restore that range's newest match instead of the current release — a silent **downgrade**, since both packages are pre-1.0 and `^0.a.b` never crosses a minor. The `@latest` tag fetches the published release and re-pins the range to it.

## Workflow Rules

**After any code change, run `make all`.** It runs `check` (lint + format-check + typecheck + the offline codegen check) + `test` + `build`, which catches the failure classes that block CI: ESLint violations, Prettier formatting drift, TypeScript errors, generated types that no longer match their bundles, and broken unit tests / production build. Do not declare a task done if `make all` doesn't pass cleanly.

**After editing anything under `methods/`, run `npm run codegen`.** `make check` compares each generated tree against a hash of the `.mthds` files it was projected from, so a bundle edit without a regeneration fails with "Run `npm run codegen` to regenerate." rather than shipping types that quietly lie. Regeneration needs `PIPELEX_API_KEY` and, until the hosted deploy lands, `PIPELEX_BASE_URL=https://api-dev.pipelex.com`. Commit the regenerated tree in the same commit as the bundle edit. The same applies to a `methods/<name>/method.json` manifest: bumping its tag is a source edit, and `make check` fails until you regenerate.

**Editing a method also stales its design, and `make check` says so separately.** `design-check` compares the method's current source hashes against the ones its `design.json` was produced against, so a bundle edit reddens both gates: `codegen` fixes the types, `make design NAME=<method>` re-produces the page. The order matters — the producer reads the _committed contracts_, so regenerate first. A method with no design is unaffected, which is the ordinary case.

If `make format-check` fails, run `make format` to auto-fix and re-run `make all`. Don't hand-edit files to satisfy Prettier — let the formatter do it.

Other targets that matter:

- **`make agent-test`** instead of `make test` when an AI agent runs the suite. It's silent on success; only failures hit the context.
- **`make test-e2e`** before shipping changes that touch the SDK call path (`src/actions/`, `src/lib/pipelexClient.ts`, `src/lib/loadBundle.ts`, `src/lib/blockingRun.ts`, `src/lib/durableRun.ts`, `src/lib/wireOutput.ts`, `src/lib/errors.ts`, `src/lib/fileEncoding.ts`, `src/lib/resultUrls.ts`, `src/lib/design.ts`, `src/hooks/useRun.ts`, `src/hooks/useRunInputs.ts`, `src/components/DesignedPage.tsx`, `src/generated/`, `methods/`). Unit tests mock the SDK; only e2e exercises the real API, the durable poll loop, and the rendered error UX. Not part of `make all` (costs an LLM call per run).
- **`make use-local`** after editing the sibling `../pipelex-sdk-js` SDK or `../mthds-form` form kernel, before re-running tests or the dev server. The tarball install only refreshes when the target re-runs.
- **`make design`** only when a page is actually wanted. It is the one target in this repo that spends a model call, and nothing else in it — not `make all`, not `make check`, not `make codegen`, not `make add-method` — produces a design implicitly. After a `@pipelex/mthds-form` bump, run `make design-check`: a moved catalog prompt hash is the one condition that stales every committed design at once, and re-producing them belongs in the same commit as the bump.

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
- **No hand-rolled result markup for a method's output** — no headings, lists or `<img>` for something the method declares. `OUTPUT_FORM` carries the declaration and `<RunResult>` renders it. Write a bespoke view only where a specific output genuinely earns one, and never by inspecting the payload to work out what it is: the descriptor already says.
- **No edits to `src/generated/`** — reformatting included. Wrap it from `src/types/`; a stamped file that changed is a `make check` failure.
- **No hand-edited layout, ever** — `methods/<name>/design.jsonl` is written by `make design` and signed by the record beside it. A refused layout is re-run (with `SEED=` if the first had none), and a second refusal is filed against `mthds-form`. Editing one is a `make check` failure that the next production would undo anyway.
- **No hand-written page for a method that has a design** — and none for one that does not either. A page a model produced or the kernel's plain form; there is no third option in this template.
- **No camelCase mirror of a generated type** — keys stay wire-native (`doc_type`, `public_url`) all the way to the components.
- **No `try/catch` that swallows errors silently** in narrowers — throw a tagged subclass. The action's outer catch routes it through `classifyPipelineError`.
- **No `throw new Error(...)` from server actions for known failure modes** — return `{ ok: false, error: classifyPipelineError(err, env) }` so the structured error survives the server→client boundary in production.
- **No relative imports** across folders — always `@/`.
- **No default exports** for components (only for App Router pages/layouts).
- **No `index.ts` barrel files**.
- **No inline styles** — use Tailwind classes.

## Gotchas

- **The two `add-method:` anchor comments in `src/components/ExampleTabs.tsx` are a contract — never move, reword or delete the marker tokens.** `make add-method` inserts one import line above `// add-method:imports` and one `TABS` entry above `// add-method:tabs`, and refuses when it cannot find either. The match is on the token alone, so the prose after a marker can be reworded freely; the tokens themselves cannot move. An anchor test in `scripts/lib/add-method.test.mts` reads the real file, so a template edit that loses one fails the suite rather than the next person's scaffold run. The same is why `TABS` carries its `Component` and the panels are mapped: a hand-written `<div role="tabpanel">` per form would make a scaffolded tab a second insertion point.
- **The dev server runs on port 4300, and it must not go back to 4100.** The number is declared once, as `APP_PORT` in the `Makefile`, which exports it; `package.json`'s `dev`/`start` scripts and `playwright.config.ts` each read it and each default to 4300 on their own, so `npm run dev` outside make still works. Override it per invocation — `make run APP_PORT=4301` — which is what lets a second worktree run beside one that already holds the port. The variable is deliberately not the ambient `PORT`: hosting platforms, other dev servers and shell profiles export that one, and inheriting it would move this server without saying so. It was moved off 4100 because the `pipelex-server` local stack (`make local-up`) publishes its sandbox container, the MTHDS build chatbot, on `127.0.0.1:4100`, and `pipelex-app` hardcodes that port in `src/lib/agent-server.ts`, so the stack is the side that cannot move. The collision is silent rather than loud: Docker holds IPv4 loopback, so `next dev` still binds 4100 on IPv6 and prints `Ready`, while Playwright's health check resolves to IPv4, reaches the container's 404 forever, and fails with `Timed out waiting 120000ms from config.webServer` — a message that names neither the port nor the real owner. When e2e times out with the app apparently up, run `lsof -nP -iTCP:4300 -sTCP:LISTEN` before believing anything else.
- **`make run`, `make start` and `make test-e2e` refuse a port held by another checkout, and that guard is worth keeping.** Every branch here lives in its own worktree and every worktree's `make run` wants the same 4300, so the holder is routinely another checkout of this same app — which answers on `http://localhost:4300` and looks entirely right in a browser. The `port-check` target reads the holder's own working directory (`lsof -a -p <pid> -d cwd`) and compares it against `$(CURDIR)`, so the refusal names the directory actually serving the port instead of printing Node's bare `EADDRINUSE`. The e2e targets pass `ALLOW_OWN=1`, which accepts a server started from **this** directory (Playwright's `reuseExistingServer` is meant to reuse it) and still refuses a foreign one — without that asymmetry a stale worktree on 4300 makes the whole suite run against another branch's app and report it green, which is the same silent collision as the 4100 trap one step further along.
- **Husky `prepare` warning**: `npm install` prints `.git can't be found` if you install before `git init`. Harmless — just re-run `npm install` after `git init` to wire `.husky/_/`.
- **Renaming App Router directories**: delete `.next/` before running `make check` — stale type references in `.next/types/` will fail typecheck.
- **`next-env.d.ts` is generated** (gitignored). Next regenerates it on dev/build. Don't edit by hand.
- **`.worktreeinclude` names the gitignored files a fresh git worktree needs copied** (`.env.local`, the local Claude Code settings). Claude Code reads it when it creates a worktree, so a worktree starts with the API key instead of an unexplained `api_unreachable`. A pattern copies a file only when it is gitignored, so a tracked file can never be duplicated through it.
- **Tailwind is configured in CSS, not in a JS config — there is no `tailwind.config.ts`.** Everything lives at the top of `src/app/globals.css`: the `@import`s, the `@source` directive pointing at the form kernel's bundle (see the bullet below — it is load-bearing, not stray), the `@custom-variant dark`, and the `@theme inline` token block. Source scanning is automatic for the repo's own tree, so a new top-level directory with classes needs nothing; only a path Tailwind would not walk on its own — a dependency's `dist`, an ignored directory — needs an `@source` of its own.
- **`src/generated/` is out of Prettier's and ESLint's reach on purpose.** A reformat rewrites bytes and breaks every stamp, which `make check` then reports as `hand-edited`. See "Generated types" — do not add it back.
- **A kernel-rendered control has no label of your choosing, and sometimes no label at all.** Labels are `humanizeFieldName` of the contract's input name (`image_prompt` → "Image prompt"), so a bundle rename breaks selectors. Query by **role plus name** (`getByRole("textbox", { name: "Text" })`): the humanized names are short and collide with page chrome under strict-mode queries. The file control links no label at all — reach its `input[type="file"]` directly.
- **The result region contains the kernel's own chrome, so `getByRole("img")` inside it is ambiguous.** `<RunResult>` labels a section and hands the inside to `StuffViewer`, which renders its Download control with a lucide icon — an inline `<svg>`, which ARIA counts as role `img` exactly like a rendered picture does. So `result.getByRole("img")` resolves to two elements and fails strict mode, which is how `e2e/generate-image.spec.ts` broke on the move off `<ImageResult>`. Reach a rendered file with `result.locator("img")`: kernel icons are always `<svg>` and a rendered file is always an `<img>`. Its `alt` is not a handle either — the kernel fills it with the payload's caption or filename and only falls back to "Preview".
- **The form kernel's classes live in its package bundle, not in `src/`.** `src/app/globals.css` must keep `@source "../../node_modules/@pipelex/mthds-form/dist/**/*.js"`, or the controls render _mostly_ styled — a silent failure that looks like a broken design system. Keep the `/**/*.js` glob rather than the bare directory: `dist` also ships sourcemaps, and Tailwind scans a `.map` — comments inside `sourcesContent` included — as readily as the compiled JS. The deterministic check is diffing the built stylesheet with and without it; see [`docs/input-form.md`](docs/input-form.md).
- **The kernel needs Tailwind v4, and a v3 build fails silently.** Its controls are written in v4's vocabulary (`outline-hidden`, `aria-invalid:`, `data-placeholder:`, `wrap-break-word`, `field-sizing-content`, the `(--radix-…)` variable form); v3 compiles those names to nothing, so the controls keep their layout and lose their focus, invalid and placeholder states with no error anywhere. The same applies to the tokens: since kernel 0.8.0 each is a **whole colour**, so the `@theme inline` mapping is a bare `var(--border)` — re-wrapping it as `hsl(var(--border))` (the v3 form) yields `hsl(hsl(…))`, which the browser discards, and the element falls back to transparent.
- **A whole-tree diff in `src/generated/` after an upstream pipelex release is expected.** `engine_version` is part of the stamp, so a new engine restamps every artifact with no semantic change. `npm run codegen:verify` calls that out as a note rather than failing.
- **`scripts/*.mts` is skipped by the pre-commit hook.** lint-staged's globs (`*.{ts,tsx}`, `*.{css,json,md}`, `*.mjs`) do not match `.mts`. Nothing ships unlinted — `make check` covers those files fully via `format:check`'s explicit `mts` glob, `eslint .`, and `typecheck:scripts` — but do not rely on the commit hook to catch a script.
- **`next dev` writes the `BEGIN:nextjs-agent-rules` block at the bottom of `AGENTS.md`**, when it detects that an AI coding agent is driving (`node_modules/next/dist/server/lib/generate-agent-files.js`) — so it appears after `make dev` or `make test-e2e`, not after `make build`. Next prefers an `AGENTS.md` over this file when one exists, and this repo has one, so the block lives there. Next.js manages it and re-adds it on the next dev run, so it is committed rather than deleted each time; treat it as generated, keep hand-written guidance above it, and do not reword it. One trap worth knowing: Next locates the block by searching for its opening marker, so **never write that marker verbatim in prose** (that is why this bullet names it without the surrounding comment delimiters) — the upsert would treat the first match as the block's start and swallow everything between your sentence and the real block.
