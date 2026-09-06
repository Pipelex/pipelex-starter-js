# pipelex-starter-js

A minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

It ships demo pipelines, presented as tabs:

- **Text entities** (`methods/extract-entities`) — extracts `{ people, orgs, dates }` from pasted text.
- **PDF summary** (`methods/summarize-pdf`) — uploads a PDF in the browser and returns a structured `{ title, doc_type, key_points }` summary from a cheap OpenAI model.
- **Image generation** (`methods/generate-image`) — turns a text prompt into an image with `gpt-image-2`.
- **Complex inputs** (`methods/complex-form`) — the same extraction with an optional structured input and a plural one, so the form has something to derive beyond a single text box. Its point is what the code does _not_ contain: `src/components/ComplexForm.tsx` is no longer than `EntityForm.tsx` and names no input.
- **Text stats** (`methods/text-stats`) — a method that does **not** live in this repo. `methods/text-stats/method.json` names a published package by address, and every file behind the tab was written by `make add-method` rather than by hand (see [Add a method that lives elsewhere](#add-a-method-that-lives-elsewhere)).

Every one of those tabs opens on a **designed page**: a layout a model produced for that method once, committed beside it and rendered by the app. A toggle above each page switches to the generic form the method's contract alone produces, so you can see both renderings of the same method side by side — including on the scaffolded tab, which was designed by the same one-line gesture. See [Designed pages](#designed-pages).

Starting from zero? Use this template (next section). Adding Pipelex to an app you already have? This repo doubles as the worked example of the pattern — [`docs/adopt-in-an-existing-project.md`](docs/adopt-in-an-existing-project.md) is the transplant checklist.

## Use this template

This is a template repository — don't clone it directly. Click the green **Use this template** button at the top-right of the GitHub page to create your own repo, then clone that.

**Make it yours.** The fastest path is the bundled `/bootstrap` skill: open your new repo in [Claude Code](https://claude.com/claude-code) and run `/bootstrap`. It renames the template identity (`pipelex-starter-js` / `Pipelex Starter`) across `package.json`, `package-lock.json`, README, CLAUDE.md, the app title, metadata, release skill, and license text, then runs the checks.

Prefer to do it by hand? The manual equivalent:

1. Replace `pipelex-starter-js` in `package.json` with your npm package name, and update the description, author, repository, and license metadata.
2. Replace `Pipelex Starter` in `src/app/layout.tsx` and `src/app/page.tsx` with your app title.
3. Update README.md, CLAUDE.md, LICENSE, and `.claude/skills/release/SKILL.md` so they describe your project instead of the template.
4. Run `npm install --package-lock-only` so `package-lock.json` matches the new package name and version.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5** (strict)
- **Tailwind CSS 4** (configured in CSS — there is no `tailwind.config.ts`)
- **Vitest 4** + Testing Library (happy-dom)
- **ESLint 9** + **Prettier 3**, **Husky** + **lint-staged**
- **`@pipelex/sdk`** SDK for Pipelex API calls
- **`@pipelex/mthds-form`** form kernel — the input forms are rendered from each method's own contract

## Prerequisites

- Node.js 22.12+ (the SDK is ESM-only and the e2e specs `require()` it, which needs Node's unflagged `require(esm)`)
- Access to the **hosted Pipelex API**, currently in private beta. Join the waitlist at [go.pipelex.com/waitlist](https://go.pipelex.com/waitlist); once you have access, get an API key at [app.pipelex.com](https://app.pipelex.com). `PIPELEX_BASE_URL` already defaults to `https://api.pipelex.com`, so the key is the only thing you set.

  **This template targets the hosted Pipelex API.** The hosted API is what serves everything the examples rely on — durable runs (start + poll), file upload and storage, and codegen. Dedicated deployments of the hosted plane exist and are not self-serve; talk to us at [pipelex.com](https://pipelex.com).

## Quick start

```bash
cp .env.example .env.local
# edit .env.local and set PIPELEX_API_KEY
make install
make dev
```

Open [http://localhost:4300](http://localhost:4300) and try the example tabs.

## Project structure

```
methods/
  extract-entities/main.mthds # text → { people, orgs, dates }
  extract-entities/design.*   # the page a model designed for it, plus its provenance
                              # (every method here has a pair — see Designed pages)
  summarize-pdf/main.mthds    # PDF Document → { title, doc_type, key_points }
  generate-image/main.mthds   # text prompt → generated Image
  text-stats/method.json      # a selector — the method lives in a published package, not here
public/sample-invoice.pdf     # sample PDF, so the PDF example works out of the box
scripts/                      # npm run codegen / codegen:check / codegen:verify / add-method / design
src/
  config.ts                   # ExecutionMode + DEFAULT_EXECUTION_MODE
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — blocking + start + poll trio per pipeline
  generated/                  # generated from methods/ — committed, never hand-edited
    summarize-pdf/            # types.ts (zod) + binder.ts + contracts.ts + design.ts + codegen.lock + sources.json
  brand.ts                    # the brand manifest a designed page renders under
  lib/
    pipelexClient.ts          # PipelexApiClient singleton
    design.ts                 # the designed-page model and its runtime fallback gate
    loadBundle.ts             # reads the .mthds bundles from disk
    blockingRun.ts            # the blocking execute path
    durableRun.ts             # the durable start + poll path
    wireOutput.ts             # reads main_stuff and readies it for a generated binder
    runInputs.ts              # requireContract + requireInputForm + gateRunInputs — the server-side input gate
    resultField.ts            # requireResultField — the output descriptor + payload schema → one RunField
    resultUrls.ts             # scrubResultUrls — the result's URL policy, fileEncoding's twin on the way out
    errors.ts                 # classifyPipelineError + PipelineError model
    fileEncoding.ts           # data-URL MIME + size validation
    usageReport.ts            # token usage → the render-ready cost report
    clientFile.ts             # browser File → base64 data URL
  hooks/
    useRun.ts                 # unified blocking|durable client state machine — the run
    useRunInputs.ts           # form values + readiness + the wire shape — the inputs
    useFileInputs.ts          # the drop → encode → write-back seam for file inputs
  components/                 # ExampleTabs + RunInputsForm + RunResult + DesignedPage + per-example chrome
  types/                      # thin adapters over src/generated/ — parseXxx(RunResults)
```

## How it works

Each example runs in one of **two execution modes**, switchable per-example at runtime with a small toggle:

- **Durable** (default) — the Server Action calls `PipelexApiClient.start()`, then the browser polls the run by id until it finishes, streaming live status. Survives the hosted gateway's ~30s synchronous cap, so long pipelines (like image generation) succeed.
- **Blocking** — the Server Action calls `PipelexApiClient.execute()` and waits. Simpler, but behind the hosted gateway a run over ~30s is cut off and surfaces a clear timeout error pointing you at Durable mode.

The flow, end to end:

1. A form renders its inputs with `useRunInputs(contract, descriptor)` + `<RunInputsForm>` — **no form field is written by hand**; every label, control and required-ness comes from the method's own wire input-form descriptor (co-walking its IO contract), both committed by `npm run codegen` (see [Input forms](#input-forms)). It then calls the `useRun({ mode, blocking, start, poll })` hook, which dispatches to the right **Server Actions** by mode.
2. The Server Action gates the same contract, applying the kernel's rules in full (a Server Action is a public endpoint; the browser's check is only UX), then names the method — reading its `.mthds` bundle from disk, or passing the selector its `method.json` manifest carries — and calls the SDK (`execute` for blocking, `start` + `getRunStatus`/`getRunResult` for durable) with it and the inputs.
3. The Pipelex API runs the pipe and returns the main output as `main_stuff` — the same resolved field on both paths.
4. A `parseXxx(results)` narrower in `src/types/` validates it into a typed shape, using a zod schema generated from the method's own `.mthds` bundle (see [Generated types](#generated-types)).
5. The hook drives the result: a live-status card while running, then `<RunResult>` — which renders the typed value from the method's own output-form descriptor, so **no result markup is written by hand either** — or a classified `PipelineError` shown by `<ErrorDisplay>`.

## Input forms

**No form field in this app is written by hand.** Each form is rendered from its method's wire input-form descriptor by the [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form) kernel: `npm run codegen` commits a `contracts.ts` beside the generated types — the method's IO contracts plus the descriptor, both from one `/v1/validate` call — the form derives its fields from it, and the Run button gates on whatever that method actually requires. Add an input to a `.mthds` bundle, re-run codegen, and it shows up with the right control and the right label — no component edit.

The same kernel supplies the input rules on **both** sides of the Server Action boundary, so there are no hand-written per-input guards left anywhere. The two sides call it differently, on purpose: the browser runs `computeReadiness` to decide whether Run is live, and the server runs `gateRunInputs` (`src/lib/runInputs.ts`), which calls readiness's own two functions over the same derived fields _and_ validates shapes _and_ builds the wire envelope. The server side is deliberately a strict superset — it is the trust boundary, because a Server Action is a public endpoint — and a test runs both sides over one table of inputs to hold them to it.

The **result** is the same idea on the other side of the contract. `npm run codegen` commits an output-form descriptor beside the input one, and `<RunResult>` renders the typed output through the kernel's result view: a structured concept becomes a labelled record, a plural one a table, a `native.Text` its typeset markdown, an image the picture with its file beneath it — all read off what the method declares, never off what the payload happens to look like. Change what a method produces, regenerate, and the view follows. There is no per-output component to keep in step, and a `JSON` tab sits beside the rendered view for whoever is debugging the pipe.

The full reference — the contract artifact, the server-side gate, the file seam, and the Tailwind setup (including the silent purge trap) — is [`docs/input-form.md`](docs/input-form.md).

### File & image inputs

Text inputs are plain strings. File inputs (the PDF example) go through one extra step:

1. The kernel's dropzone hands the app the dropped `File`; the app reads it into a base64 data URL with `fileToDataUrl` (`src/lib/clientFile.ts`) and writes it back into the form value. `File` objects are **not** serializable across the server boundary — the Server Action only ever receives the resulting `string`.
2. The Server Action validates the shape against the contract, then the file reference itself (`checkFileInputs` in `src/lib/fileEncoding.ts` — the authoritative scheme, MIME and size gate, which finds every file position by walking the method's own descriptor, so a list of documents or a file nested in a structured input is gated like a single one; the browser's own size check is an early exit that saves an encode, not a gate).
3. The Server Action hands the input to `client.prepareInputs()`, which reads the method's declared signature, recognizes the input as a file, uploads the bytes to Pipelex storage, and rewrites the input to a small `pipelex-storage://` URI. The run request carries that lightweight reference rather than fat inline base64 — the app never hosts the file itself.

The kernel's file control also offers "paste a URL instead", so an `https://` or `pipelex-storage://` reference works without any upload at all. Those two schemes and `data:` are the whole accepted set, checked before anything else: the SDK reads an unrecognised string as a path on the server's own disk, so a public Server Action has to refuse by default rather than assume "no bytes" means "nothing to check".

Image **outputs** (the image example) come back as a URL — a storage URL or a base64 data URL — which renders directly in an `<img>`.

## Generated types

The typed shapes this app validates against are **not hand-written** — each one is projected from the `.mthds` bundle that declares it, so the TypeScript and the method cannot drift apart:

```bash
npm run codegen         # regenerate src/generated/ from methods/ — needs an API key
npm run codegen:check   # prove the committed trees are current — offline, no key
npm run codegen:verify  # ask the API whether the committed types are still semantically current — needs a key
```

`npm run codegen` sends each method to the API's `/v1/codegen` route, which returns a `types.ts` (zod schemas plus their inferred TypeScript types), a `binder.ts` (`parseXxx` / `serializeXxx` over those schemas), and a `codegen.lock`. It also asks `/v1/validate` for the method's input/output contracts and **both** of its form descriptors (`views: ["input_form", "output_form"]`) and writes a `contracts.ts`, which is what the input forms render from, what the run gate validates against, and what the result view is built from. The codegen artifacts carry a stamp and the lock records their hashes; `contracts.ts` is deliberately unstamped, tracked instead by its hash in `sources.json`'s `derived` map. Either way `npm run codegen:check` re-derives the whole verdict **offline** — no key, no network — and fails if a generated file was edited, deleted, or left behind. Beside each lock, that same `sources.json` records a hash of every source `.mthds`, which catches the other kind of staleness: editing a bundle and forgetting to regenerate. `make check` runs that check, so `make all` does too.

A few things worth knowing:

- **The generated trees are committed on purpose.** `git clone && make all` passes with no API key, and the diff of a regeneration is itself a readable summary of what a bundle edit changed.
- **Never edit a file under `src/generated/`** — the stamp stops matching and `make check` says so. Customize by wrapping instead: `src/types/*.ts` is exactly that wrapper layer, and it is where hand-written semantics belong (`parseGeneratedImage`, for instance, additionally checks that the image URL is one a browser can load).
- **Field names stay wire-native.** `DocumentSummary` is `{ title, doc_type, key_points }`, not a camelCase mirror — a hand-maintained mirror is the duplication this removes.
- **`src/generated/` is excluded from Prettier and ESLint** (see `.prettierignore`), because reformatting the files would break their stamps. TypeScript still checks them in full.

**After editing anything under `methods/`, run `npm run codegen`** and commit the result alongside the bundle. `make check` fails until you do.

A method directory holds either a `.mthds` bundle or a `method.json` manifest naming a method that lives elsewhere; `npm run codegen` regenerates both kinds in one pass, and bumping a published method's version is an edit to that manifest's tag plus a regeneration. See [`docs/codegen.md`](docs/codegen.md) for the two source kinds, and [Add a method that lives elsewhere](#add-a-method-that-lives-elsewhere) for the gesture that writes one.

**Regeneration currently needs `PIPELEX_BASE_URL=https://api-dev.pipelex.com`.** Measured 2026-09-05: `api.pipelex.com` is on an older release that returns neither of `/v1/validate`'s `input_form` and `output_form` views (codegen needs both for every method) and does not advertise `method_ref` (which a package-sourced manifest needs). Both scripts say so rather than failing obscurely, and this is a deploy away. Nothing in the committed tree depends on it — `npm run codegen:check` is pure hashing, so `git clone && make all` passes with no key and no network either way.

## Designed pages

The forms above are rendered from what each method declares, which makes them correct for every method and generic for all of them: one column of controls, in the order the method lists them. A real product page has a shape a contract cannot supply — something above the fold saying what this does, the inputs grouped into steps, the call to action in a rail.

So this template ships a third committed artifact about a method: **the page a model designed for it.**

```bash
make design NAME=extract-entities   # produce a page — needs a key, and spends a model call
make design-check                   # prove the committed pages are current — offline, no key
```

`make design` renders a brief from the method's own committed contracts, runs the designer method [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form) ships as data, and commits what comes back at `methods/<name>/design.jsonl` with its provenance beside it. `npm run codegen` projects the pair into `src/generated/<name>/design.ts`, and the tab opens on the page instead of the form. **No inference happens at request time** — a page is a file in the repository, reviewed in a pull request like any other.

What makes committing a layout safe is the rule the form kernel is built on: **a layout names a path, and almost nothing more.** A design says "there is a text area here, bound to `/inputs/text`, and it is called Text". It never says what kind `text` is, what its bounds are, or which choices it offers — all of that still comes from the method, through the same descriptor the generic form uses. Three artifacts, three questions: the descriptor says what a field _is_, the design says where it _goes_, the store holds what the value _is_. So a design cannot go stale about a fact it never stated, and the everyday changes — a looser bound, a new choice, a reworded description — leave the page rendering.

The "almost" is a label and, usually, a `required` check the model binds to the input a run cannot go without. Those are the layout's own copy, and what keeps them honest is not the layout's silence but the gate's third question: the record signs the hash of every source the method is generated from, so any edit to a `.mthds` turns `make design-check` red and asks for the page again. [`docs/design.md`](docs/design.md) has the full rule.

Both views read one store, so the toggle between them carries your values across and both send the identical request. The Run button, the mode toggle and the server-side gate are unchanged. That is what makes the toggle worth having on every tab rather than only on a demo one: the same method, rendered two ways, with nothing behind them differing.

**When a design does not hold up, the generic form renders instead** — and that is a normal path, not an error path. Five causes: no design was produced (every method starts here, and a scaffolded one stays here until you run the gesture), the kernel's design vocabulary moved under it, the layout does not compile or validate, it no longer fits the method, or the page threw while rendering. `make design-check` catches the middle three offline on every `make all`, so a fallback in a browser is never news your CI could have delivered first — and it also catches the two staleness cases that matter: a layout edited by hand, and a method edited without re-designing.

A refused layout is written to `methods/<name>/design.rejected.jsonl` (gitignored — evidence, not an artifact) and the previous design stays committed. **Re-run it, with `SEED=` if the first run had none; never repair a layout by hand.** A hand-edited layout fails its own record's signature, and the next production silently undoes the edit.

The full reference — the artifacts, the gates, the fallback rule, the upload seam on a designed page — is [`docs/design.md`](docs/design.md).

## Swap in your own pipeline

1. Add `methods/<name>/main.mthds` (the `/mthds-build` skill from the [mthds-plugins](https://github.com/Pipelex/mthds-plugins) marketplace can generate one).
2. Run `npm run codegen` — it writes `src/generated/<name>/` with the zod schemas and binders for the concepts that method declares.
3. Add a loader in `src/lib/loadBundle.ts`, a `parseXxx(results)` adapter over the generated binder in `src/types/`, and the action trio (`run<Name>Blocking`, `start<Name>Run`, `poll<Name>Run`) in `src/actions/`. Each action takes the schema-shaped data dict and starts with `gateRunInputs(CONTRACT, data)`.
4. Wire it from a component with `useRunInputs(CONTRACT, DESCRIPTOR)` + `<RunInputsForm>` for the inputs, `useRun({ mode, blocking, start, poll })` for the run, and `<RunResult field={RESULT_FIELD} …>` for the output. **You write neither the form fields nor the result view** — both come from the method's own descriptors. The existing examples are the canonical patterns to copy.
5. Optional: `make design NAME=<name>` to give it a designed page. Nothing in the component changes — the examples already compose it — and until you run it the tab renders the generic form. See [Designed pages](#designed-pages).

## Add a method that lives elsewhere

The checklist above assumes the method's bundle is in this repo. When it isn't — when it was authored on [app.pipelex.com](https://app.pipelex.com) and saved under your organization, or published as a package in a public repository — one command does the whole checklist for you:

```bash
make add-method METHOD=github.com/Pipelex/methods/text_stats@v0.1.1   # a published package
make add-method METHOD=mt_abc123…                                      # a method in your org's catalog
```

It writes a `methods/<name>/method.json` manifest naming the method, the generated tree beside it, the narrower, the action trio, the form, an action test, and a tab entry — then tells you the one line to replace once you know what the output should look like. The "Text stats" tab this template ships is the output of exactly that command, committed untouched, so you have something to diff your own run against.

The method itself is never copied here: the manifest names it, the run resolves it server-side, and moving to a newer version is editing the tag and running `npm run codegen`. The gesture is **one-shot** — it refuses rather than overwriting a slice that already exists, because the files it writes become yours the moment they land.

Useful arguments: `PIPE=<pipe_code>` when the method carries several pipes (without it, the method's own default is used, and a method with several pipes and no default is refused listing them), `NAME=` and `LABEL=` to override the derived directory name and tab label, and `DRY_RUN=1` to print the whole plan without writing anything.

**It needs a key and a base URL that resolves the selector** — see the note on `PIPELEX_BASE_URL` in [Environment variables](#environment-variables). The full reference is [`docs/add-method.md`](docs/add-method.md).

## Remove an example

Stripping the demos is usually the first act of making this template yours. Each example is one vertical slice; removing one (say `extract-entities`) means deleting, in one commit:

1. The bundle: `methods/extract-entities/` — the whole directory, so a [designed page](#designed-pages) beside it goes too.
2. Its generated tree: `src/generated/extract-entities/` — `make check` fails on a generated tree with no method behind it (and vice versa), so always remove both together. Its `contracts.ts` goes with it, and with it the form that read it; so does its `design.ts`, and `make design-check` fails on a tree carrying a design for a method that is gone.
3. Its loader in `src/lib/loadBundle.ts`, its adapter in `src/types/extractEntitiesPipeline.ts`, and its action trio `src/actions/runExtractEntitiesPipeline.ts` — each with its co-located `.test.ts`, plus that loader's `describe` block in `src/lib/loadBundle.test.ts`.
4. Its component — `EntityForm.tsx` and its test — and its tab entry in `src/components/ExampleTabs.tsx`, whose own test (`ExampleTabs.test.tsx`) mocks that form and asserts its tab. There is no result component to remove: every example renders the shared `<RunResult>`.
5. Its e2e spec: `e2e/extract.spec.ts`.
6. The references the shared code keeps to it. The text example is the form `e2e/error-display.spec.ts` drives — repoint it at a surviving example. The blurb in `src/app/page.tsx` names the examples, and the bundle-read hint in `src/lib/errors.ts` names this one by path. The complex-inputs example is additionally named by the shared gate test (`src/lib/runInputs.test.ts` imports its contract for the structured and plural rows).

Then run `make all`. `tsc` type-checks the co-located tests, so it names most dangling references itself; the two it cannot see — the `vi.mock` module string in `ExampleTabs.test.tsx` and the Playwright selectors — surface as test failures instead. The PDF example additionally owns `public/sample-invoice.pdf`, and the image example is the one exercising the blocking-cap e2e case.

**A scaffolded example (`text-stats`) comes apart the same way, with one difference**: `methods/text-stats/` holds a `method.json` manifest rather than a bundle, so there is nothing in `src/lib/loadBundle.ts` to remove. Leave the two `add-method:` anchor comments in `ExampleTabs.tsx` in place — `make add-method` inserts at them, and a test fails if they go missing.

## Make targets

| Target                | Purpose                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `make dev`            | Start the Next.js dev server                                                                             |
| `make build`          | Production build                                                                                         |
| `make lint`           | ESLint                                                                                                   |
| `make format`         | Prettier write                                                                                           |
| `make format-check`   | Prettier check (CI)                                                                                      |
| `make typecheck`      | `tsc --noEmit` — app, e2e specs, and `scripts/`                                                          |
| `make codegen`        | Regenerate `src/generated/` from `methods/` (needs an API key — see [Generated types](#generated-types)) |
| `make codegen-check`  | Prove `src/generated/` is current — offline, no key (part of `make check`)                               |
| `make codegen-verify` | Ask the API whether the committed types still match the methods (needs an API key)                       |
| `make add-method`     | Scaffold a method that lives elsewhere into the app — `METHOD=<mt_… \| address>` (needs an API key)      |
| `make design`         | Produce a method's [designed page](#designed-pages) — `NAME=<method>` (needs an API key, spends a call)  |
| `make design-check`   | Prove the committed designs are current — offline, no key (part of `make check`)                         |
| `make test`           | Vitest single pass (unit tests, no API call)                                                             |
| `make agent-test`     | Vitest, silent on success (for AI agents)                                                                |
| `make test-e2e`       | **Optional** Playwright e2e — live API, costs an LLM call (prompts first; auto-skips without a key)      |
| `make test-e2e-ui`    | Same, with the Playwright UI runner                                                                      |
| `make check`          | lint + format-check + typecheck + codegen-check + design-check                                           |
| `make all`            | check + test + build (does **not** run e2e, `codegen` or `design` — all need a key)                      |
| `make use-local`      | Pack & install siblings `../pipelex-sdk-js` + `../mthds-form` into `node_modules` (alias: `ul`)          |
| `make use-npm`        | Restore the latest npm-published `@pipelex/sdk` + `@pipelex/mthds-form` packages (alias: `un`)           |

## End-to-end testing (optional)

The Playwright specs are **optional** — `make all` never runs them, and you can delete `e2e/` entirely if you don't want live tests. They open the dev server and exercise each example tab end-to-end, asserting the expected output.

The happy-path specs (`extract`, `summarize-pdf`, `generate-image`, `text-stats`) hit the **live** Pipelex API using `PIPELEX_API_KEY` from `.env.local`, so they cost an LLM call each. To keep that deliberate and safe:

- **They auto-skip without a key.** No `PIPELEX_API_KEY`? Those specs skip cleanly (you'll see them reported as skipped) instead of failing with an auth error — so a fresh fork can run `make test-e2e` before configuring credentials.
- **`make test-e2e` prompts for confirmation** before spending, since it costs money. The prompt is skipped in CI / non-interactive shells; pass `CONFIRM=1 make test-e2e` to bypass it in scripts.
- **It is excluded from `make all`.**
- The remaining spec, `error-display`, tests the offline error UX — it needs **no** key, costs nothing, and runs out of the box.
- First-time setup needs the browser binary: `npx playwright install chromium`.

## Local package development (sibling `pipelex-sdk-js` and `mthds-form` repos)

If you have the [`pipelex-sdk-js`](https://github.com/Pipelex/pipelex-sdk-js) and [`mthds-form`](https://github.com/Pipelex/mthds-form) repos checked out as sibling directories (`../pipelex-sdk-js`, `../mthds-form`) and want this app to use them instead of the published npm packages:

```bash
make use-local   # builds both siblings, packs each with `npm pack`, installs the tarballs into node_modules/@pipelex/{sdk,mthds-form}
make use-npm     # installs the latest published @pipelex/sdk + @pipelex/mthds-form and re-pins package.json to them
```

Aliases: `make ul` / `make un`. **Re-run `make use-local` after every edit to either sibling** — the tarball is a snapshot, not a live link. We use a tarball install rather than a symlink because Next.js 16's Turbopack does not follow symlinked workspace packages (`Module not found: Can't resolve '@pipelex/sdk'`).

## Environment variables

| Variable                     | Purpose                                                                                                                                                   | Default                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `PIPELEX_BASE_URL`           | Pipelex API base URL. Running the examples needs no override; `npm run codegen`, `codegen:verify` and `make add-method` currently do — see the note below | `https://api.pipelex.com` |
| `PIPELEX_API_KEY`            | Bearer token used by the SDK                                                                                                                              | (required at runtime)     |
| `NEXT_PUBLIC_EXECUTION_MODE` | Default execution mode for the examples — `durable` or `blocking`. Each example also has a runtime toggle.                                                | `durable`                 |

A variable already exported in your shell wins over `.env.local` — Next.js loads the file without overwriting what is already in the environment. If a run reaches an endpoint you did not configure here, check your shell first.

**The three keyed build-time scripts want `https://api-dev.pipelex.com` for now.** Running the app needs no override at all, but as measured on 2026-09-05 `api.pipelex.com` is on an older release: it returns neither of `/v1/validate`'s `input_form` and `output_form` views, both of which `npm run codegen` needs for every method, and it does not advertise the `method_ref` selector, which `make add-method` and a package-sourced manifest need. Each script names the missing capability and the base URL rather than failing obscurely. This is a deploy away, and it does not reach a consumer who only runs the app: the committed trees make `git clone && make all` pass with no key and no network.

## License

This project is licensed under the [MIT license](LICENSE). Runtime dependencies are distributed under their own licenses via npm.
