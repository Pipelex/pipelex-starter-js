# pipelex-starter-js

A minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`mthds`](https://www.npmjs.com/package/mthds) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

It ships three demo pipelines, presented as tabs:

- **Text entities** (`methods/hello`) — extracts `{ people, orgs, dates }` from pasted text.
- **PDF summary** (`methods/summarize-pdf`) — uploads a PDF in the browser and returns a structured `{ title, docType, keyPoints }` summary from a cheap OpenAI model.
- **Image generation** (`methods/generate-image`) — turns a text prompt into an image with `gpt-image-1-mini`.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5** (strict)
- **Tailwind CSS 3**
- **Vitest 4** + Testing Library (happy-dom)
- **ESLint 9** + **Prettier 3**, **Husky** + **lint-staged**
- **`mthds`** SDK for Pipelex API calls

## Prerequisites

- Node.js 22+
- Access to a **Pipelex API** server. You have two options:
  - **Hosted** — currently in private beta. Join the waitlist at [go.pipelex.com/waitlist](https://go.pipelex.com/waitlist). Once you have access, get an API key at [app.pipelex.com](https://app.pipelex.com) and point `PIPELEX_API_URL` at `https://api.pipelex.com` (the default).
  - **Self-hosted** — the Pipelex API is open source at [github.com/Pipelex/pipelex-api](https://github.com/Pipelex/pipelex-api). Run it locally or on your own infra and point `PIPELEX_API_URL` at your instance (e.g. `http://localhost:8000`).

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
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — one per pipeline
  lib/
    pipelexClient.ts          # MthdsApiClient singleton
    loadBundle.ts             # reads the .mthds bundles from disk
    errors.ts                 # classifyPipelineError + PipelineError model
    fileEncoding.ts           # data-URL validation + Document input envelope
    clientFile.ts             # browser File → base64 data URL
  components/                 # ExampleTabs + per-example form/result components
  types/                      # concept types + parseXxx() narrowers
```

## How it works

1. The browser submits to a **Server Action** (`runHelloPipeline`, `runSummarizePdfPipeline`, or `runGenerateImagePipeline`).
2. The Server Action reads the `.mthds` bundle from disk and calls `MthdsApiClient.execute()` with the bundle TOML + inputs.
3. The Pipelex API runs the pipe and returns loosely-typed output.
4. A `parseXxx()` narrower in `src/types/` validates the output into a typed shape.
5. The result is rendered, or a classified `PipelineError` is shown by `<ErrorDisplay>`.

## File & image inputs

Text inputs are plain strings. File inputs (the PDF example) go through one extra step:

1. The browser reads the chosen `File` into a base64 data URL with `fileToDataUrl` (`src/lib/clientFile.ts`). `File` objects are **not** serializable across the server boundary — the Server Action only ever receives the resulting `string`.
2. The Server Action validates the data URL (`validateDataUrl`) and wraps it in a Pipelex `Document` envelope (`buildDocumentInput` → `{ concept: "Document", content: { url, filename, mime_type } }`).
3. The Pipelex API decodes the data URL server-side — the app never hosts the file itself.

Image **outputs** (the image example) come back as a URL — a storage URL or a base64 data URL — which renders directly in an `<img>`.

## Swap in your own pipeline

1. Add `methods/<name>/main.mthds` (the `/mthds-build` skill from the [mthds-plugins](https://github.com/Pipelex/mthds-plugins) marketplace can generate one).
2. Add a loader in `src/lib/loadBundle.ts`, a type + `parseXxx()` narrower in `src/types/`, and a Server Action in `src/actions/`.
3. Wire it from a component. The three existing examples are the canonical patterns to copy.

## Make targets

| Target              | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `make dev`          | Start the Next.js dev server                                           |
| `make build`        | Production build                                                       |
| `make lint`         | ESLint                                                                 |
| `make format`       | Prettier write                                                         |
| `make format-check` | Prettier check (CI)                                                    |
| `make typecheck`    | `tsc --noEmit`                                                         |
| `make test`         | Vitest single pass (unit tests, no API call)                           |
| `make agent-test`   | Vitest, silent on success (for AI agents)                              |
| `make test-e2e`     | Playwright e2e — hits the real Pipelex API, needs a valid key          |
| `make test-e2e-ui`  | Same, with the Playwright UI runner                                    |
| `make check`        | lint + format-check + typecheck                                        |
| `make all`          | check + test + build (does **not** run e2e — see `test-e2e`)           |
| `make use-local`    | Pack & install sibling `../mthds-js` into `node_modules` (alias: `ul`) |
| `make use-npm`      | Restore the npm-published `mthds` package (alias: `un`)                |

## End-to-end testing

`make test-e2e` runs Playwright specs that open the dev server and exercise each of the three example tabs end-to-end — entity extraction, PDF summary, and image generation — asserting the expected output for each. The specs hit the **live** Pipelex API using `PIPELEX_API_KEY` from `.env.local`, so:

- It costs an LLM call per run.
- It is intentionally excluded from `make all`.
- First-time setup needs the browser binary: `npx playwright install chromium`.

## Local SDK development (sibling `mthds-js` repo)

If you have the [`mthds-js`](https://github.com/mthds-ai/mthds-js) repo checked out as a sibling directory (`../mthds-js`) and want this app to use it instead of the published npm package:

```bash
make use-local   # builds ../mthds-js, packs it with `npm pack`, installs the tarball into node_modules/mthds
make use-npm     # restores the npm version
```

Aliases: `make ul` / `make un`. **Re-run `make use-local` after every SDK edit** — the tarball is a snapshot, not a live link. We use a tarball install rather than a symlink because Next.js 16's Turbopack does not follow symlinked workspace packages (`Module not found: Can't resolve 'mthds'`).

## Environment variables

| Variable          | Purpose                                                                                                                              | Default                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `PIPELEX_API_URL` | Pipelex API base URL — hosted (`https://api.pipelex.com`) or your own [self-hosted instance](https://github.com/Pipelex/pipelex-api) | `https://api.pipelex.com` |
| `PIPELEX_API_KEY` | Bearer token used by the SDK                                                                                                         | (required at runtime)     |

## License

This project is licensed under the [MIT license](LICENSE). Runtime dependencies are distributed under their own licenses via npm.
