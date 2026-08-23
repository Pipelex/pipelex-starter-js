# pipelex-starter-js

A minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

It ships three demo pipelines, presented as tabs:

- **Text entities** (`methods/extract-entities`) — extracts `{ people, orgs, dates }` from pasted text.
- **PDF summary** (`methods/summarize-pdf`) — uploads a PDF in the browser and returns a structured `{ title, doc_type, key_points }` summary from a cheap OpenAI model.
- **Image generation** (`methods/generate-image`) — turns a text prompt into an image with `gpt-image-2`.

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
- **Tailwind CSS 3**
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

Open [http://localhost:4100](http://localhost:4100) and try the three example tabs.

## Project structure

```
methods/
  extract-entities/main.mthds # text → { people, orgs, dates }
  summarize-pdf/main.mthds    # PDF Document → { title, doc_type, key_points }
  generate-image/main.mthds   # text prompt → generated Image
public/sample-invoice.pdf     # sample PDF, so the PDF example works out of the box
scripts/                      # npm run codegen / codegen:check / codegen:verify
src/
  config.ts                   # ExecutionMode + DEFAULT_EXECUTION_MODE
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — blocking + start + poll trio per pipeline
  generated/                  # generated from methods/ — committed, never hand-edited
    summarize-pdf/            # types.ts (zod) + binder.ts + contracts.ts + codegen.lock + sources.json
  lib/
    pipelexClient.ts          # PipelexApiClient singleton
    loadBundle.ts             # reads the .mthds bundles from disk
    blockingRun.ts            # the blocking execute path
    durableRun.ts             # the durable start + poll path
    wireOutput.ts             # reads main_stuff and readies it for a generated binder
    runInputs.ts              # requireContract + gateRunInputs — the server-side input gate
    errors.ts                 # classifyPipelineError + PipelineError model
    fileEncoding.ts           # data-URL MIME + size validation
    usageReport.ts            # token usage → the render-ready cost report
    clientFile.ts             # browser File → base64 data URL
  hooks/
    useRun.ts                 # unified blocking|durable client state machine — the run
    useRunInputs.ts           # form values + readiness + the wire shape — the inputs
  components/                 # ExampleTabs + RunInputsForm + per-example form/result + chrome
  types/                      # thin adapters over src/generated/ — parseXxx(RunResults)
```

## How it works

Each example runs in one of **two execution modes**, switchable per-example at runtime with a small toggle:

- **Durable** (default) — the Server Action calls `PipelexApiClient.start()`, then the browser polls the run by id until it finishes, streaming live status. Survives the hosted gateway's ~30s synchronous cap, so long pipelines (like image generation) succeed.
- **Blocking** — the Server Action calls `PipelexApiClient.execute()` and waits. Simpler, but behind the hosted gateway a run over ~30s is cut off and surfaces a clear timeout error pointing you at Durable mode.

The flow, end to end:

1. A form renders its inputs with `useRunInputs(contract)` + `<RunInputsForm>` — **no form field is written by hand**; every label, control and required-ness comes from the method's own contract, committed by `npm run codegen` (see [Input forms](#input-forms)). It then calls the `useRun({ mode, blocking, start, poll })` hook, which dispatches to the right **Server Actions** by mode.
2. The Server Action gates the same contract, applying the kernel's rules in full (a Server Action is a public endpoint; the browser's check is only UX), then reads the `.mthds` bundle from disk and calls the SDK (`execute` for blocking, `start` + `getRunStatus`/`getRunResult` for durable) with the bundle TOML + inputs.
3. The Pipelex API runs the pipe and returns the main output as `main_stuff` — the same resolved field on both paths.
4. A `parseXxx(results)` narrower in `src/types/` validates it into a typed shape, using a zod schema generated from the method's own `.mthds` bundle (see [Generated types](#generated-types)).
5. The hook drives the result: a live-status card while running, then the result component, or a classified `PipelineError` shown by `<ErrorDisplay>`.

## Input forms

**No form field in this app is written by hand.** Each form is rendered from its method's input contract by the [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form) kernel: `npm run codegen` commits a `contracts.ts` beside the generated types, the form derives its fields from it, and the Run button gates on whatever that method actually requires. Add an input to a `.mthds` bundle, re-run codegen, and it shows up with the right control and the right label — no component edit.

The same kernel supplies the input rules on **both** sides of the Server Action boundary, so there are no hand-written per-input guards left anywhere. The two sides call it differently, on purpose: the browser runs `computeReadiness` to decide whether Run is live, and the server runs `gateRunInputs` (`src/lib/runInputs.ts`), which calls readiness's own two functions over the same derived fields _and_ validates shapes _and_ builds the wire envelope. The server side is deliberately a strict superset — it is the trust boundary, because a Server Action is a public endpoint — and a test runs both sides over one table of inputs to hold them to it.

The full reference — the contract artifact, the server-side gate, the file seam, and the Tailwind setup (including the silent purge trap) — is [`docs/input-form.md`](docs/input-form.md).

### File & image inputs

Text inputs are plain strings. File inputs (the PDF example) go through one extra step:

1. The kernel's dropzone hands the app the dropped `File`; the app reads it into a base64 data URL with `fileToDataUrl` (`src/lib/clientFile.ts`) and writes it back into the form value. `File` objects are **not** serializable across the server boundary — the Server Action only ever receives the resulting `string`.
2. The Server Action validates the shape against the contract, then the file reference itself (`checkFileInputs` in `src/lib/fileEncoding.ts` — the authoritative scheme, MIME and size gate; the browser's own size check is an early exit that saves an encode, not a gate).
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

`npm run codegen` sends each method to the API's `/v1/codegen` route, which returns a `types.ts` (zod schemas plus their inferred TypeScript types), a `binder.ts` (`parseXxx` / `serializeXxx` over those schemas), and a `codegen.lock`. It also asks `/v1/validate` for the method's input/output contracts and writes a `contracts.ts`, which is what the input forms render from. Every artifact carries a stamp and the lock records their hashes, so `npm run codegen:check` re-derives the whole verdict **offline** — no key, no network — and fails if a generated file was edited, deleted, or left behind. Beside each lock, a `sources.json` records a hash of every source `.mthds`, which catches the other kind of staleness: editing a bundle and forgetting to regenerate. `make check` runs that check, so `make all` does too.

A few things worth knowing:

- **The generated trees are committed on purpose.** `git clone && make all` passes with no API key, and the diff of a regeneration is itself a readable summary of what a bundle edit changed.
- **Never edit a file under `src/generated/`** — the stamp stops matching and `make check` says so. Customize by wrapping instead: `src/types/*.ts` is exactly that wrapper layer, and it is where hand-written semantics belong (`parseGeneratedImage`, for instance, additionally checks that the image URL is one a browser can load).
- **Field names stay wire-native.** `DocumentSummary` is `{ title, doc_type, key_points }`, not a camelCase mirror — a hand-maintained mirror is the duplication this removes.
- **`src/generated/` is excluded from Prettier and ESLint** (see `.prettierignore`), because reformatting the files would break their stamps. TypeScript still checks them in full.

**After editing anything under `methods/`, run `npm run codegen`** and commit the result alongside the bundle. `make check` fails until you do. Regeneration needs only `PIPELEX_API_KEY` — the default hosted API serves `/v1/codegen`, so no base-URL override is involved.

## Swap in your own pipeline

1. Add `methods/<name>/main.mthds` (the `/mthds-build` skill from the [mthds-plugins](https://github.com/Pipelex/mthds-plugins) marketplace can generate one).
2. Run `npm run codegen` — it writes `src/generated/<name>/` with the zod schemas and binders for the concepts that method declares.
3. Add a loader in `src/lib/loadBundle.ts`, a `parseXxx(results)` adapter over the generated binder in `src/types/`, and the action trio (`run<Name>Blocking`, `start<Name>Run`, `poll<Name>Run`) in `src/actions/`. Each action takes the schema-shaped data dict and starts with `gateRunInputs(CONTRACT, data)`.
4. Wire it from a component with `useRunInputs(CONTRACT)` + `<RunInputsForm>` for the inputs and `useRun({ mode, blocking, start, poll })` for the run. **You write no form fields** — they come from the contract. The three existing examples are the canonical patterns to copy.

## Remove an example

Stripping the demos is usually the first act of making this template yours. Each example is one vertical slice; removing one (say `extract-entities`) means deleting, in one commit:

1. The bundle: `methods/extract-entities/`.
2. Its generated tree: `src/generated/extract-entities/` — `make check` fails on a generated tree with no method behind it (and vice versa), so always remove both together. Its `contracts.ts` goes with it, and with it the form that read it.
3. Its loader in `src/lib/loadBundle.ts`, its adapter in `src/types/extractEntitiesPipeline.ts`, and its action trio `src/actions/runExtractEntitiesPipeline.ts` — each with its co-located `.test.ts`, plus that loader's `describe` block in `src/lib/loadBundle.test.ts`.
4. Its components — `EntityForm.tsx`, `EntityResult.tsx` and their tests — and its tab entry in `src/components/ExampleTabs.tsx`, whose own test (`ExampleTabs.test.tsx`) mocks that form and asserts its tab.
5. Its e2e spec: `e2e/extract.spec.ts`.
6. The references the shared code keeps to it. The text example is the form `e2e/error-display.spec.ts` drives — repoint it at a surviving example. The blurb in `src/app/page.tsx` names all three examples, and the bundle-read hint in `src/lib/errors.ts` names this one by path.

Then run `make all`. `tsc` type-checks the co-located tests, so it names most dangling references itself; the two it cannot see — the `vi.mock` module string in `ExampleTabs.test.tsx` and the Playwright selectors — surface as test failures instead. The PDF example additionally owns `public/sample-invoice.pdf`, and the image example is the one exercising the blocking-cap e2e case.

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
| `make test`           | Vitest single pass (unit tests, no API call)                                                             |
| `make agent-test`     | Vitest, silent on success (for AI agents)                                                                |
| `make test-e2e`       | **Optional** Playwright e2e — live API, costs an LLM call (prompts first; auto-skips without a key)      |
| `make test-e2e-ui`    | Same, with the Playwright UI runner                                                                      |
| `make check`          | lint + format-check + typecheck + codegen-check                                                          |
| `make all`            | check + test + build (does **not** run e2e or `codegen` — both need a key)                               |
| `make use-local`      | Pack & install sibling `../pipelex-sdk-js` into `node_modules` (alias: `ul`)                             |
| `make use-npm`        | Restore the latest npm-published `@pipelex/sdk` package (alias: `un`)                                    |

## End-to-end testing (optional)

The Playwright specs are **optional** — `make all` never runs them, and you can delete `e2e/` entirely if you don't want live tests. They open the dev server and exercise each example tab end-to-end, asserting the expected output.

The three happy-path specs (`extract`, `summarize-pdf`, `generate-image`) hit the **live** Pipelex API using `PIPELEX_API_KEY` from `.env.local`, so they cost an LLM call each. To keep that deliberate and safe:

- **They auto-skip without a key.** No `PIPELEX_API_KEY`? Those specs skip cleanly (you'll see them reported as skipped) instead of failing with an auth error — so a fresh fork can run `make test-e2e` before configuring credentials.
- **`make test-e2e` prompts for confirmation** before spending, since it costs money. The prompt is skipped in CI / non-interactive shells; pass `CONFIRM=1 make test-e2e` to bypass it in scripts.
- **It is excluded from `make all`.**
- The fourth spec, `error-display`, tests the offline error UX — it needs **no** key, costs nothing, and runs out of the box.
- First-time setup needs the browser binary: `npx playwright install chromium`.

## Local SDK development (sibling `pipelex-sdk-js` repo)

If you have the [`pipelex-sdk-js`](https://github.com/Pipelex/pipelex-sdk-js) repo checked out as a sibling directory (`../pipelex-sdk-js`) and want this app to use it instead of the published npm package:

```bash
make use-local   # builds ../pipelex-sdk-js, packs it with `npm pack`, installs the tarball into node_modules/@pipelex/sdk
make use-npm     # installs the latest published @pipelex/sdk and re-pins package.json to it
```

Aliases: `make ul` / `make un`. **Re-run `make use-local` after every SDK edit** — the tarball is a snapshot, not a live link. We use a tarball install rather than a symlink because Next.js 16's Turbopack does not follow symlinked workspace packages (`Module not found: Can't resolve '@pipelex/sdk'`).

## Environment variables

| Variable                     | Purpose                                                                                                    | Default                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------- |
| `PIPELEX_BASE_URL`           | Pipelex API base URL. Override only to point at another Pipelex endpoint                                   | `https://api.pipelex.com` |
| `PIPELEX_API_KEY`            | Bearer token used by the SDK                                                                               | (required at runtime)     |
| `NEXT_PUBLIC_EXECUTION_MODE` | Default execution mode for the examples — `durable` or `blocking`. Each example also has a runtime toggle. | `durable`                 |

A variable already exported in your shell wins over `.env.local` — Next.js loads the file without overwriting what is already in the environment. If a run reaches an endpoint you did not configure here, check your shell first.

## License

This project is licensed under the [MIT license](LICENSE). Runtime dependencies are distributed under their own licenses via npm.
