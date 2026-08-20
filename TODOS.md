# TODOS — generated types from `.mthds` bundles (codegen adoption)

**Goal:** stop hand-writing in `src/types/` what each method already declares in its `.mthds` bundle. `npm run codegen` projects every method into committed, stamped `ts-zod` artifacts; `npm run codegen:check` proves offline in CI that they are current; the narrowers become thin adapters over the generated binders.

**Design authority:** [`wip/codegen/design.md`](wip/codegen/design.md). Read it before starting — this file is the execution tracker, that one is the _why_. Decisions are referenced below as **D1**–**D7**; if execution contradicts a decision, update the design doc rather than silently diverging.

**Status:** Phase 0 (the upstream SDK helper) shipped as `@pipelex/sdk` 0.13.0. Phases 1–4 are done — the repo is on `@pipelex/sdk` 0.13.0 with `zod` `^4.4.3`, `npm run codegen` writes the three committed trees under `src/generated/`, `make check` fails on a drifted or stale tree via `npm run codegen:check`, and all three narrowers are now thin adapters over the generated binders (`src/lib/runOutput.ts` is gone). Phase 5 (documentation) is **not started**. Written 2026-08-20.

**Check the boxes as you go.** This document is written for a cold start in a fresh session.

---

## Cold-start primer

**What already exists upstream.** `@pipelex/sdk` 0.13.0 (on npm) carries both halves of the trust chain:

- `client.codegen({ files, kind: "types", target: "ts-zod" })` → `{ is_valid: true, artifacts: [{path, content}], lock, lock_filename, crate_fingerprint, engine_version }`. Verdict rides `is_valid` on a 200; only no-verdict conditions throw `ApiResponseError`.
- `runCodegenCheck({ lockContent, files })` → `{ drifts[], isCurrent, crateFingerprint, engineVersion }`. Pure: no fs, no network, no key. Categories: `missing` · `modified` · `hand-edited` · `orphan`.
- `isStampableArtifactPath` / `STAMPABLE_ARTIFACT_SUFFIXES` — **the walk filter is contract, not convenience** (see D3).
- `CodegenLockError` — thrown for a malformed lock, an unsafe artifact path, or an unknown `lock_version`.

Authoritative SDK docs: `../pipelex-sdk-js/docs/crate-routes.md` → "The offline check". Engine docs: `../pipelex/docs/under-the-hood/codegen-projections.md`.

**The route is on api-dev, not prod.** `.env.local` already sets `PIPELEX_BASE_URL=https://api-dev.pipelex.com`. `api.pipelex.com` still answers 403 for `/v1/codegen` pending its deploy. This is expected and is a documentation caveat only — no code changes when prod catches up.

**Ground truth, captured 2026-08-20 against api-dev (engine `0.47.0`).** Live `codegen()` output for the three methods — trust this over guessing:

| Method             | Generated types (in `types.ts`)                                                                                                              | Binder functions                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `extract-entities` | `ExtractedEntities` (`people`/`orgs`/`dates`: `string[]`), `Text`                                                                            | `parseExtractedEntities`, `serializeExtractedEntities`, `parseText`, … |
| `summarize-pdf`    | `DocumentSummary` (`title`, **`doc_type`**, **`key_points`**), `Document`                                                                    | `parseDocumentSummary`, `parseDocument`, …                             |
| `generate-image`   | `Image` (`url` required; `public_url`, `mime_type`, `caption`, `source_prompt`, `width`, `height`, `filename` all **`.optional()`**), `Text` | `parseImage`, `serializeImage`, …                                      |

Every method emits exactly `types.ts` + `binder.ts` + `codegen.lock`. Input concepts get schemas too (`Text`, `Document`) — harmless, and all exported so `noUnusedLocals` is satisfied.

**Four facts that will bite if you don't know them:**

1. **`.optional()` means `| undefined`, not `| null`.** Today's `GeneratedImage` uses `string | null` for `publicUrl`/`mimeType`/`caption`. The generated `Image` gives `string | undefined`. The adapter or the components must reconcile this (see Phase 4).
2. **snake_case is deliberate and permanent** (D6). `DocumentSummary` becomes `doc_type`/`key_points` everywhere — components and tests included. Do not add a camelCase mapping layer; that is the duplicated surface this work removes.
3. **A stamp carries `engine_version`, so an engine bump rewrites every artifact** even with zero semantic change (the `crate_fingerprint` stays put — it is semantic). Expect a whole-tree diff after an upstream pipelex release; that is correct behaviour, not drift. It moved 0.46.4 → 0.47.0 in a single day during design.
4. **The generated `binder.ts` imports `"./types"` extensionless.** Fine under the base tsconfig (`moduleResolution: "bundler"`), which is what covers `src/`. Do not point a `nodenext` config at the generated trees.

**Repo conventions** (from `CLAUDE.md`): Server Actions are the only SDK callers; narrow with `parseXxx(results)`; return classified `{ ok: false, error }` rather than throwing across the boundary; no barrels; no relative cross-folder imports (`@/` alias); named exports; Tailwind only. Run `make all` after every change; `make agent-test` for silent tests.

---

## Phase 1 — Dependencies and baseline

- [x] `make use-npm` — leave the local tarball, restore the published SDK. Confirm it lands on **0.13.0 or later** (the target echoes the version it restored). → restored **0.13.0**.
- [x] Bump `package.json` `@pipelex/sdk` `^0.12.0` → `^0.13.0`; sync `package-lock.json` (`make lock`). → `use-npm` re-pinned the range itself (that is the `@latest` behaviour); `make lock` was a no-op afterwards.
- [x] Add `zod` to **`dependencies`** (not dev — binders run in Server Actions at request time). Current major is 4; use `^4.4.3` or later (D5). → added **`^4.4.3`**, and it deduped with the copy `mthds` already pulled in, so the install added no new package.
- [x] Confirm `smol-toml` did **not** add a package to the tree (it dedupes with `mthds`): `npm ls smol-toml` should show a single deduped copy. → single `smol-toml@1.8.0`, deduped between `@pipelex/sdk` and `mthds`.
- [x] Baseline: `make all` green before writing any new code.

> ### ⛔ CHECKPOINT 1 — STOP HERE
>
> **Do not proceed to Phase 2 without the user.** Report: the SDK version restored, the zod version added, and confirmation that `make all` is green on an otherwise-unchanged tree. This is the last moment where the repo is trivially revertable; everything after it adds files the template's consumers inherit.

---

## Phase 2 — The generator (`npm run codegen`)

Implements **D1** (write verbatim, write-if-changed) and **D2** (script shape).

- [x] `tsconfig.scripts.json` — thin `extends` of the base config scoped to `scripts/**`, with `"module": "nodenext"` / `"moduleResolution": "nodenext"` and `"types": ["node"]`. Mirror `tsconfig.e2e.json`'s structure. Add `scripts` to the base config's `exclude` so Next's build never type-checks Node-flavored files.
- [x] Add `"typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit"` to `package.json`, and wire it into the `typecheck` Make target beside `typecheck:e2e`.
- [x] `scripts/codegen.mts`:
  - [x] Load env with `@next/env`'s `loadEnvConfig` (the `playwright.config.ts` trick) so `PIPELEX_API_KEY` / `PIPELEX_BASE_URL` come from `.env.local`. → **`@next/env` is CommonJS**, so the named import `playwright.config.ts` uses does not survive native ESM (`SyntaxError: Named export 'loadEnvConfig' not found`). Playwright transpiles its config to CJS first; this script does not. Takes the default export and destructures, with a comment saying why it differs.
  - [x] Construct `new PipelexApiClient()` bare — **not** via `@/lib/pipelexClient`; the `@/` alias does not exist outside Next (D2).
  - [x] Discover methods: every directory under `methods/`. Closure = every `**/*.mthds` inside it, sent as `files: [{ content, source }]` with `source` the repo-relative path so validation errors point at real files.
  - [x] Call `codegen({ files, kind: "types", target: "ts-zod" })`. **Do not send `pipe_ref`** — `kind: "types"` rejects it with a 422 (D7).
  - [x] On `is_valid: false`: print each `validation_errors[]` entry with its file, exit 1.
  - [x] On a thrown `ApiResponseError` 403/404: print the actionable message — this base URL does not serve `/v1/codegen`; point `PIPELEX_BASE_URL` at `https://api-dev.pipelex.com`.
  - [x] **Self-verify before writing**: `runCodegenCheck({ lockContent: result.lock, files: result.artifacts })` must report `isCurrent`. (`GeneratedArtifact` and `CodegenTreeFile` are structurally identical — no mapping.) Abort the write if it does not.
  - [x] Write each artifact at `src/generated/<method>/<path>` and the lock as `<lock_filename>`, **byte-for-byte verbatim**. Write-if-changed only.
  - [x] Remove stamped files that dropped out of the artifact set — **only** files matching `isStampableArtifactPath`, so `sources.json` is never touched (D1).
  - [x] Write `sources.json` beside each lock: repo-relative path + SHA-256 of every source `.mthds` in the closure (D3).
  - [x] Log per method: short `crate_fingerprint`, `engine_version`, and whether anything changed — a no-op run must say so.
- [x] `"codegen": "node --experimental-strip-types scripts/codegen.mts"` in `package.json` scripts.
- [x] `make codegen` target wrapping `npm run codegen`, with a `##` help line.
- [x] **Exclusions (D4)** — these must land in the same commit as the first generated tree, or the pre-commit hook will rewrite the artifacts and break every stamp:
  - [x] `.prettierignore` gains `src/generated/`. → **verified load-bearing**: `prettier --check --ignore-path /dev/null 'src/generated/**/*.ts'` flags two of the three binders, so without this entry the commit hook really would break those stamps.
  - [x] `eslint.config.mjs` gains `src/generated/**` to its ignores. → also added `scripts/**/*.mts` to the existing `no-console` carve-out, since the generator's output channel _is_ the terminal.
  - [x] lint-staged's ESLint entry gains `--no-warn-ignored`.
- [x] `.gitattributes` with `src/generated/** -text` — diff hygiene on a committed generated tree (not load-bearing for the verdict; the SDK normalizes line endings).
- [x] Run `npm run codegen` against api-dev; commit the three generated trees.
- [x] `make all` green **with the trees committed** — `tsc` now covers them (D4), so this is where zod-version incompatibility would surface. → zod 4.4.3 accepts the emitter's output with no complaint; `tsc --listFiles` confirms all six generated `.ts` files are in the program.
- [x] Re-run `npm run codegen` immediately: it must report no changes (proves write-if-changed).

> ### ⛔ CHECKPOINT 2 — STOP HERE
>
> **Do not proceed to Phase 3 without the user.** Report: the generated file list, `engine_version` + short fingerprints, that the second run was a clean no-op, and `make all` green. Nothing consumes the trees yet and there is no drift guard — this is a coherent, shippable unit on its own, and a natural place to open a PR.

---

## Phase 3 — The offline check (`npm run codegen:check`) and the keyed verify

Implements the rest of **D3**.

- [x] `scripts/codegenShared.mts` — **not in the original plan**, added because three scripts now have to agree on the same directories, the same source hashing, and the same sidecar, and any disagreement between them shows up as a _false verdict_ rather than an error. Holds the paths, `walk`, `sha256`, `discoverMethods`, the sidecar shape, and `readGeneratedTree` (which discharges the SDK's two load-bearing caller obligations — walk the whole tree recursively, pass the text exactly as read — in one place). Imports nothing from `process.env` and constructs no client, so the check stays key-free. Node's type stripping resolves relative imports by their real on-disk extension, so the specifier is literally `./codegenShared.mts`; `tsconfig.scripts.json` gained `allowImportingTsExtensions` (legal because it type-checks with `--noEmit`).
- [x] `scripts/codegen-check.mts` — no SDK client, no env, no key:
  - [x] For each `src/generated/<method>/`: read `codegen.lock` (absent → exit **2**, no verdict), walk the directory **recursively**, filter with `isStampableArtifactPath`, pass paths **relative to the lock's directory** and content **as read** (no reformatting, no re-encoding). → the no-lock message also lists what it _did_ find, so a lock rename reads as a rename instead of a mystery.
  - [x] Call `runCodegenCheck`; print each drift as `category: path — detail` (the `detail` sentences are the CLI's verbatim — do not reword them).
  - [x] Compare `sources.json` hashes against the current `.mthds` files; a mismatch is a stale-source failure whose message says **"run `npm run codegen`"**. → covers three cases, not one: a hash change, a _new_ bundle the types do not cover, and a recorded source that vanished. A missing or unparseable sidecar counts as stale (exit 1) rather than no-verdict — it is starter-owned, and regenerating both restores it and re-proves the tree.
  - [x] Catch `CodegenLockError` → exit **2**, printing its message unchanged (an unknown `lock_version` message already names which side to upgrade).
  - [x] Exit codes: `0` current · `1` drift or stale sources · `2` no verdict. → worst-of across methods; `2` outranks `1`.
  - [x] **Two whole-tree cases the plan did not name**, both real holes a per-tree check cannot see from inside one tree: a method under `methods/` with **no generated tree at all** (a new method nobody regenerated for → exit 1), and a `src/generated/<x>/` with **no `methods/<x>/` behind it** (regeneration prunes stale files _within_ a tree but never removes a whole tree, so the message says to delete it → exit 1).
- [x] `scripts/codegen-verify.mts` — the keyed semantic gate: re-run `codegen()` live per method and compare its `crate_fingerprint` against the committed lock's `crateFingerprint` (read via `runCodegenCheck`, which surfaces it). Writes nothing. Exit 1 on mismatch. → an `engine_version` difference is printed as a **note, not a failure** (see the decision recorded below), and a drift count from the same call is surfaced as a note pointing at `codegen:check`, which owns that verdict.
- [x] Scripts: `"codegen:check"` and `"codegen:verify"`.
- [x] Make targets `codegen-check` and `codegen-verify`; **fold `codegen-check` into `check`** (`check: lint format-check typecheck codegen-check`). `codegen-verify` stays out of `make all` — it needs a key and a network.
- [x] Verify every failure mode by hand, each must fail `make check` with an actionable message: → and `make check` itself was confirmed to go non-zero on an injected drift, not just the npm script.
  - [x] Append a byte to a generated file → `hand-edited`. → `hand-edited: types.ts — Body was edited below the stamp (stamp hash no longer matches).`
  - [x] Delete a generated file → `missing`. → `missing: binder.ts — Locked artifact is absent on disk.`
  - [x] Drop a stamped stray into a generated dir → `orphan`. → `orphan: stray.ts — Stamped generated file not tracked by the lock — stale; remove or regenerate.`
  - [x] Corrupt a lock → exit 2 via `CodegenLockError`. → both flavours: an unknown version (`Unsupported codegen lock version: this build reads lock_version 1, but it declares lock_version 99 — upgrade @pipelex/sdk to a build that reads it.`) and unparseable TOML (`Malformed codegen lock: Invalid TOML document: …`).
  - [x] Edit a `.mthds` bundle without regenerating → stale-source failure. → `stale-source: methods/summarize-pdf/main.mthds — edited since the types were generated`.
  - [x] Restore everything (`npm run codegen`) → green again. → and the restored run reported "no changes" for all three, so the failure-mode drills left no residue.
- [x] Confirm `sources.json` is **ignored** by the walk filter (it is not stampable) — a passing check with the sidecar present proves it. → each tree reports "2 artifact(s) current" out of the 4 files on disk.
- [x] `make all` green.
- [x] `npm run codegen:verify` green live against api-dev, and its mismatch path exercised: editing one concept description moved `summarize-pdf`'s crate to `8911d874f957` and the gate failed with both fingerprints printed.

> ### ⛔ CHECKPOINT 3 — STOP HERE
>
> **Do not proceed to Phase 4 without the user.** Report: each failure mode's actual message, and `make all` green. Phase 4 is the first one that changes app behaviour and touches user-visible field names — it deserves a deliberate go-ahead.

---

## Phase 4 — Adopt the binders in the app

Implements **D6**. This is the behaviour-changing phase.

**The fact this phase turned on, found before writing any code:** the ts-zod projection **cannot parse the runtime's own wire payload**. A non-required concept field is projected `.optional()`, which in zod means `| undefined` and rejects `null` — but the runtime serializes an unset optional field as an explicit `null` (`working_memory.py`'s `dump_for_transport` is `model_dump(serialize_as_any=True)`, no `exclude_none`). Captured live from api-dev, run `run_517b9004`, the `main_stuff` of a `PipeImgGen` run carries `source_negative_prompt: null`, `caption: null`, `filename: null`, and `ImageSchema.parse` rejects it with five issues. So `parseImage(main_stuff)` would have thrown on **every real image run**. Filed upstream as [`../wip/inbox/2026-08-20-pipelex-ts-zod-optional-rejects-wire-null.md`](../wip/inbox/2026-08-20-pipelex-ts-zod-optional-rejects-wire-null.md); worked around locally by `dropWireNulls`.

- [x] `src/lib/wireOutput.ts` — **not in the original plan**, the successor to `runOutput.ts` in the same slot. Three exports, no shape-checking of its own: `dropWireNulls` (recursively strips null-valued _keys_, leaving null list _items_ alone — only object keys are optional on the wire), `wireOutput(results)` (read `main_stuff`, normalize, one step), and `describeSchemaFailure(err, typeName)` (a `ZodError`'s own `.message` is a JSON dump of its issue array; `z.prettifyError` turns it into the field-by-field list `<ErrorDisplay>` shows under Details).
- [x] `src/types/extractEntitiesPipeline.ts` — body is `parseExtractedEntities(wireOutput(results))` in a `try/catch` translating `ZodError` → `BadPipelineOutputError`. Re-exports the generated `ExtractedEntities`. Field names unchanged, so a drop-in as predicted.
- [x] `src/types/summarizePipeline.ts` — same shape, re-exporting the generated `DocumentSummary`. **Field rename churn**: `docType` → `doc_type`, `keyPoints` → `key_points`.
- [x] `src/types/generateImagePipeline.ts` — parses with the generated `parseImage` first, then keeps the web-renderable-scheme validation of `public_url ?? url` (semantics the concept does not declare — D6). `GeneratedImage` is now an **alias** of the generated `Image`, not a hand-written shape; aliased rather than re-exported as `Image` because that name is a DOM global in a `.tsx` file.
- [x] Update components for the new field names:
  - [x] `src/components/PdfSummaryResult.tsx` (`summary.docType` → `summary.doc_type`, `summary.keyPoints` → `summary.key_points`).
  - [x] `src/components/ImageResult.tsx` (`image.publicUrl` → `image.public_url`; `??` already handles the undefined).
- [x] **Retire `src/lib/runOutput.ts`** and `runOutput.test.ts` — `Schema.parse` subsumes `findOutputContent`'s predicate and non-object guard, with better messages. No backward compatibility (D6).
- [x] Update the affected tests. Fixtures barely changed (they already built wire-shaped `main_stuff`); the shape-mismatch assertions got **stricter**, not looser — several now assert zod names the offending field (`toThrow(/key_points/)`) where they previously only asserted that something threw.
  - [x] `src/types/summarizePipeline.test.ts`, `src/types/generateImagePipeline.test.ts`, `src/types/extractEntitiesPipeline.test.ts` — the image suite gained the **verbatim live payload** as a case, so the null-rejection regression is pinned by a fixture copied from a real run rather than an invented one.
  - [x] `src/components/PdfSummaryResult.test.tsx`, `src/components/ImageResult.test.tsx`, `src/components/PdfForm.test.tsx`, `src/components/ImageForm.test.tsx`
  - [x] `src/actions/runSummarizePdfPipeline.test.ts`, `src/actions/runGenerateImagePipeline.test.ts`
  - [x] New `src/lib/wireOutput.test.ts` replaces `runOutput.test.ts`, including the case that states the whole reason the helper exists: the same payload is `safeParse` false before `dropWireNulls` and true after.
- [x] `make all` green. → 25 files / 204 tests.
- [x] `make test-e2e` — **required**, not optional. → 4 passed, 1 skipped (the offline `error-display` spec, which correctly skips while the API is reachable). The durable image spec is the one that would have failed without `dropWireNulls`.

> ### ⛔ CHECKPOINT 4 — STOP HERE
>
> **Do not proceed to Phase 5 without the user.** Report: which narrowers kept semantic validation beyond the schema, the exact field-name churn that reached components, and the e2e result. The feature is functionally complete here; Phase 5 is documentation only.

---

## Phase 5 — Documentation

- [ ] `README.md` — a "Generated types" section: the commands, the trust chain in two sentences, the api-dev caveat, and "after editing a `.mthds` file, run `npm run codegen`".
- [ ] `CLAUDE.md` — this is the big one, and it is **not** additive:
  - [ ] Project-structure tree gains `src/generated/` and `scripts/`.
  - [ ] Rewrite the narrower-contract sections that describe `findOutputContent` / `runOutput.ts` — that file no longer exists; `src/lib/wireOutput.ts` took its slot. Same for `README.md:67` and `README.md:87`, which still describe the old `main_stuff ?? pipe_output` search.
  - [ ] Document `dropWireNulls` and **why** it exists (the `.optional()`-vs-`null` mismatch), with the pointer to the inbox item so a future reader knows it is a workaround with an expiry, not a design.
  - [ ] The "To add a new pipeline" numbered list gains the codegen step and loses the hand-written-narrower step.
  - [ ] Workflow rule: regenerate after editing `methods/`; `make check` now fails on stale generated types.
  - [ ] Gotcha: `src/generated/` is excluded from Prettier/ESLint on purpose — do not "fix" that; a reformat breaks every stamp.
  - [ ] Scripts table gains the three new targets.
- [ ] `CHANGELOG.md` under `## [Unreleased]` — Added (codegen + the check), Changed (breaking: snake_case field names on `DocumentSummary` and the image envelope; `runOutput.ts` removed).
- [ ] `wip/codegen/design.md` — mark implemented; fold the checkpoint findings into it.
- [ ] Delete this file, or archive it to `../wip/history/` per the workspace convention.
- [ ] `make all` green one final time.

---

## Decisions to make during execution (record the outcome here)

- **`undefined` vs `null` on optional generated fields** (Phase 4) — **decided: both, and they are two separate questions.** On the _output_ side the recommendation held: the generated type is re-exported as-is and the render sites use `??`, so no hand-written shape came back. On the _input_ side it turned out not to be a style choice at all — the wire really does carry `null`, and `.optional()` really does reject it, so a normalization step was mandatory for the code to work. `dropWireNulls` is that step, and it normalizes _values_, never names: it re-declares no field, so it is not the duplicated surface D6 removes. It is deletable the day the emitter emits `.nullish()`.
- **Whether `codegen:verify` runs in CI** (Phase 3) — **decided: no.** It stays a manual/pre-release target, out of `make all`, for the same reason `test-e2e` is: it needs a key and a network. `make check` gets the offline check, which is the one that can run anywhere.
- **Engine-bump churn policy** (Phase 3) — **decided: an engine move is a note, not a failure.** `codegen:verify` gates on `crate_fingerprint` (the semantic signal) and only _reports_ an `engine_version` difference, saying that regenerating will restamp the tree with no semantic change. That keeps a pipelex release from reddening the gate and leaves the whole-tree restamp to a deliberate "bump the engine" commit.

## Out of scope (D7)

No `resolve()` example · no edits to generated code (augment via sibling modules) · no watch mode or build-time hook · no per-pipe codegen kinds.

## References

- Design: [`wip/codegen/design.md`](wip/codegen/design.md)
- SDK offline check: `../pipelex-sdk-js/docs/crate-routes.md` → "The offline check"
- SDK changelog: `../pipelex-sdk-js/CHANGELOG.md` → `[v0.13.0]`
- Engine / emitter behaviour: `../pipelex/docs/under-the-hood/codegen-projections.md`
- Predecessor plan (shipped, archived): `../wip/history/TODOS-starter-js-sdk-0.5.0-cost-and-uploads.md`
