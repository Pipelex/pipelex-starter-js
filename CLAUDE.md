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
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/                    # 'use server' Server Actions — one per pipeline
    runHelloPipeline.ts
    runSummarizePdfPipeline.ts
    runGenerateImagePipeline.ts
  lib/
    pipelexClient.ts          # PipelexApiClient singleton factory
    loadBundle.ts             # fs.readFile of the .mthds bundles
    errors.ts                 # classifyPipelineError + PipelineError display model
    fileEncoding.ts           # data-URL validation + Document input envelope (server)
    clientFile.ts             # browser File → base64 data URL (client)
  components/
    ExampleTabs.tsx           # client component — tab switcher for the 3 examples
    EntityForm/PdfForm/ImageForm.tsx        # client components (per-example input)
    EntityResult/PdfSummaryResult/ImageResult.tsx  # server components (render output)
    ErrorDisplay.tsx          # server component (renders classified PipelineError)
  types/
    pipelineError.ts          # BadPipelineOutputError + BadImageOutputError (tagged)
    helloPipeline.ts          # ExtractedEntities + parseEntities()
    summarizePipeline.ts      # DocumentSummary + parseDocumentSummary()
    generateImagePipeline.ts  # GeneratedImage + parseGeneratedImage()
e2e/
  extract.spec.ts             # Playwright e2e (hits live API)
  summarize-pdf.spec.ts
  generate-image.spec.ts
```

### What lives where

- **`methods/`** — `.mthds` bundles (TOML). Treat them as first-class artifacts, not embedded strings. Use the `/mthds-build`, `/mthds-edit`, `/mthds-check`, `/mthds-run` skills from the `mthds-plugins` marketplace to author and validate them.
- **`src/actions/`** — Server Actions (`"use server"`). The only place that calls the Pipelex SDK. Keep them thin: load bundle → call SDK → narrow output → return.
- **`src/lib/`** — Server-side utilities. No React. Two deliberate client-touching exceptions: `errors.ts` (its types cross the server→client boundary, and `classifyTransportError` runs client-side), and `clientFile.ts` (a browser `FileReader` wrapper imported only by client components). `fileEncoding.ts` is pure (no React, no `process.env`) so it is safe to import from either side. Because `errors.ts` is bundled into the client, it imports the SDK error classes from **`@pipelex/sdk`**. That barrel is client-safe — `PipelexApiClient` is fetch-based and pulls no `node:fs` into the graph — so a client bundler handles it without breaking `make build`. Only `pipelexClient.ts` (server-only) constructs `PipelexApiClient` from `@pipelex/sdk`.
- **`src/components/`** — React components. `"use client"` only when the component uses hooks, event handlers, or browser APIs.
- **`src/types/`** — TS types and runtime narrowers (`parseXxx()`). Narrowers throw on shape mismatch; that's deliberate (system boundary).

## Pipelex Integration Pattern

The Server Action pattern: bundle on disk → SDK call → narrow → return discriminated union.

```ts
// src/actions/runHelloPipeline.ts
"use server";
import { getPipelexClient } from "@/lib/pipelexClient";
import { loadHelloBundle } from "@/lib/loadBundle";
import { parseEntities, type ExtractedEntities } from "@/types/helloPipeline";
import { classifyPipelineError, type PipelineError } from "@/lib/errors";

export type RunHelloPipelineResult =
  | { ok: true; entities: ExtractedEntities }
  | { ok: false; error: PipelineError };

export async function runHelloPipeline(text: string): Promise<RunHelloPipelineResult> {
  try {
    const bundle = await loadHelloBundle();
    const response = await getPipelexClient().execute({
      pipe_code: "extract_entities",
      mthds_contents: [bundle],
      inputs: { text: text.trim() },
    });
    return { ok: true, entities: parseEntities(response.pipe_output) };
  } catch (err) {
    return {
      ok: false,
      error: classifyPipelineError(err, {
        apiUrl: process.env.PIPELEX_API_URL,
        hasApiKey: Boolean(process.env.PIPELEX_API_KEY),
      }),
    };
  }
}
```

Conventions:

- **Bundle source**: ship `.mthds` files in the repo at `methods/<name>/main.mthds` and read them at request time with `fs.readFile`. Do **not** inline bundle TOML as a string in `.ts` — bundles are first-class.
- **One client**: instantiate `PipelexApiClient` once via `getPipelexClient()`. Never `new PipelexApiClient()` directly in actions or components.
- **Narrow at the boundary**: the SDK returns loosely-typed `pipe_output`. Always pass it through a `parseXxx()` narrower in `src/types/` that throws a tagged subclass of `Error` (e.g. `BadPipelineOutputError`) on shape mismatch. Do not `as` your way through.
- **Return classified errors, don't throw across the server→client boundary**: server actions return `{ ok: true, ... } | { ok: false, error: PipelineError }`. Throwing works in dev but Next.js production builds strip server-action error messages to opaque digests, which destroys the developer-facing error UX. Wrap the SDK call in `try/catch`, hand the caught value to `classifyPipelineError(err, env)`, and return the structured error. Render it client-side with `<ErrorDisplay>`.
- **Add new error kinds in `src/lib/errors.ts`**: extend `PipelineErrorKind`, add a branch in `classifyPipelineError`, and cover it in `src/lib/errors.test.ts` (table-driven). Keep `classifyPipelineError` pure — env passed in by caller, no `process.env` reads inside. Client-side rejections of awaited Server Actions go through `classifyTransportError` instead — the SDK error classes don't survive the server→client boundary, so they would never `instanceof`-match on the client. Pre-flight validation kinds (`file_too_large`, `unsupported_file_type`) are the exception: they are built inline by a Server Action _before_ the SDK call (there is no thrown error to classify), so they have no `classifyPipelineError` branch.
- **Wrap awaited Server Action calls in `try/catch` on the client** and route catches through `classifyTransportError(err)`. Even though the action's own catch turns application errors into `{ ok: false, error }`, the await itself can still reject (network drop, dev server crash, stale Server Action ID after a deploy) — without the client-side catch, the rejection escapes `startTransition` and bypasses `<ErrorDisplay>` via React's error boundary.

### File & image inputs

Text inputs are plain strings. File inputs (PDFs, images) take one extra step, demonstrated by the PDF example:

- **Encode client-side, never cross the boundary with a `File`.** The browser reads the `File` into a base64 data URL via `fileToDataUrl` (`src/lib/clientFile.ts`). Server Actions accept only serializable arguments — pass the `string` data URL + filename, never a `File`, `Blob`, or `FormData`.
- **Validate, then build the envelope server-side.** The Server Action calls `validateDataUrl` (authoritative MIME + size gate) and `buildDocumentInput` (`src/lib/fileEncoding.ts`), which produces a Pipelex `Document` input: `{ concept: "Document", content: { url, filename, mime_type } }`. Images use the same shape with `concept: "Image"`. The Pipelex API decodes the base64 data URL server-side.
- **Re-validate on the server.** The client may also pre-check for fast UX feedback, but that is trivially bypassed — the Server Action's `validateDataUrl` call is the real gate.
- **Mind the Server Action body limit.** Next.js caps Server Action bodies at 1 MB by default; base64 inflates payloads ~37%. `next.config.js` raises `serverActions.bodySizeLimit`, and `MAX_PDF_BYTES` in `fileEncoding.ts` caps the raw file size with margin.
- **File/image outputs come back as a URL** — a storage URL or a base64 data URL — in `pipe_output`. The `parseXxx()` narrower extracts it; render it directly in an `<img>` (see `ImageResult.tsx`).

To add a new pipeline:

1. Create `methods/<name>/main.mthds` (use `/mthds-build`).
2. Add `loadXxxBundle()` in `src/lib/loadBundle.ts` (or one helper per bundle).
3. Add the type + narrower (with a tagged error subclass) in `src/types/<name>.ts`.
4. Add a Server Action in `src/actions/run<Name>Pipeline.ts` that returns a `Run<Name>PipelineResult` union and uses `classifyPipelineError` in the catch.
5. Wire it from a component, render `<ErrorDisplay error={result.error} />` when `!result.ok`, and wrap the awaited action call in `try/catch` so transport-level rejections route through `classifyTransportError`. See `src/components/EntityForm.tsx` for the canonical pattern.

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
- **Mocking the SDK**: mock `@/lib/pipelexClient` with `vi.mock`, returning `{ execute: vi.fn() }`. Do **not** mock the `@pipelex/sdk` package directly — it's harder to wire as a constructor and the indirection adds noise.

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
- **`make test-e2e`** before shipping changes that touch the SDK call path (`src/actions/`, `src/lib/pipelexClient.ts`, `src/lib/loadBundle.ts`, `src/lib/errors.ts`, `src/lib/fileEncoding.ts`, `methods/`). Unit tests mock the SDK; only e2e exercises the real API and the rendered error UX. Not part of `make all` (costs an LLM call per run).
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
