# pipelex-starter-js

A minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`mthds`](https://www.npmjs.com/package/mthds) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

The included demo pipeline (`methods/hello/main.mthds`) takes a piece of text and returns structured `{ people, orgs, dates }` entities.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5** (strict)
- **Tailwind CSS 3**
- **Vitest 4** + Testing Library (happy-dom)
- **ESLint 9** + **Prettier 3**, **Husky** + **lint-staged**
- **`mthds`** SDK for Pipelex API calls

## Prerequisites

- Node.js 18+
- A Pipelex API key — get one at [app.pipelex.com](https://app.pipelex.com).

## Quick start

```bash
cp .env.example .env.local
# edit .env.local and set PIPELEX_API_KEY
make install
make dev
```

Open [http://localhost:3000](http://localhost:3000), paste a sentence, click **Extract entities**.

## Project structure

```
methods/hello/main.mthds      # the demo pipeline (TOML)
src/
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/runHelloPipeline.ts # 'use server' Server Action calling the SDK
  lib/pipelexClient.ts        # MthdsApiClient singleton
  lib/loadBundle.ts           # reads methods/hello/main.mthds
  components/                 # EntityForm (client) + EntityResult (server)
  types/helloPipeline.ts      # ExtractedEntities type + parseEntities() narrower
```

## How it works

1. The browser submits the textarea to the **Server Action** `runHelloPipeline`.
2. The Server Action reads the `.mthds` bundle from disk and calls `MthdsApiClient.executePipeline()` with the bundle TOML + input text.
3. The Pipelex API runs the `extract_entities` pipe (a `PipeLLM`) and returns structured output.
4. `parseEntities()` narrows the loosely-typed SDK response into our `ExtractedEntities` type.
5. The result is rendered by `<EntityResult>`.

## Swap in your own pipeline

1. Replace `methods/hello/main.mthds` with your own bundle (or add new ones). The `/mthds-build` skill from the [mthds-plugins](https://github.com/Pipelex/mthds-plugins) marketplace can generate one for you.
2. Update `src/actions/runHelloPipeline.ts` — change `pipe_code`, the `inputs` shape, and the parser.
3. Update `src/types/helloPipeline.ts` to match your concept's structure.

## Make targets

| Target              | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `make dev`          | Start the Next.js dev server                                    |
| `make build`        | Production build                                                |
| `make lint`         | ESLint                                                          |
| `make format`       | Prettier write                                                  |
| `make format-check` | Prettier check (CI)                                             |
| `make typecheck`    | `tsc --noEmit`                                                  |
| `make test`         | Vitest single pass (unit tests, no API call)                    |
| `make agent-test`   | Vitest, silent on success (for AI agents)                       |
| `make test-e2e`     | Playwright e2e — hits the real Pipelex API, needs a valid key   |
| `make test-e2e-ui`  | Same, with the Playwright UI runner                             |
| `make check`        | lint + format-check + typecheck                                 |
| `make all`          | check + test + build (does **not** run e2e — see `test-e2e`)    |
| `make use-local`    | Symlink sibling `../mthds-js` into `node_modules` (alias: `ul`) |
| `make use-npm`      | Restore the npm-published `mthds` package (alias: `un`)         |

## End-to-end testing

`make test-e2e` runs a Playwright spec that opens the dev server, fills in the sample text, clicks **Extract entities**, and asserts that the expected entities appear. It hits the **live** Pipelex API using `PIPELEX_API_KEY` from `.env.local`, so:

- It costs an LLM call per run.
- It is intentionally excluded from `make all`.
- First-time setup needs the browser binary: `npx playwright install chromium`.

## Local SDK development (sibling `mthds-js` repo)

If you have the [`mthds-js`](https://github.com/mthds-ai/mthds-js) repo checked out as a sibling directory (`../mthds-js`) and want this app to use it instead of the published npm package:

```bash
make use-local   # builds ../mthds-js, symlinks it into node_modules/mthds
make use-npm     # restores the npm version
```

Aliases: `make ul` / `make un`. Mirrors the pattern used by `playroom/`.

## Environment variables

| Variable          | Purpose                      | Default                   |
| ----------------- | ---------------------------- | ------------------------- |
| `PIPELEX_API_URL` | Pipelex API base URL         | `https://api.pipelex.com` |
| `PIPELEX_API_KEY` | Bearer token used by the SDK | (required at runtime)     |

## License

MIT
