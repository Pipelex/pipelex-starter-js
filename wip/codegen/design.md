# Codegen in the starter — generated types from `.mthds` bundles

Status: **design**; Phase 0 (the upstream SDK helper) is **done and released**. Owner: Louis. Written 2026-08-19, updated 2026-08-20 against `@pipelex/sdk` 0.13.0.

## Why

The starter's role is to show developers how to build on Pipelex, and everything our tools can build deterministically should be built by them. Today the template hand-writes in `src/types/` the very thing each method already declares in its `.mthds` bundle: the output concept's shape (`ExtractedEntities`, `DocumentSummary`, the image envelope) plus a hand-rolled runtime narrower per shape. That is a duplicated type surface with no drift guard — edit a bundle's structure and nothing tells you the TypeScript is now lying.

`@pipelex/sdk` 0.12 exposes the crate routes: `client.resolve()` returns a method's normalized library crate, and `client.codegen({ kind: "types", target: "ts-zod" })` projects that crate into stamped typed artifacts — a `types.ts` (zod schemas + inferred types), a `binder.ts` (typed `parse<Name>` / `serialize<Name>` pairs), and a `codegen.lock` — byte-identical to a local `pipelex codegen types` run, so the offline drift check passes on the written tree. `@pipelex/sdk` 0.13 adds the other half: `runCodegenCheck`, the pure offline drift check — a port of pipelex's `codegen check` that reaches the same verdict over the same bytes, down to the drift `detail` sentences. The starter adopts `codegen` + `runCodegenCheck`; it does not call `resolve` directly, because `codegen` resolves internally and the starter has no use for the bare crate. (The route is served by any `pipelex-api` runner and by `api-dev.pipelex.com`; `api.pipelex.com` still answers 403 pending its deploy. We move forward against api-dev — `.env.local` already points there — and production catches up in time.)

The design goal in one sentence: **`npm run codegen` regenerates committed, typed, zod-validated artifacts for every method in `methods/`, `npm run codegen:check` proves offline that they are current, and the app's narrowers become thin adapters over the generated binders.**

## The commands (npm-first)

The npm scripts are the primary interface — this is a JS template and `npm run` is what its consumers reach for. The Make targets are thin wrappers, consistent with every other target in this repo.

| Command                  | What it does                                                                                                                         | Needs network / key?                                                       | When                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `npm run codegen`        | Regenerate `src/generated/<method>/` for every method in `methods/`, via `POST /v1/codegen`                                          | Yes — `PIPELEX_API_KEY` + a base URL that serves the route (api-dev today) | Dev action: after editing any `.mthds` file            |
| `npm run codegen:check`  | Offline drift check of every generated tree against its `codegen.lock` and sources sidecar                                           | No — pure hashing                                                          | CI action: part of `make check`, so `make all` runs it |
| `npm run codegen:verify` | Re-run `codegen()` live and compare its `crate_fingerprint` to each committed lock's — the _semantic_ staleness gate. Writes nothing | Yes — same as `codegen`                                                    | Optional: before a release, or in a keyed CI job       |
| `make codegen`           | Wrapper for `npm run codegen`                                                                                                        | Yes                                                                        | Same                                                   |
| `make codegen-check`     | Wrapper for `npm run codegen:check`; **joins the `check` target** (`check: lint format-check typecheck codegen-check`)               | No                                                                         | Every `make check` / `make all`                        |
| `make codegen-verify`    | Wrapper for `npm run codegen:verify`                                                                                                 | Yes                                                                        | Same as `codegen:verify` — **not** in `make all`       |

Regeneration is the dev action, the offline check is the CI action — the split pipelex's codegen engine is designed around, so engine improvements never redden a consumer's CI. `npm run codegen` stays out of `make all` for the same reason `test-e2e` does: it needs a key and a network.

## Repo layout

```
methods/
  extract-entities/main.mthds        # source of truth (unchanged)
src/generated/                        # committed, generated, never hand-edited
  extract-entities/
    types.ts                          # zod schemas + z.infer types — imports only `zod`
    binder.ts                         # parse<Name> / serialize<Name> over the schemas
    codegen.lock                      # pipelex trust-chain lock, written verbatim
    sources.json                      # starter-owned staleness sidecar (see below)
  summarize-pdf/ …                    # same trio + sidecar per method
  generate-image/ …
scripts/
  codegen.mts                         # the generator (npm run codegen)
  codegen-check.mts                   # the offline check (npm run codegen:check)
tsconfig.scripts.json                 # type-checks scripts/, the tsconfig.e2e.json pattern
```

One generated tree per method, mirroring `methods/` one-to-one: each method is its own closure, so each gets its own crate, artifact set, and lock. The trees live under `src/` so the `@/` alias reaches them (`@/generated/extract-entities/binder`) and `tsc` type-checks them as part of the app.

**Committed, deliberately.** A template consumer must see the generated code without holding an API key, `git clone && make all` must pass keyless, and the diff of a regeneration is itself documentation of what a bundle edit changed. The offline check keeps the committed tree honest.

## Design decisions

### D1 — Write the server's artifacts verbatim; mirror pipelex's write discipline

The trust chain requires it: write every `artifacts[]` entry at its `path` and the `lock` content as `lock_filename` (`codegen.lock`), all byte-for-byte, and the tree is identical to a local `pipelex codegen types` run — same stamps, same lock — so the offline check holds. Editing an artifact or re-serializing the lock breaks the chain.

The generator also mirrors `write_stamped_projection`'s local semantics: **write-if-changed** (no mtime churn, clean diffs, a full regeneration over a current tree is a true no-op) and **remove stale stamped files** that dropped out of the artifact set — but only files carrying a codegen stamp, so the starter-owned `sources.json` sidecar sitting in the same directory is never touched.

### D2 — The generator script: `scripts/codegen.mts`, native Node TS, standalone client

- **TypeScript, run natively.** `node --experimental-strip-types scripts/codegen.mts`. The engines floor (`>=22.12.0`) has type stripping behind the flag, and newer Nodes where it is default ignore the flag harmlessly. No `tsx`/`ts-node` devDependency for a template this small.
- **Type-checked like e2e.** `tsconfig.scripts.json` extends the base config scoped to `scripts/` (with `module`/`moduleResolution: "nodenext"`), wired into `make typecheck` — the exact `tsconfig.e2e.json` pattern, and for the same reason: a safety net without making Next's build chew on Node-flavored files.
- **Env like Playwright.** The script loads `.env.local` via `@next/env`'s `loadEnvConfig`, the same trick `playwright.config.ts` uses, so `PIPELEX_API_KEY` / `PIPELEX_BASE_URL` come from the one file the app already uses.
- **Constructs `PipelexApiClient` bare, not via `getPipelexClient()`.** The "one client" rule governs app code. The script cannot import `@/lib/pipelexClient` anyway: `@/` is a tsconfig path alias, and Node's runtime resolver does not read tsconfig — outside Next, the alias does not exist. The client reads the same env vars natively, so the bare construction is the same construction.
- **Closure = the whole method directory.** The script sends every `methods/<name>/**/*.mthds` as `files: [{ content, source }]` with `source` set to the repo-relative path, so multi-file bundles work the day a method grows one, and validation errors point at real paths.
- **Verdicts, not transport.** The response is a 200 discriminated on `is_valid`. On the invalid arm, print `validation_errors[]` per file and exit 1. On a thrown `ApiResponseError` with status 403/404, print the starter-idiomatic actionable message: this base URL does not serve `/v1/codegen` yet — point `PIPELEX_BASE_URL` at `https://api-dev.pipelex.com` (the classified-error UX this template demonstrates everywhere else, applied to its own tooling).
- On success, log per method the `crate_fingerprint` (short form) and `engine_version` from the report, and whether anything changed — so a no-op run says so.

### D3 — The offline check: `runCodegenCheck`, plus a starter-owned staleness sidecar

**Shipped upstream.** The check logic — stamp grammar, lock format, drift taxonomy — is protocol knowledge, and it now lives in `@pipelex/sdk` 0.13.0 rather than being re-implemented here. It is pure: no filesystem, no network, no key, no `PipelexApiClient`. The caller walks its own tree and hands in the text; the SDK owns the verdict.

```ts
import { isStampableArtifactPath, runCodegenCheck } from "@pipelex/sdk";

const report = await runCodegenCheck({
  lockContent: await readFile("src/generated/extract-entities/codegen.lock", "utf8"),
  files: await readTree("src/generated/extract-entities", isStampableArtifactPath),
});
// report.drifts[] — { path, category: "missing" | "modified" | "hand-edited" | "orphan", detail }
// report.isCurrent — exactly drifts.length === 0
// report.crateFingerprint / report.engineVersion — read off the lock header
```

What `scripts/codegen-check.mts` must honor, because each obligation unmet yields a **wrong verdict rather than an error**:

- **Filter the walk with `isStampableArtifactPath`** (exported alongside `STAMPABLE_ARTIFACT_SUFFIXES`). This is contract, not convenience: an omitted _locked_ file reports `missing` though it sits on disk, and an omitted _orphan_ is never seen at all — `isCurrent: true`, a false negative on exactly the drift class orphan detection exists for. It is also what makes the `sources.json` sidecar safe to park beside the lock: a non-stampable file is skipped, not rejected. (Blessed explicitly in the SDK's docs, so this is a supported arrangement, not a trick.)
- **Walk recursively from the lock's directory, paths relative to it**, and pass each file's text **as read** — no reformatting, no BOM, no re-encoding, or the tree reports `hand-edited`. Line endings are the one exception and are normalized for us (`\r\n` and lone `\r` → `\n`), mirroring pipelex's universal-newline reader, so a CRLF checkout is not a false hand-edit.
- **A `codegen()` response feeds straight in with no mapping** — `GeneratedArtifact` and `CodegenTreeFile` are structurally identical on purpose. So `scripts/codegen.mts` self-verifies its own output _before writing anything_: `runCodegenCheck({ lockContent: result.lock, files: result.artifacts })` must report `isCurrent`.
- **Exit codes** mirror pipelex's: `0` current, `1` drift (print each `category: path — detail`; the wording is the CLI's verbatim, so a consumer reading both sees one report), `2` no verdict. Two things land on the no-verdict path: a missing `codegen.lock` (the pure helper takes `lockContent` as given, so locating it is ours), and a thrown `CodegenLockError` — a malformed lock, an unsafe artifact path, or a lock whose `lock_version` this SDK build does not know. That last one is actionable by design: the message names the version found and which side to upgrade, so a starter pinned behind a newer pipelex gets "bump `@pipelex/sdk`" rather than an opaque shape complaint.

**Two staleness gates, because they answer different questions.** The check proves the tree matches the lock; it deliberately never proves the tree is current with the _bundles_, since that needs the engine. So:

- **Offline (`codegen:check`, in `make check`)** — the `sources.json` sidecar. `npm run codegen` writes it beside each lock: the repo-relative path and SHA-256 of every source `.mthds` in the closure, compared on every check. Edit a bundle, forget to regenerate, and `make check` fails with "run `npm run codegen`" instead of shipping silently stale types. Coarse and knowingly so — a byte hash where the crate fingerprint is semantic, so reformatting a bundle trips a false "stale" whose remedy is a regeneration that write-if-changed turns into a clean no-op. It is ours, unstamped, and outside the lock (which stays byte-exact).
- **Keyed (`codegen:verify`)** — the semantic gate the sidecar approximates. `runCodegenCheck` surfaces `crateFingerprint` off the lock header precisely so a caller can ask the question the check cannot: _is this committed tree even from the crate my method resolves to today?_ The script re-runs `codegen()` live and compares its `crate_fingerprint` against each committed lock's, writing nothing. No false positives on reformatting — the fingerprint is semantic — but it needs a key and a network, so it stays out of `make all` and complements the sidecar rather than replacing it.

### D4 — Formatter and linter boundary: exclude `src/generated/`, keep `tsc` on it

The ts-zod emitter targets **Prettier's default** config (80-column width, double quotes, semicolons). This repo prints at `printWidth: 100` — so `prettier --write` would rejoin the emitter's pre-wrapped lines, rewriting bytes, breaking stamps, and making the check accuse the tree of hand-edits. The engine's documented escape hatch for a non-default Prettier config is an exclusion, so:

- `.prettierignore` gains `src/generated/` — which `format`, `format:check`, and lint-staged's `prettier --write` all respect automatically.
- `eslint.config.mjs` gains `src/generated/**` in its ignores, and lint-staged's ESLint entry gains `--no-warn-ignored` so explicitly-passed generated paths are skipped silently on commit. Any autofixing rule is a byte rewrite waiting to happen; generated code is lint-clean by construction against the engine's assumptions, and its real gate here is the next line.
- **`tsc` keeps full coverage.** The generated trees are inside `src/` and the base tsconfig, so `make typecheck` (and Next's build) verifies them — zod-version compatibility, binder/types coherence, and every app import into them. That is the check that matters, and it stays.

### D5 — `zod` becomes a dependency

`types.ts` imports only `zod`; the emitter's idioms (two-argument `z.record`, `z.lazy` for concept references, `z.infer` aliases) are current-major zod. Add `zod` (caret on the current major) to `dependencies` — not dev, since the binders run in the app's server actions at request time. This is the template's one new runtime dependency, and it is the TS-idiomatic validation library a consumer would expect a typed template to use anyway.

### D6 — Narrowers become adapters over the binders; generated types flow to the UI

The `parseXxx(results: RunResults)` contract survives untouched — actions, `useRun`, components, and tests keep their call sites — but each narrower's body becomes: hand `results.main_stuff` to the generated binder, and translate a thrown `ZodError` into the template's tagged error model (`BadPipelineOutputError` / `BadImageOutputError`), because the tagged classes are what `classifyPipelineError` and `<ErrorDisplay>` speak. The zod error message goes into the tagged error verbatim — a strict upgrade over today's hand-rolled predicates, since zod names the exact failing field and expectation.

```ts
// src/types/extractEntitiesPipeline.ts — after
import type { RunResults } from "@pipelex/sdk";
import { ZodError } from "zod";
import { parseExtractedEntities } from "@/generated/extract-entities/binder";
import type { ExtractedEntities } from "@/generated/extract-entities/types";
import { BadPipelineOutputError } from "@/types/pipelineError";

export type { ExtractedEntities };

export function parseEntities(results: RunResults): ExtractedEntities {
  try {
    return parseExtractedEntities(results.main_stuff);
  } catch (err) {
    if (err instanceof ZodError) throw new BadPipelineOutputError(err.message);
    throw err;
  }
}
```

**Generated types flow to the components with their wire-native snake_case keys.** The emitter keeps keys wire-native deliberately (a blind camelCase remap cannot tell schema keys from data keys), and a hand-maintained camelCase mirror is exactly the duplicated type surface this design removes. So `DocumentSummary` consumers switch from `docType`/`keyPoints` to `doc_type`/`key_points`, and `ExtractedEntities` (already `people`/`orgs`/`dates`) is a drop-in. An adapter keeps hand-written shape only where it _adds semantics_ the concept does not declare: `parseGeneratedImage` keeps its web-renderable-scheme validation of `public_url ?? url`, applied after the generated `Image` schema (the native is materialized into the crate, so it gets a generated schema too) has validated the envelope.

**`src/lib/runOutput.ts` retires.** `findOutputContent`'s predicate mechanism and its non-object guard are subsumed by `Schema.parse`, which rejects arrays, primitives, and `null` with better messages than "not found". No backward compatibility — delete it and its tests, update the docs that describe it.

### D7 — What we deliberately do not build

- **No `resolve` example.** Codegen subsumes it for this template's purpose. The crate itself becomes interesting when a consumer wants fingerprint-based caching or their own projection — out of scope for a starter.
- **No generated-code edits, ever.** Customization rides sibling extension files (declaration merging / wrapper types), per the engine's extension-file story. The adapters in `src/types/` _are_ that sibling layer here.
- **No watch mode, no build-time hook.** Regeneration stays an explicit dev action; wiring it into `next dev` or `next build` would put a network + key dependency inside the build. The sidecar check is the forgetting-guard.
- **No per-pipe kinds yet.** `kind: "types"` is concept-set-wide and is the only kind served today; `pipe_ref` is rejected on it and stays out of the request.

## Phases

### Phase 0 — Upstream: `runCodegenCheck` in `pipelex-sdk-js` — **DONE**

Shipped in **`@pipelex/sdk` 0.13.0** (2026-08-20), with unit tests over vendored real codegen output and an e2e that runs the check over artifacts a live server just emitted — verbatim, then mutated once per drift category, for both a TypeScript and a Python target. Verified end-to-end from this repo against `api-dev` before release: server artifacts + lock verbatim → `isCurrent`, a flipped byte → `hand-edited`, a dropped file → `missing`, a stamped stray → `orphan`, an unstamped `sources.json` → ignored.

Beyond the planned surface it also landed: `isStampableArtifactPath` / `STAMPABLE_ARTIFACT_SUFFIXES` (the walk filter, now part of the contract — see D3), `crateFingerprint` / `engineVersion` on the report (which is what makes `codegen:verify` possible), `CodegenLockError`, and `lock_version` handling with a forward-compatible upgrade message. The lock's TOML is parsed with `smol-toml`, which **adds no package to this repo** — `mthds` already depends on the same range, so they dedupe. 0.13.0 also declares `sideEffects`, so a bundler can tree-shake `codegen-check.ts` out of the client bundle this template ships.

Remaining mechanical step, folded into Phase 1: `make use-npm` and bump the range from `^0.12.0` to `^0.13.0`.

### Phase 1 — Generator + committed artifacts

Bump `@pipelex/sdk` to `^0.13.0`; add `zod`; write `scripts/codegen.mts` + `tsconfig.scripts.json`; add the `codegen` npm script and `make codegen`; add the Prettier/ESLint/lint-staged exclusions (D4); run it against api-dev and commit the generated trees for the existing methods. `make all` must pass with the trees committed (typecheck now covers them).

**Checkpoint 1** — natural handoff: the generated trees exist and are green, but nothing consumes them yet and there is no drift guard. Record here: SDK version used, engine_version/fingerprints generated against, any emitter surprises (formatting, natives, imprecision markers).

### Phase 2 — Offline check

Write `scripts/codegen-check.mts` (`runCodegenCheck` per tree + `sources.json` comparison) and `scripts/codegen-verify.mts` (the keyed fingerprint gate), add the `codegen:check` / `codegen:verify` npm scripts and their Make wrappers, fold `codegen-check` into `make check`. Add `.gitattributes` with `src/generated/** -text` — not load-bearing for the verdict (the SDK normalizes line endings), but worth it for diff hygiene on a committed generated tree. Verify the failure modes by hand: touch a generated file (hand-edited), delete one (missing), add a stamped stray (orphan), edit a bundle without regenerating (stale sidecar) — each must fail `make check` with an actionable message.

### Phase 3 — Adoption in the app

Migrate the narrowers onto the binders per D6, switch components to the wire-native field names, retire `runOutput.ts`, update the unit tests (the mocked `main_stuff` fixtures barely change; assertions on error messages move to zod's wording). Run `make test-e2e` — this touches the SDK call path's output handling, exactly what only e2e exercises live.

**Checkpoint 2** — the feature is functionally complete; what remains is documentation. Record here: any narrower that kept semantic validation beyond the schema, and any field-name churn that reached the components.

### Phase 4 — Docs

README (a "Generated types" section: the two commands, the trust chain in two sentences, the api-dev caveat until production serves the route); CLAUDE.md (project structure, the codegen workflow rule — "after editing `methods/`, run `npm run codegen`" — the formatter-exclusion gotcha, and rewriting the narrower-contract sections that currently describe `findOutputContent`); CHANGELOG under `[Unreleased]`. Then archive this design doc's open questions into the checkpoint notes and mark it implemented.

## Open questions

_Resolved by `@pipelex/sdk` 0.13.0: the lock is parsed with `smol-toml` (no new package here, it dedupes with `mthds`), and the helper is named `runCodegenCheck`._

- **`sources.json` upstreaming**: if the staleness sidecar proves its worth, it may belong in the engine's own lock story rather than a starter convention — revisit after it has lived here a while.
- **Production 403**: when `api.pipelex.com` deploys the crate routes, drop the api-dev caveat from the docs; nothing in the code changes.
- **`lock_version` upgrade ordering**: an SDK that tolerates a new lock version must ship _before_ the pipelex release that starts writing it. Nothing to do now — but if `make check` ever fails with a version message naming a version this SDK does not know, the fix is bumping `@pipelex/sdk`, not touching the generated tree.
