# Adding Pipelex to an existing TypeScript app

This repo is a template for starting from zero, but it is also the worked example of the pattern: run `.mthds` methods through `@pipelex/sdk` with output types **generated from the bundles**, so the TypeScript can never drift from what a method actually returns. This guide is the transplant checklist for bringing that pattern into an app you already have. It is written to be executed top to bottom — by a person or by an SWE agent.

Only one seam is Next.js-specific (env loading — step 3); everything else is framework-agnostic Node and React-optional.

## 1. Dependencies

```bash
npm install @pipelex/sdk zod
```

Both are **runtime** dependencies: the SDK makes the API calls, and the generated binders validate run output with zod at request time.

## 2. Copy the codegen kit

Copy these files, keeping their relative arrangement:

- `scripts/codegen.mts` — the generator (`npm run codegen`): sends every method under `methods/` to `POST /v1/codegen` and writes the returned artifacts verbatim.
- `scripts/codegen-check.mts` — the offline drift check (`npm run codegen:check`): no key, no network; proves the committed trees are current.
- `scripts/codegen-verify.mts` — the keyed semantic gate (`npm run codegen:verify`).
- `scripts/codegenShared.mts` — the paths, tree walk, hashing, and sidecar logic the three scripts share.
- `scripts/codegenShared.test.mts` — unit tests over the shared pure helpers (optional, but they guard the hashing and walk behavior).
- `tsconfig.scripts.json` — type-checks `scripts/` with Node-flavored module resolution, without letting your app build chew on those files.

Then wire the surrounding config — each entry exists for a reason stated inline where it lives:

- **npm scripts** (`package.json`): `codegen`, `codegen:check`, `codegen:verify`, each `node --experimental-strip-types scripts/<name>.mts`. Node 22.12+ runs TypeScript natively behind that flag (newer Nodes ignore the flag harmlessly), so the kit adds no `tsx`/`ts-node` dependency.
- **Formatter/linter exclusions**: add your generated directory (this repo uses `src/generated/`) to `.prettierignore` and to your ESLint ignores. The emitter targets Prettier's defaults (80 columns); any reformat rewrites bytes and breaks the artifact stamps, which the check then reports as `hand-edited`. Keep `tsc` coverage on the trees — that is the check that matters.
- **`.gitattributes`**: pin `src/generated/** text eol=lf` and `methods/** text eol=lf` so CRLF checkouts don't perturb hashes.
- **CI**: run `npm run codegen:check` in whatever gate runs on every PR (this repo folds it into `make check`). It is offline and keyless, so it runs anywhere.

## 3. The one framework-specific seam: env loading

`scripts/codegen.mts` and `scripts/codegen-verify.mts` load `PIPELEX_API_KEY` / `PIPELEX_BASE_URL` from `.env.local` via `@next/env` — the one Next.js-specific import in the kit, chosen so the scripts read the same env file the Next app does. In a non-Next project, replace that import with `dotenv` (or read plain `process.env`) at the two call sites. Nothing else in `scripts/` touches a framework.

## 4. The server pattern

These pieces of `src/lib/` are the pattern — copy and adapt them:

- `pipelexClient.ts` — one `PipelexApiClient` singleton; nothing else constructs the client.
- `blockingRun.ts` / `durableRun.ts` — the two execution paths (`execute` vs `start` + poll), each returning `{ ok: true, ... } | { ok: false, error: PipelineError }` instead of throwing across a serialization boundary.
- `wireOutput.ts` — reads the run's `main_stuff` and normalizes wire `null`s for the generated schemas (see [`docs/codegen.md`](codegen.md) for why that step exists and why it is schema-guided).
- `errors.ts` — `classifyPipelineError`, which turns SDK error classes into a tagged, serializable error model.
- `loadBundle.ts` — `fs.readFile` of the `.mthds` bundles; bundles ship as files, never as inlined TOML strings.

The `src/types/` convention comes with them: one adapter per method, which re-exports the generated type and wraps the generated binder in a `parseXxx(results)` that translates a `ZodError` into your error model. **Never hand-declare an output shape** — the bundle declares it and codegen projects it.

`src/hooks/useRun.ts` (the blocking|durable client state machine) is worth taking only if your host app is React; the server pattern above does not depend on it. Likewise `src/actions/` is Next.js Server Actions plumbing — in another stack the equivalent is whatever server endpoint calls the two run helpers.

## 5. Author methods and generate

```bash
mkdir -p methods/my-method
# author methods/my-method/main.mthds (the /mthds-build skill can generate one)
npm run codegen
```

Commit the generated tree in the same commit as the bundle. From here the conventions that keep the setup honest are:

- The generated trees are **committed** — a keyless `git clone && check` must pass, and a regeneration diff documents what a bundle edit changed.
- **Never edit generated files** — wrap them from your adapter layer instead.
- **Regenerate after every bundle edit** — the offline check's `sources.json` comparison fails your CI gate until you do.
- **Run the offline check in CI**, and `codegen:verify` before releases (it needs a key; an engine-version difference is a note, not a failure).

## Known caveat

`POST /v1/codegen` is served by any self-hosted [`pipelex-api`](https://github.com/Pipelex/pipelex-api) runner and by `api-dev.pipelex.com`; `api.pipelex.com` still answers `403` pending its deploy, so regeneration currently needs `PIPELEX_BASE_URL=https://api-dev.pipelex.com` (or an up-to-date self-hosted runner). Only regeneration is affected — the offline check needs no server, and the app itself runs against the default hosted URL.
