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

- [x] **`src/lib/blockingRun.test.ts`**: drop the `parseEntities` / `parseGeneratedImage` imports. Add two local fixtures: `parseFixture(results: RunResults)` returning `results.main_stuff` after a minimal shape check (throw `BadPipelineOutputError` when the expected key is missing — keeps the durable/blocking bad-output classification paths honest), and `parseImageFixture(results)` that throws `BadImageOutputError` when the payload has no `url` (drives the existing `bad_image_output` case, currently the `{ caption: "no url" }` payload).
- [x] **`src/lib/durableRun.test.ts`**: same `parseFixture` (this file only used `parseEntities`).
- [x] **`README.md` removal checklist item on shared references**: trim the unit-test halves — after this, the text example's shared-code references are only `e2e/error-display.spec.ts`, the `src/app/page.tsx` blurb, and the bundle-read hint in `src/lib/errors.ts`.
- [x] `make all`, commit — **deviation: landed on `feature/Codegen-follow-ups`, not PR #19** (see checkpoint record).
- [x] Resolve `wip/pr-19-review-notes.md` (machine-local): replaced the body with a one-line resolution.

> **CHECKPOINT 1** — Template-adoptability theme complete; PR #19 carries its last code piece. Natural handoff: everything after this happens on a new branch off `origin/dev`. Record here: the commit SHA, and any deviation from the fixture design above.
>
> **Record (2026-08-20):** PR #19 was already merged into `dev` before this phase ran, so the plan's "commit on `feature/Template-readiness`, push, update PR #19" was impossible. The work landed as commit `5c42288` on **`feature/Codegen-follow-ups`** (cut from `dev` at the PR #19 merge), and all remaining phases continue on this same branch → one PR to `dev`, superseding the planned separate `fix/Codegen-gate-fidelity` branch. Fixture design as planned, with the neutral shape `{ items: string[] }` (`FixtureOutput`) replacing the entity-shaped payloads so no example vocabulary remains; `parseImageFixture` narrows to `{ url: string }` and throws `BadImageOutputError` when `url` is absent. No other deviation.

## Phase 2 — `codegenShared.mts` core fixes (new branch `fix/Codegen-gate-fidelity` off `origin/dev`)

- [x] **cwd independence**: `REPO_ROOT = path.resolve(import.meta.dirname, "..")` (engines pin Node ≥ 22.12, so `import.meta.dirname` is safe).
- [x] **`readTextFile(absPath)`** with the fatal `TextDecoder`; swap every `readFile(p, "utf-8")` call site: sources in `discoverMethods`, lock + artifacts in `readGeneratedTree`, the sidecar in `compareSources`. Export a tagged error (e.g. `NonUtf8FileError`) carrying the path.
- [x] **Symlink refusal**: export a tagged error (e.g. `SymlinkRefusedError`). In `walk`: `lstat` the root before the first `readdir` (recursive calls descend only vetted dirents, so the guard is top-level only); per entry, refuse `isSymbolicLink()` and anything that is neither file nor directory, naming the path and its kind. In `discoverMethods`: refuse a symlinked entry at the `methods/` root instead of silently skipping it.
- [x] **Move `compareSources` and `findOrphanTrees` from `codegen-check.mts` into `codegenShared.mts`**, parameterized on their directories (no module-level `GENERATED_ROOT` read inside them). `findOrphanTrees` gains the case-fold comparison and returns orphans and case-mismatches separately.
- [x] **Tests in `scripts/codegenShared.test.mts`** over `mkdtemp` fixture trees: symlinked file / dir / root each throw naming the path; invalid UTF-8 bytes throw from `readTextFile` and surface from `readGeneratedTree`; `findOrphanTrees` reports an orphan dir, a case-mismatch dir, and ignores a plain root file; `compareSources` covers stale / new / removed source, missing sidecar, and a sidecar with no `sources` map.
- [x] Commit (`4edd176`).

## Phase 3 — `codegen-check.mts` reporting fidelity

- [x] **Orphan detection always runs**: reorder `main()` so `findOrphanTrees` executes even when `methods/` is empty; empty + orphans → report + exit 1; empty + clean → keep "nothing to check", exit 2.
- [x] **Distinguish walk failure from no-tree**: in `readGeneratedTree`, only `ENOENT` maps to `{ status: "no-tree" }`; any other failure becomes a `walk-error` status (or rethrow of the tagged errors) that the check reports as **no verdict** (exit 2) with the underlying message — never the regenerate remedy.
- [x] **Map the tagged errors per the decisions above**: per-method catch inside the loop (`NonUtf8FileError` in a generated tree → drift + regenerate; `SymlinkRefusedError` → no verdict + policy message); wrap the `discoverMethods` call so a source-side refusal prints message-only and exits 2 instead of a raw stack.
- [x] **Case-mismatch reporting** with the rename remedy, as drift.
- [x] **Summary line** at the end (counts of current / drift / no verdict) and a header-comment note documenting the aggregation precedence.
- [x] Commit (`515f5ee`, amended). (Full `main()` coverage remains the parked main-guard item — the moved helpers carry the test weight.)

> **CHECKPOINT 2** — the gate's verdicts are now trustworthy. Record here: which tagged-error mappings ended up where, and any exit-code behavior that deviated from the decisions section.
>
> **Record (2026-08-20):** commits `4edd176` (shared layer + tests) and `515f5ee` (check rewrite), on `feature/Codegen-follow-ups`. Mappings landed exactly per the decisions section, all inside a per-method `checkMethod()` helper: `NonUtf8FileError` from a generated tree → drift + regenerate remedy; `SymlinkRefusedError` anywhere → no verdict with the policy message; either error from `discoverMethods` (source side) → message-only, exit 2; any other tree-read failure → no verdict with the underlying message (never the regenerate remedy). `readGeneratedTree` maps only ENOENT to `no-tree`/`no-lock` (implemented in the shared layer rather than a `walk-error` status — the errors propagate as themselves, which kept the status type unchanged). Exit-code aggregation kept no-verdict > drift > current precedence, now computed from the per-category counters that also feed the summary line. Deviations: (1) `assertSecureBaseUrl` (a Phase 4 item) landed in the Phase 2 commit together with its test matrix, since it lives in `codegenShared.mts`; Phase 4 only wires it into the two keyed scripts. (2) One implementation fix along the way: TypeScript parameter properties are rejected by Node's strip-types mode, so the tagged error classes declare their `filePath` field explicitly. (3) `findOrphanTrees` also refuses a symlink/special entry at the `src/generated/` root (consistent with the policy) — the plan only specified dirs vs files there. Live-verified verdicts: orphan → 1, generated-tree symlink → 2, source symlink → 2 (message-only), empty `methods/` with leftover trees → orphans reported, exit 1; cwd independence verified by running from `scripts/`.

## Phase 4 — hardening riders

- [x] **`assertSecureBaseUrl(url)`** — pure, in `codegenShared.mts` (its charter bans env/network reads, not pure validators): allow `https:` anywhere; allow `http:` only for `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`. Apply where the scripts read `PIPELEX_BASE_URL` (`codegen.mts` and `codegen-verify.mts` `main()`s), with a message saying why (bearer token + server-supplied TypeScript on the wire). Test the matrix in `codegenShared.test.mts`.
- [x] **`import "server-only"` in `src/lib/wireOutput.ts`**: add the `server-only` package to dependencies; alias it in `vitest.config.mts` (`resolve.alias`) to a tiny empty stub module at the repo root (next to `vitest.setup.ts`) so unit tests that import narrowers keep passing; verify `make build` (Next resolves the real package server-side).
- [x] **`CLAUDE.md` touch-ups**: the `wireOutput.ts` lines that call it "(pure)" gain the server-only note (it stays pure — it is now also build-enforced server-side).
- [x] Commit (`322bf2f`).

## Phase 5 — docs, changelog, wrap-up

- [x] **`docs/codegen.md`**: update the exit-code contract line (new no-verdict causes, aggregation precedence, summary line) and add short sections for the symlink policy, fatal decoding, case-mismatch remedy, base-URL scheme guard, and cwd independence.
- [x] **`CHANGELOG.md`** under `## [Unreleased]`: Fixed entries for the wrong-verdict classes (symlink blindness, lossy decoding, orphan ordering, case mismatch, cwd dependence), Changed/Added for the scheme guard and `server-only`.
- [x] `make all` clean; push; open PR — **`feature/Codegen-follow-ups` → `dev`** (single PR, per Checkpoint 1's branch deviation).
- [x] **`wip/_top_priorities.md`**: tick the completed P1/P2 items, note the symlink decision ("refuse by name") next to the P1 entry, and add the new open question: _should `make check` pass on an intentionally-empty `methods/` (a consumer who removed every example before adding their own)?_ — an adoptability call, currently exit 2.
- [ ] Archive this tracker (wip-triage) once both PRs merge.

> **CHECKPOINT 3 (final)** — record: both PR numbers, the SHAs, decisions that changed along the way, and anything discovered that belongs in `wip/` or `../wip/inbox/`.
