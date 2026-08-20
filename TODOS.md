# TODOS — codegen scripts: thin entries, tested internals

## The decision

This is a template, so its architecture must read as designed-from-the-start. The last open code-shaped items from the codegen reviews are all testability and hardening: the three codegen scripts run their logic at module top level (importing one executes it), which leaves the entry-point orchestration — including `writeTree`'s deletion logic — untestable. The remedy chosen is **not** a runtime main-guard (`import.meta.url === process.argv[1]` is a Python idiom transplanted into ESM, where it is fragile under `pathToFileURL` normalization, symlinks, and bin shims): it is the idiomatic Node shape — thin CLI entry files over an importable, tested `scripts/lib/` layer.

Two small `src/` hardening items ride along because `src/` is the surface consumers actually copy: the `data:` arm of the image-URL gate, and a depth cap on `dropWireNulls`.

Scope is deliberately narrow: no deep pass over `src/`. The template's patterns have been through three review cycles and the remaining risk lives exactly where the tests aren't.

## Phase 1 — restructure `scripts/` into entries + lib

- [x] **Move `scripts/codegenShared.mts` → `scripts/lib/shared.mts`** (and its test beside it as `scripts/lib/shared.test.mts`). `REPO_ROOT` re-anchors with one more `..`. Every config glob (`tsconfig.scripts.json`, ESLint, Prettier, vitest) already covers `scripts/**`, so no config changes.
- [x] **Split each script into a thin entry + an exported module.** `scripts/codegen.mts` / `codegen-check.mts` / `codegen-verify.mts` keep their names (the npm scripts don't move) but become two-line shims: `process.exit(await runX())`. The logic moves to `scripts/lib/generate.mts` (`runGenerate`, `writeTree`, `writeIfChanged`), `scripts/lib/check.mts` (`runCheck`, `checkMethod`, `summarizeVerdicts`), `scripts/lib/verify.mts` (`runVerify`).
- [x] **The exit-code contract moves into the modules, not the entries.** Each `runX()` returns its exit code and never throws — the catch-all (unexpected error → `2` for the check, `1` for the keyed scripts, stack printed) is part of the contract, so it lives where it can be tested. Internal `process.exit(n)` calls become returns.
- [x] **Parameterize `checkMethod`'s generated root** (`generatedRoot = GENERATED_ROOT`, same pattern as `discoverMethods`'s `methodsDir`) so its branches are testable against temp dirs.

## Phase 2 — pin the previously-untestable behavior

- [x] **`scripts/lib/generate.test.mts` — `writeTree`'s cleanup filter**, the one deletion logic in the repo, until now untested. Partial-mock `@pipelex/sdk`'s `runCodegenCheck` (spread `importOriginal`, so `isStampableArtifactPath` and friends stay real). Cases: fresh write reports every artifact + lock + sidecar as changed; only `orphan`-category drifts are deleted (a `modified` drift is not); a hand-written sibling file survives; a re-run over a current tree is a no-op; a symlink nested in the pre-existing tree refuses before the first write.
- [x] **`scripts/lib/check.test.mts` — the exit-code contract.** `summarizeVerdicts` precedence (no-verdict `2` outranks drift `1` outranks current `0`; a mixed list never lets a `2` be masked by a later `1`), and `checkMethod` against temp trees: absent tree → drift, lock-less tree → no verdict, non-UTF-8 artifact → drift, symlinked tree → no verdict, garbage lock (`CodegenLockError`) → no verdict.

**Checkpoint 1** — after Phases 1–2: `make all` green, the moved tests still pass, and the scripts behave identically from the CLI (same output, same exit codes). Record here anything the restructure surfaced.

- [x] _Checkpoint notes:_ see "Checkpoint 1 notes" at the bottom.

## Phase 3 — the two `src/` hardening items

- [x] **`src/types/generateImagePipeline.ts`: the `data:` arm admits any media type.** The validated string feeds both `<img src>` and `<a download>`, so a `data:text/html` output would hand the user an attacker-authored file that runs on a `file://` origin when saved and opened. Require `data:image/…`; `http:`/`https:` arms unchanged. Cover in `generateImagePipeline.test.ts`.
- [x] **`src/lib/wireOutput.ts`: cap `dropWireNulls` recursion depth.** The schema-guided walk resolves `z.lazy()` (concept references), so a recursive concept makes descent payload-driven again — a deep enough payload overflows the stack. Add a depth cap (beyond it the value passes through untouched; the generated schema still owns the verdict). Cover with a recursive `z.lazy()` schema in `wireOutput.test.ts`: nulls stripped below the cap, pass-through beyond it, no overflow on a pathologically deep payload.

## Phase 4 — docs and changelog

- [x] **`CLAUDE.md`**: the project-structure block for `scripts/`, and any sentence describing the old flat layout.
- [x] **`docs/codegen.md`**: the layout block and the shared-layer reference.
- [x] **`docs/adopt-in-an-existing-project.md`**: the file list naming `codegenShared.mts`.
- [x] **`CHANGELOG.md` `[Unreleased]`**: one Changed bullet for the scripts restructure (entries + tested lib), one Fixed/Changed bullet each for the `data:` media-type gate and the `dropWireNulls` depth cap.

## Phase 5 — verification and landing

- [x] `make all` (lint + format-check + typecheck + codegen-check + unit tests + build).
- [x] Run each script once from the CLI to confirm identical behavior: `npm run codegen:check` (exit 0 on the committed trees), and `npm run codegen:check` from a non-root cwd.
- [ ] Commit on `refactor/Codegen-script-restructure`, push, open the stacked PR against `docs/Hosted-api`.
- [ ] Mark the corresponding items done in `wip/_top_priorities.md` (machine-local).

## Out of scope, deliberately

- **Any refactor of `src/` beyond the two hardening items.** The action trios, narrowers, hook, and error layer have converged through PRs #18–#20; churn there is risk without payoff.
- **The runtime main-guard idiom.** Rejected in favor of thin entries — see "The decision".
- **`discoverMethods`'s hardcoded `methods/` label and the other PR #20 deferrals** not named here — they stay parked in `wip/_top_priorities.md` with their evidence.

## Checkpoint 1 notes

- **Layout landed as planned.** `scripts/` now holds three ~10-line CLI entries over `scripts/lib/{shared,generate,check,verify}.mts`. No config touched: every glob (`tsconfig.scripts.json`, ESLint's tooling override, Prettier, vitest's default include) already matched `scripts/**`, and the npm script names never moved.
- **The exit-code catch-all moved into the modules**, so `runGenerate` / `runCheck` / `runVerify` never throw — an unexpected failure prints its stack and returns the code (`2` for the check, `1` for the keyed pair). That is what lets each entry be a single `process.exit(await runX())`.
- **`summarizeVerdicts` replaced the inline counter**, and the precedence is now explicit rather than riding on `Math.max` over code values. An unknown code counts as a no-verdict.
- **One planned test was dropped rather than shipped.** A `checkMethod` case for a stale sidecar could only assert "not current" (the fixture lock is unparseable before the comparison is reached), so its name promised more than it checked; `compareSources` is already pinned precisely in `shared.test.mts`.
- **Verified:** `make all` green; `npm run codegen:check` exits `0` from the repo root and from an unrelated cwd, with identical output to before the split.
