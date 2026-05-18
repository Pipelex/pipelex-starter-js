# pipelex-starter-js

Minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`mthds`](https://www.npmjs.com/package/mthds) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.

This repo is a **reference template**. Keep it small, clear, and high-quality — clarity beats features. When adding anything, ask: "would I want every consumer of this template to inherit this?"

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS 3 (minimal, no design system — keep classes inline and obvious)
- **Testing**: Vitest 4 + Testing Library (happy-dom) for unit; Playwright for e2e
- **Linting**: ESLint 9 (flat config via `eslint-config-next`)
- **Formatting**: Prettier 3
- **Git hooks**: Husky + lint-staged
- **SDK**: [`mthds`](https://www.npmjs.com/package/mthds) (`MthdsApiClient`)

## Project Structure

```
methods/
  hello/main.mthds            # demo pipeline (TOML)
src/
  app/                        # Next.js App Router (layout, page, globals.css)
  actions/
    runHelloPipeline.ts       # 'use server' Server Action calling the SDK
  lib/
    pipelexClient.ts          # MthdsApiClient singleton factory
    loadBundle.ts             # fs.readFile of methods/hello/main.mthds
    errors.ts                 # classifyPipelineError + PipelineError display model
  components/
    EntityForm.tsx            # client component (textarea + submit)
    EntityResult.tsx          # server component (renders structured output)
    ErrorDisplay.tsx          # server component (renders classified PipelineError)
  types/
    helloPipeline.ts          # ExtractedEntities + BadPipelineOutputError + parseEntities()
e2e/
  extract.spec.ts             # Playwright e2e (hits live API)
```

### What lives where

- **`methods/`** — `.mthds` bundles (TOML). Treat them as first-class artifacts, not embedded strings. Use the `/mthds-build`, `/mthds-edit`, `/mthds-check`, `/mthds-run` skills from the `mthds-plugins` marketplace to author and validate them.
- **`src/actions/`** — Server Actions (`"use server"`). The only place that calls the Pipelex SDK. Keep them thin: load bundle → call SDK → narrow output → return.
- **`src/lib/`** — Server-side utilities. No React. `errors.ts` is the one exception: its types cross the server→client boundary, and `classifyTransportError` runs client-side (called from `EntityForm` to handle rejected Server Action awaits).
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
    const response = await getPipelexClient().executePipeline({
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
- **One client**: instantiate `MthdsApiClient` once via `getPipelexClient()`. Never `new MthdsApiClient()` directly in actions or components.
- **Narrow at the boundary**: the SDK returns loosely-typed `pipe_output`. Always pass it through a `parseXxx()` narrower in `src/types/` that throws a tagged subclass of `Error` (e.g. `BadPipelineOutputError`) on shape mismatch. Do not `as` your way through.
- **Return classified errors, don't throw across the server→client boundary**: server actions return `{ ok: true, ... } | { ok: false, error: PipelineError }`. Throwing works in dev but Next.js production builds strip server-action error messages to opaque digests, which destroys the developer-facing error UX. Wrap the SDK call in `try/catch`, hand the caught value to `classifyPipelineError(err, env)`, and return the structured error. Render it client-side with `<ErrorDisplay>`.
- **Add new error kinds in `src/lib/errors.ts`**: extend `PipelineErrorKind`, add a branch in `classifyPipelineError`, and cover it in `src/lib/errors.test.ts` (table-driven). Keep `classifyPipelineError` pure — env passed in by caller, no `process.env` reads inside. Client-side rejections of awaited Server Actions go through `classifyTransportError` instead — the SDK error classes don't survive the server→client boundary, so they would never `instanceof`-match on the client.
- **Wrap awaited Server Action calls in `try/catch` on the client** and route catches through `classifyTransportError(err)`. Even though the action's own catch turns application errors into `{ ok: false, error }`, the await itself can still reject (network drop, dev server crash, stale Server Action ID after a deploy) — without the client-side catch, the rejection escapes `startTransition` and bypasses `<ErrorDisplay>` via React's error boundary.

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
- **Mocking the SDK**: mock `@/lib/pipelexClient` with `vi.mock`, returning `{ executePipeline: vi.fn() }`. Do **not** mock the `mthds` package directly — it's harder to wire as a constructor and the indirection adds noise.

### E2E (Playwright)

- **Location**: `e2e/*.spec.ts`
- **Spec hits the live Pipelex API** using `PIPELEX_API_KEY` from `.env.local` — costs an LLM call per run
- **Excluded from `make all`** — run explicitly with `make test-e2e`
- **First-time setup**: `npx playwright install chromium`
- **Excluded from**: `vitest.config.mts` (`exclude: ["e2e/**", ...]`) and `tsconfig.json` (`exclude: [..., "e2e"]`) so unit-test infra and Next's typecheck don't pick up Playwright specs

## Scripts (via Make)

| Target              | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `make dev`          | Start the Next.js dev server                            |
| `make build`        | Production build                                        |
| `make lint`         | ESLint                                                  |
| `make format`       | Prettier write                                          |
| `make format-check` | Prettier check (CI)                                     |
| `make typecheck`    | `tsc --noEmit`                                          |
| `make test`         | Vitest single pass                                      |
| `make agent-test`   | Vitest, silent on success (preferred for AI agents)     |
| `make test-e2e`     | Playwright e2e (live API, costs an LLM call)            |
| `make check`        | lint + format-check + typecheck                         |
| `make all`          | check + test + build (does **not** include e2e)         |
| `make use-local`    | Pack and install sibling `../mthds-js` (alias: `ul`)    |
| `make use-npm`      | Restore the npm-published `mthds` package (alias: `un`) |

## Local SDK development (`use-local`)

When working on this starter alongside the SDK, use `make use-local` to install `../mthds-js` (sibling) into `node_modules/mthds` instead of the npm package. The target builds `../mthds-js`, packs it with `npm pack`, then installs the resulting tarball.

We use a tarball install rather than a symlink (`ln -s`) because Next.js 16's Turbopack does not follow symlinked workspace packages — both `npm run dev` and `npm run build` fail with `Module not found: Can't resolve 'mthds'` against a symlinked entry. **Re-run `make use-local` after every SDK edit** to pick up changes. `make use-npm` restores the published version.

## Workflow Rules

**After any code change, run `make all`.** It runs `check` (lint + format-check + typecheck) + `test` + `build`, which catches the four failure classes that block CI: ESLint violations, Prettier formatting drift, TypeScript errors, and broken unit tests / production build. Do not declare a task done if `make all` doesn't pass cleanly.

If `make format-check` fails, run `make format` to auto-fix and re-run `make all`. Don't hand-edit files to satisfy Prettier — let the formatter do it.

Other targets that matter:

- **`make agent-test`** instead of `make test` when an AI agent runs the suite. It's silent on success; only failures hit the context.
- **`make test-e2e`** before shipping changes that touch the SDK call path (`src/actions/`, `src/lib/pipelexClient.ts`, `src/lib/loadBundle.ts`, `src/lib/errors.ts`, `methods/`). Unit tests mock the SDK; only e2e exercises the real API and the rendered error UX. Not part of `make all` (costs an LLM call per run).
- **`make use-local`** after editing the sibling `../mthds-js` SDK, before re-running tests or the dev server. The tarball install only refreshes when the target re-runs.

## Git Workflow

- **PR target branch**: `main`.

## Anti-patterns to Avoid

- **No bundle TOML inlined in `.ts` files** — bundles live in `methods/<name>/main.mthds`.
- **No raw `fetch()` to the Pipelex API** — always go through `MthdsApiClient`. (If you find a missing capability in the SDK, fix it upstream in `mthds-js`, don't bypass it here.)
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
