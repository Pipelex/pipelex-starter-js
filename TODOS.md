# TODOS — burn down the top of `wip/_top_priorities.md` in one go

Local working tracker (not committed with the PRs; archive via wip-triage when done). Source items: `wip/_top_priorities.md` P1 + P2, backed by the archived review record `../wip/history/codegen/pipelex-starter-js-codegen-followups-pr18.md` and `wip/pr-19-review-notes.md`.

## Scope decision

**In this go: every P1 and P2 item.** They form two natural clusters that together close the "hot" and "warm" heat themes:

1. **Template adoptability** — the shared-helper test decoupling, the last code-shaped piece of the Template-readiness story. Lands as a commit on the open PR #19 branch (`feature/Template-readiness`, targets `dev`).
2. **Codegen gate fidelity + cheap hardening** — symlink policy, fatal UTF-8 decoding, exit-code fidelity, case-insensitive orphan detection, cwd independence, the plaintext-`http:` guard, and `import "server-only"` in `wireOutput.ts`. All but the last touch `scripts/codegenShared.mts` / `scripts/codegen-check.mts`, so they are one coherent branch: **`fix/Codegen-gate-fidelity`**, cut from `origin/dev`, PR → `dev`. It does not conflict with PR #19 (the only shared file would be `README.md`, which only Phase 1 touches).

**Parked (P3, unchanged):** the `data:` media-type arm, regeneration atomicity, `z.lazy()` recursion depth, and the full main-guard restructure of the three scripts. Instead of the restructure, this plan moves the logic being _changed_ (`compareSources`, `findOrphanTrees`) into `codegenShared.mts`, which is already importable and tested — every fix gets pinned by a test without restructuring the scripts' entry points. The main-guard question stays open on its own merits, now smaller.

## Decisions taken (with rationale)

- **Symlink policy: refuse by name, loudly.** Anything under `methods/` or a generated tree that is not a regular file or a directory (symlink, FIFO, socket) — and a symlinked tree root or method directory — throws a tagged error naming the repo-relative path and the policy. Refusal produces **no verdict** (exit 2 in the check). Rationale: following symlinks needs cycle handling and keeps the root-symlink cleanup hazard alive; a template wants deterministic, loud behavior. Both beat today's silent wrong verdict.
- **Fatal UTF-8 decoding everywhere, mapped by ownership.** One shared `readTextFile()` using `new TextDecoder("utf-8", { fatal: true })` replaces every `readFile(p, "utf-8")`. A decode failure in a **generated tree** (artifact or lock) reports per-method with the regenerate remedy — regeneration genuinely fixes it, so it is drift (exit 1). A decode failure in a **`.mthds` source** is refused with a clear message (exit 2) — regenerating would ship garbage to the API.
- **Exit-code aggregation keeps `Math.max` precedence (no-verdict wins), documented, plus a summary line.** The end of the check prints a per-category count line (current / drift / no verdict), so the exit code no longer hides the mix. Changing precedence would claim a full verdict a run never produced.
- **Empty `methods/` still exits 2, but orphan detection runs first.** With generated trees left behind, they are reported as orphans (exit 1) instead of "nothing to check". Open question recorded below about whether an intentionally-empty template should pass `make check` at all — out of scope here.
- **Case mismatch is its own verdict with a rename remedy.** A generated dir that case-folds onto a method name but differs byte-wise reports "rename `src/generated/<X>/` to `<y>`" (drift), never the delete remedy that would destroy a tree the same run certified.
- **Inline fixture narrowers for the shared-helper tests, no zod, no generated imports.** They import only `RunResults` (from `@pipelex/sdk`) and the shared tagged errors from `@/types/pipelineError` — both non-removable — so the shared layer's tests survive any example's removal. The real adapters stay covered by their own co-located tests, which keeps "the examples are the canonical patterns" true where it matters.

---

## Phase 1 — decouple the shared-helper tests (on `feature/Template-readiness`, PR #19)

- [ ] **`src/lib/blockingRun.test.ts`**: drop the `parseEntities` / `parseGeneratedImage` imports. Add two local fixtures: `parseFixture(results: RunResults)` returning `results.main_stuff` after a minimal shape check (throw `BadPipelineOutputError` when the expected key is missing — keeps the durable/blocking bad-output classification paths honest), and `parseImageFixture(results)` that throws `BadImageOutputError` when the payload has no `url` (drives the existing `bad_image_output` case, currently the `{ caption: "no url" }` payload).
- [ ] **`src/lib/durableRun.test.ts`**: same `parseFixture` (this file only used `parseEntities`).
- [ ] **`README.md` removal checklist item on shared references**: trim the unit-test halves — after this, the text example's shared-code references are only `e2e/error-display.spec.ts`, the `src/app/page.tsx` blurb, and the bundle-read hint in `src/lib/errors.ts`.
- [ ] `make all`, commit on `feature/Template-readiness`, push (updates PR #19).
- [ ] Resolve `wip/pr-19-review-notes.md` (machine-local): replace the body with a one-line resolution, or delete it.

> **CHECKPOINT 1** — Template-adoptability theme complete; PR #19 carries its last code piece. Natural handoff: everything after this happens on a new branch off `origin/dev`. Record here: the commit SHA, and any deviation from the fixture design above.

## Phase 2 — `codegenShared.mts` core fixes (new branch `fix/Codegen-gate-fidelity` off `origin/dev`)

- [ ] **cwd independence**: `REPO_ROOT = path.resolve(import.meta.dirname, "..")` (engines pin Node ≥ 22.12, so `import.meta.dirname` is safe).
- [ ] **`readTextFile(absPath)`** with the fatal `TextDecoder`; swap every `readFile(p, "utf-8")` call site: sources in `discoverMethods`, lock + artifacts in `readGeneratedTree`, the sidecar in `compareSources`. Export a tagged error (e.g. `NonUtf8FileError`) carrying the path.
- [ ] **Symlink refusal**: export a tagged error (e.g. `SymlinkRefusedError`). In `walk`: `lstat` the root before the first `readdir` (recursive calls descend only vetted dirents, so the guard is top-level only); per entry, refuse `isSymbolicLink()` and anything that is neither file nor directory, naming the path and its kind. In `discoverMethods`: refuse a symlinked entry at the `methods/` root instead of silently skipping it.
- [ ] **Move `compareSources` and `findOrphanTrees` from `codegen-check.mts` into `codegenShared.mts`**, parameterized on their directories (no module-level `GENERATED_ROOT` read inside them). `findOrphanTrees` gains the case-fold comparison and returns orphans and case-mismatches separately.
- [ ] **Tests in `scripts/codegenShared.test.mts`** over `mkdtemp` fixture trees: symlinked file / dir / root each throw naming the path; invalid UTF-8 bytes throw from `readTextFile` and surface from `readGeneratedTree`; `findOrphanTrees` reports an orphan dir, a case-mismatch dir, and ignores a plain root file; `compareSources` covers stale / new / removed source, missing sidecar, and a sidecar with no `sources` map.
- [ ] Commit.

## Phase 3 — `codegen-check.mts` reporting fidelity

- [ ] **Orphan detection always runs**: reorder `main()` so `findOrphanTrees` executes even when `methods/` is empty; empty + orphans → report + exit 1; empty + clean → keep "nothing to check", exit 2.
- [ ] **Distinguish walk failure from no-tree**: in `readGeneratedTree`, only `ENOENT` maps to `{ status: "no-tree" }`; any other failure becomes a `walk-error` status (or rethrow of the tagged errors) that the check reports as **no verdict** (exit 2) with the underlying message — never the regenerate remedy.
- [ ] **Map the tagged errors per the decisions above**: per-method catch inside the loop (`NonUtf8FileError` in a generated tree → drift + regenerate; `SymlinkRefusedError` → no verdict + policy message); wrap the `discoverMethods` call so a source-side refusal prints message-only and exits 2 instead of a raw stack.
- [ ] **Case-mismatch reporting** with the rename remedy, as drift.
- [ ] **Summary line** at the end (counts of current / drift / no verdict) and a header-comment note documenting the aggregation precedence.
- [ ] Commit. (Full `main()` coverage remains the parked main-guard item — the moved helpers carry the test weight.)

> **CHECKPOINT 2** — the gate's verdicts are now trustworthy. Record here: which tagged-error mappings ended up where, and any exit-code behavior that deviated from the decisions section.

## Phase 4 — hardening riders

- [ ] **`assertSecureBaseUrl(url)`** — pure, in `codegenShared.mts` (its charter bans env/network reads, not pure validators): allow `https:` anywhere; allow `http:` only for `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`. Apply where the scripts read `PIPELEX_BASE_URL` (`codegen.mts` and `codegen-verify.mts` `main()`s), with a message saying why (bearer token + server-supplied TypeScript on the wire). Test the matrix in `codegenShared.test.mts`.
- [ ] **`import "server-only"` in `src/lib/wireOutput.ts`**: add the `server-only` package to dependencies; alias it in `vitest.config.mts` (`resolve.alias`) to a tiny empty stub module at the repo root (next to `vitest.setup.ts`) so unit tests that import narrowers keep passing; verify `make build` (Next resolves the real package server-side).
- [ ] **`CLAUDE.md` touch-ups**: the `wireOutput.ts` lines that call it "(pure)" gain the server-only note (it stays pure — it is now also build-enforced server-side).
- [ ] Commit.

## Phase 5 — docs, changelog, wrap-up

- [ ] **`docs/codegen.md`**: update the exit-code contract line (new no-verdict causes, aggregation precedence, summary line) and add short sections for the symlink policy, fatal decoding, case-mismatch remedy, base-URL scheme guard, and cwd independence.
- [ ] **`CHANGELOG.md`** under `## [Unreleased]`: Fixed entries for the wrong-verdict classes (symlink blindness, lossy decoding, orphan ordering, case mismatch, cwd dependence), Changed/Added for the scheme guard and `server-only`.
- [ ] `make all` clean; push; open PR `fix/Codegen-gate-fidelity` → `dev`.
- [ ] **`wip/_top_priorities.md`**: tick the completed P1/P2 items, note the symlink decision ("refuse by name") next to the P1 entry, and add the new open question: _should `make check` pass on an intentionally-empty `methods/` (a consumer who removed every example before adding their own)?_ — an adoptability call, currently exit 2.
- [ ] Archive this tracker (wip-triage) once both PRs merge.

> **CHECKPOINT 3 (final)** — record: both PR numbers, the SHAs, decisions that changed along the way, and anything discovered that belongs in `wip/` or `../wip/inbox/`.
