# Adding Pipelex to an existing TypeScript app

This repo is a template for starting from zero, but it is also the worked example of the pattern: run `.mthds` methods through `@pipelex/sdk` with output types **generated from the bundles**, so the TypeScript can never drift from what a method actually returns. This guide is the transplant checklist for bringing that pattern into an app you already have. It is written to be executed top to bottom — by a person or by an SWE agent.

Only one seam is Next.js-specific (env loading — step 3); everything else is framework-agnostic Node and React-optional.

## 1. Dependencies

```bash
npm install @pipelex/sdk zod @pipelex/mthds-form
npm install --save-dev @types/node   # skip if your app already has it
```

`@pipelex/sdk` and `zod` are **runtime** dependencies: the SDK makes the API calls, and the generated binders validate run output with zod at request time. `@pipelex/mthds-form` is a runtime dependency too, and it is not optional even if you never render its controls: the codegen kit's writer emits `import type { InputForm, PipeIOContracts } from "@pipelex/mthds-form";` into every generated `contracts.ts`, so without it step 5's first codegen run produces a tree that does not typecheck. The headless core is all the codegen kit and the server gate need. Its React control set (`@pipelex/mthds-form/react`) is a separate, optional choice — if you want the rendered forms as well, [`docs/input-form.md`](input-form.md) covers the composition and the Tailwind `content` glob they require. `@types/node` is dev-only, and the codegen kit needs it: `tsconfig.scripts.json` sets `"types": ["node"]` and the scripts import `node:` built-ins, so without it the script typecheck fails with TS2688. A Next.js app already ships it; a browser-only app typically does not.

## 2. Copy the codegen kit

Copy these files, keeping their relative arrangement:

- `scripts/codegen.mts`, `scripts/codegen-check.mts`, `scripts/codegen-verify.mts` — the three CLI entries, one line each. They exist to be what `npm run` invokes; all the behavior is in `scripts/lib/`.
- `scripts/lib/generate.mts` — the generator (`npm run codegen`): sends every method under `methods/` to `POST /v1/codegen` and writes the returned artifacts verbatim.
- `scripts/lib/check.mts` — the offline drift check (`npm run codegen:check`): no key, no network; proves the committed trees are current.
- `scripts/lib/verify.mts` — the keyed semantic gate (`npm run codegen:verify`).
- `scripts/lib/shared.mts` — the paths, tree walk, hashing, and sidecar logic the three share.
- `scripts/lib/*.test.mts` — unit tests over the lib (optional, but they guard the hashing, the walk, the delete rule, and the exit-code contract).
- `tsconfig.scripts.json` — type-checks `scripts/` with Node-flavored module resolution, without letting your app build chew on those files.

Then wire the surrounding config — each entry exists for a reason stated inline where it lives:

- **npm scripts** (`package.json`): `codegen`, `codegen:check`, `codegen:verify`, each `node --experimental-strip-types scripts/<name>.mts`. Node 22.12+ runs TypeScript natively behind that flag (newer Nodes ignore the flag harmlessly), so the kit adds no `tsx`/`ts-node` dependency.
- **Formatter/linter exclusions**: add your generated directory (this repo uses `src/generated/`) to `.prettierignore` and to your ESLint ignores. The emitter targets Prettier's defaults (80 columns); any reformat rewrites bytes and breaks the artifact stamps, which the check then reports as `hand-edited`. Keep `tsc` coverage on the trees — that is the check that matters.
- **`.gitattributes`**: pin `src/generated/** text eol=lf` and `methods/** text eol=lf` so CRLF checkouts don't perturb hashes.
- **CI**: run `npm run codegen:check` in whatever gate runs on every PR (this repo folds it into `make check`). It is offline and keyless, so it runs anywhere.

## 3. The one framework-specific seam: env loading

`scripts/lib/generate.mts` and `scripts/lib/verify.mts` load `PIPELEX_API_KEY` / `PIPELEX_BASE_URL` from `.env.local` via `@next/env` — the one Next.js-specific import in the kit, chosen so the scripts read the same env file the Next app does. In a non-Next project, replace that import with `dotenv` (or read plain `process.env`) at the two call sites. Nothing else in `scripts/` touches a framework.

## 4. The server pattern

These pieces of `src/lib/` are the pattern — copy and adapt them:

- `pipelexClient.ts` — one `PipelexApiClient` singleton; nothing else constructs the client.
- `blockingRun.ts` / `durableRun.ts` — the two execution paths (`execute` vs `start` + poll), each returning `{ ok: true, ... } | { ok: false, error: PipelineError }` instead of throwing across a serialization boundary.
- `wireOutput.ts` — reads the run's `main_stuff` and normalizes wire `null`s for the generated schemas (see [`docs/codegen.md`](codegen.md) for why that step exists and why it is schema-guided).
- `errors.ts` — `classifyPipelineError`, which turns SDK error classes into a tagged, serializable error model.
- `serverEnv.ts` — `readClassifyEnv()`, the single `process.env` read both run helpers share, so the two execution paths can't drift on how classification sees the environment.
- `usageReport.ts` — turns a run's `tokens_usages` into the render-ready cost report both helpers return; it is part of their public return type, not an optional extra.
- `loadBundle.ts` — `fs.readFile` of the `.mthds` bundles; bundles ship as files, never as inlined TOML strings.
- `runInputs.ts` — `requireContract` + `requireInputForm` + `gateRunInputs`, the input gate every entry point opens with. It validates the caller's inputs against the method's own generated `contracts.ts` and returns the `{concept, content}` payload the run expects, so no hand-written per-input guard is needed. Take it even if you build your own inputs rather than using the kernel's controls: a server endpoint is public, and this is half the trust boundary (the gate needs only the contract; `requireInputForm` serves the rendering side).
- `fileEncoding.ts` — **the other half, and only skippable if no method you run takes a file.** `checkFileInputs` runs over the _gated_ inputs and validates what the shape gate cannot: that each file reference uses a scheme you accept, and — for a `data:` URL — its MIME type and its size. This is not a nicety. `client.prepareInputs` resolves any string it does not recognise as `data:`, `http(s)://` or `pipelex-storage://` as a **local filesystem path**, reads it, and uploads it; so a server endpoint that runs only the shape gate and hands the result to `prepareInputs` is an arbitrary server-side file read whose contents come back rendered to the caller. Copy the closed scheme set with it, and read its docstring before widening one.

The `src/types/` convention comes with them: `pipelineError.ts` — the tagged `BadPipelineOutputError` / `BadImageOutputError` classes that `errors.ts` `instanceof`-matches on, so it is part of the module graph, not an optional extra — plus one adapter per method, which re-exports the generated type and wraps the generated binder in a `parseXxx(results)` that translates a `ZodError` into your error model. **Never hand-declare an output shape** — the bundle declares it and codegen projects it.

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
