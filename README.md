# pipelex-starter-js

A minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`@pipelex/sdk`](https://www.npmjs.com/package/@pipelex/sdk) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

It ships three demo pipelines, presented as tabs:

- **Text entities** (`methods/hello`) — extracts `{ people, orgs, dates }` from pasted text.
- **PDF summary** (`methods/summarize-pdf`) — uploads a PDF in the browser and returns a structured `{ title, docType, keyPoints }` summary from a cheap OpenAI model.
- **Image generation** (`methods/generate-image`) — turns a text prompt into an image with `gpt-image-1-mini`.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5** (strict)
- **Tailwind CSS 3**
- **Vitest 4** + Testing Library (happy-dom)
- **ESLint 9** + **Prettier 3**, **Husky** + **lint-staged**
- **`@pipelex/sdk`** SDK for Pipelex API calls

## Prerequisites

- Node.js 22.12+ (the SDK is ESM-only and the e2e specs `require()` it, which needs Node's unflagged `require(esm)`)
- Access to a **Pipelex API** server. You have two options:
  - **Hosted** — currently in private beta. Join the waitlist at [go.pipelex.com/waitlist](https://go.pipelex.com/waitlist). Once you have access, get an API key at [app.pipelex.com](https://app.pipelex.com) and point `PIPELEX_BASE_URL` at `https://api.pipelex.com` (the default).
  - **Self-hosted** — the Pipelex API is open source at [github.com/Pipelex/pipelex-api](https://github.com/Pipelex/pipelex-api). Run it locally or on your own infra and point `PIPELEX_BASE_URL` at your instance (e.g. `http://localhost:8000`).

## Quick start

```bash
cp .env.example .env.local
# edit .env.local and set PIPELEX_API_KEY
make install
make dev
```

Open [http://localhost:3000](http://localhost:3000) and try the three example tabs.

## Project structure

```
methods/
  hello/main.mthds            # text → { people, orgs, dates }
  summarize-pdf/main.mthds    # PDF Document → { title, docType, keyPoints }
  generate-image/main.mthds   # text prompt → generated Image
public/sample-invoice.pdf     # sample PDF, so the PDF example works out of the box
src/
  config.ts                   # ExecutionMode + DEFAULT_EXECUTION_MODE
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — blocking + start + poll trio per pipeline
  lib/
    pipelexClient.ts          # PipelexApiClient singleton
    loadBundle.ts             # reads the .mthds bundles from disk
    blockingRun.ts            # the blocking execute path
    durableRun.ts             # the durable start + poll path
    runOutput.ts              # main_stuff ?? pipe_output narrowing
    errors.ts                 # classifyPipelineError + PipelineError model
    fileEncoding.ts           # data-URL validation + Document input envelope
    clientFile.ts             # browser File → base64 data URL
  hooks/useRun.ts             # unified blocking|durable client state machine
  components/                 # ExampleTabs + per-example form/result + ModeToggle + RunStatus
  types/                      # concept types + parseXxx(RunResults) narrowers
```

## How it works

Each example runs in one of **two execution modes**, switchable per-example at runtime with a small toggle:

- **Durable** (default) — the Server Action calls `PipelexApiClient.start()`, then the browser polls the run by id until it finishes, streaming live status. Survives the hosted gateway's ~30s synchronous cap, so long pipelines (like image generation) succeed.
- **Blocking** — the Server Action calls `PipelexApiClient.execute()` and waits. Simpler, but behind the hosted gateway a run over ~30s is cut off and surfaces a clear timeout error pointing you at Durable mode.

The flow, end to end:

1. A form calls the `useRun({ mode, blocking, start, poll })` hook, which dispatches to the right **Server Actions** by mode.
2. The Server Action reads the `.mthds` bundle from disk and calls the SDK (`execute` for blocking, `start` + `getRunStatus`/`getRunResult` for durable) with the bundle TOML + inputs.
3. The Pipelex API runs the pipe and returns loosely-typed output (`main_stuff` on the durable path, `pipe_output` on blocking — one `findOutputContent` helper reads both).
4. A `parseXxx(results)` narrower in `src/types/` validates the output into a typed shape.
5. The hook drives the result: a live-status card while running, then the result component, or a classified `PipelineError` shown by `<ErrorDisplay>`.

## File & image inputs

Text inputs are plain strings. File inputs (the PDF example) go through one extra step:

1. The browser reads the chosen `File` into a base64 data URL with `fileToDataUrl` (`src/lib/clientFile.ts`). `File` objects are **not** serializable across the server boundary — the Server Action only ever receives the resulting `string`.
2. The Server Action validates the data URL (`validateDataUrl`) and wraps it in a Pipelex `Document` envelope (`buildDocumentInput` → `{ concept: "Document", content: { url, filename, mime_type } }`).
3. The Pipelex API decodes the data URL server-side — the app never hosts the file itself.

Image **outputs** (the image example) come back as a URL — a storage URL or a base64 data URL — which renders directly in an `<img>`.

## Swap in your own pipeline

1. Add `methods/<name>/main.mthds` (the `/mthds-build` skill from the [mthds-plugins](https://github.com/Pipelex/mthds-plugins) marketplace can generate one).
2. Add a loader in `src/lib/loadBundle.ts`, a type + `parseXxx(results)` narrower in `src/types/`, and the action trio (`run<Name>Blocking`, `start<Name>Run`, `poll<Name>Run`) in `src/actions/`.
3. Wire it from a component with `useRun({ mode, blocking, start, poll })`. The three existing examples are the canonical patterns to copy.

## Make targets

| Target              | Purpose                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `make dev`          | Start the Next.js dev server                                                                        |
| `make build`        | Production build                                                                                    |
| `make lint`         | ESLint                                                                                              |
| `make format`       | Prettier write                                                                                      |
| `make format-check` | Prettier check (CI)                                                                                 |
| `make typecheck`    | `tsc --noEmit`                                                                                      |
| `make test`         | Vitest single pass (unit tests, no API call)                                                        |
| `make agent-test`   | Vitest, silent on success (for AI agents)                                                           |
| `make test-e2e`     | **Optional** Playwright e2e — live API, costs an LLM call (prompts first; auto-skips without a key) |
| `make test-e2e-ui`  | Same, with the Playwright UI runner                                                                 |
| `make check`        | lint + format-check + typecheck                                                                     |
| `make all`          | check + test + build (does **not** run e2e — see `test-e2e`)                                        |
| `make use-local`    | Pack & install sibling `../pipelex-sdk-js` into `node_modules` (alias: `ul`)                        |
| `make use-npm`      | Restore the npm-published `@pipelex/sdk` package (alias: `un`)                                      |

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
make use-npm     # restores the npm version
```

Aliases: `make ul` / `make un`. **Re-run `make use-local` after every SDK edit** — the tarball is a snapshot, not a live link. We use a tarball install rather than a symlink because Next.js 16's Turbopack does not follow symlinked workspace packages (`Module not found: Can't resolve '@pipelex/sdk'`).

## Environment variables

| Variable                     | Purpose                                                                                                                              | Default                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `PIPELEX_BASE_URL`           | Pipelex API base URL — hosted (`https://api.pipelex.com`) or your own [self-hosted instance](https://github.com/Pipelex/pipelex-api) | `https://api.pipelex.com` |
| `PIPELEX_API_KEY`            | Bearer token used by the SDK                                                                                                         | (required at runtime)     |
| `NEXT_PUBLIC_EXECUTION_MODE` | Default execution mode for the examples — `durable` or `blocking`. Each example also has a runtime toggle.                           | `durable`                 |

## License

This project is licensed under the [MIT license](LICENSE). Runtime dependencies are distributed under their own licenses via npm.
