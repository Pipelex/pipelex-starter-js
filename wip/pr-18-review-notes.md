# Follow-up: PR #18 (codegen) review-agent triage

**Source:** the unresolved review-bot threads on [PR #18](https://github.com/Pipelex/pipelex-starter-js/pull/18), triaged and verified against the code. Two of the three were real and were fixed on the branch; the third was a false positive whose one real edge was closed by the second fix. Nothing from the threads themselves is deferred — this file records the one finding the verification turned up that is a judgment call rather than a defect.

## The codegen scripts cannot be unit-tested as they stand

**Where:** `scripts/codegen.mts`, `scripts/codegen-check.mts`, `scripts/codegen-verify.mts`.

All three call `main()` unconditionally at module scope (`codegen.mts:205`), so importing any of them from a test executes the whole script — network calls, `process.exit`, and in `codegen.mts`'s case writes into `src/generated/`. There is consequently no test coverage of `writeTree`, the tree cleanup, the drift comparison, or the lock-filename guard added in this PR.

`scripts/codegenShared.test.mts` (new here, the first test under `scripts/`) works only because it exercises a pure export, `hashSource`, and never touches the modules that self-invoke. Vitest picks it up with no config change — `vitest.config.mts`'s include glob already matches `.mts`, and `tsconfig.scripts.json` already type-checks the directory — so the infrastructure is in place; it is only the scripts' shape that blocks wider coverage.

**Open question:** whether to give the three scripts an `import.meta.url === process.argv[1]` main-guard and export their internals, so `writeTree` and the guard become testable. Arguments both ways:

- **For:** `writeTree`'s cleanup loop deletes files, and the correctness of its `isStampableArtifactPath` filter (the thing that keeps `sources.json` from being removed) rests entirely on review. A fixture-tree test would pin it.
- **Against:** these are dev-only scripts in a template whose stated goal is to stay small, and the restructure is larger than any fix it would cover. The lock guard in particular is straight-line code whose failure mode is a hard stop.

It was deliberately left out of PR #18 as scope beyond the reported issues. Decide it on its own merits rather than as a rider on a bug fix.

## Deferred from the pre-landing review

A second review pass (four specialists plus two independent adversarial passes, Claude and Codex) turned up the four defects now fixed on the branch — the unstamped-sibling deletion, the orphan-tree verdicts, the empty-string `public_url` regression, and the blind null strip. What follows is what that pass found and did **not** fix, each verified rather than asserted, ordered by how much it would cost a consumer.

### Symlink policy is unmade, and every outcome of not making it is a wrong verdict

`walk` (`scripts/codegenShared.mts:62`) branches on `entry.isDirectory()` / `entry.isFile()`, and `readdir(..., { withFileTypes: true })` reports a symlink as neither — so symlinked entries are silently invisible. Three consequences, all verified in a scratch tree:

- Under `methods/`, a symlinked `.mthds` (the obvious way to share one bundle between two methods) is dropped from the closure sent to `/v1/codegen` **and** from `sources.json`, so editing that shared file never trips `stale-source`. The gate whose entire purpose is "you edited a bundle and forgot to regenerate" is blind to it.
- Under `src/generated/`, a symlinked artifact is reported `missing` although it is on disk.
- A symlink at the _root_ of a tree behaves differently again: `readdir` follows it, so `walk("src/generated/<method>")` where that path is a symlink returns the **target's** files. Verified directly — a symlinked `outDir` pointing at `../..` puts repository files into the cleanup loop's candidate list.

The SDK hands this decision to the caller on purpose (`codegen-check.js:259` — "Pruning vendor/VCS directories and skipping symlinks is walk policy and stays with the caller"). The starter has not made one. Following symlinks and refusing them by name are both defensible; silently ignoring them is the only option that produces a confident wrong answer. Note the root-symlink case is only reachable from a hostile branch, which is already game over for anything running `npm run`, so this is hardening rather than a live exposure.

### Artifacts are read with lossy UTF-8 decoding — the one SDK caller obligation not discharged

`scripts/codegenShared.mts:158` reads artifacts with `readFile(path, "utf-8")`. The SDK documents this precise hazard (`codegen-check.js:264`): `readFile` substitutes U+FFFD for invalid bytes and never throws, so a corrupted artifact whose body legitimately contains U+FFFD can still hash to the locked value and report current. It recommends `new TextDecoder("utf-8", { fatal: true })`. `readGeneratedTree`'s doc comment walks through two of the three caller obligations and names the wrong-verdict consequence of each; this third one is neither discharged nor mentioned.

### Exit-code contract nits

The contract is `0` current, `1` drift, `2` no verdict.

- An empty `methods/` exits `2` at `codegen-check.mts:100` **before** orphan detection at line 175 ever runs. Delete every method but leave `src/generated/` populated and you get "nothing to check" rather than the orphan drift that block exists to find.
- `walk` failing for any reason collapses to `{ status: "no-tree" }` (`codegenShared.mts:143`) → exit `1` plus "Run `npm run codegen` to regenerate." An `EACCES` or `ENOTDIR` produced no verdict (`2`), and regenerating will not fix it.
- `worst = Math.max(worst, code)` lets one method's `2` mask another's `1`. Both fail `make check`, so this is reporting fidelity, not a gate hole.

### Smaller items, each verified

- **Case-insensitive filesystems.** With `methods/Extract-Entities/` and `src/generated/extract-entities/`, `readGeneratedTree` opens the real directory and passes while `findOrphanTrees` compares the on-disk name against the expected one and reports an orphan — permanently red on macOS, green on Linux, and the printed remedy would delete the tree the same run just certified. Nothing normalizes case here.
- **`REPO_ROOT = process.cwd()`** (`codegenShared.mts:21`) makes all three scripts cwd-dependent. Run from anywhere but the package root and `discoverMethods` throws ENOENT out of `main()`, printing a raw stack and exiting 2 — bypassing the friendly "no methods found" branch two lines in. `import.meta.dirname` + `".."` is deterministic.
- **Regeneration is neither atomic nor concurrency-safe.** Artifacts, then deletions, then the sidecar, one file at a time. A crash leaves a mixed old/new tree. Judged over-engineering to fix for a single-developer dev script, but it is a real property.
- **`PIPELEX_BASE_URL` accepts plaintext `http:`.** The scripts write server-supplied TypeScript into the repo and the SDK's own gate allows `http:`, so a plaintext base URL exposes both the bearer token and the artifact content on the wire. A scheme check (allowing localhost) is a few lines.
- **The `data:` arm of `WEB_RENDERABLE_SCHEMES`** admits any media type, and the validated string feeds `<a href={src} download>` as well as `<img src>`. Harmless in the image, but a `data:text/html` output would hand the user an attacker-authored file that runs on a `file://` origin once opened. Low likelihood — the URL comes from the image provider, not free LLM text.
- **The zod client-side boundary is one keyword deep.** Verified that zod does _not_ reach the client bundle today (no `ZodError` in any `.next/static/chunks/*.js`) because the three `*Result.tsx` components use `import type`. A consumer who drops that `type`, or calls a generated `parseXxx` from a `"use client"` component, ships zod plus every generated schema to the browser with nothing failing. `import "server-only"` at the top of `src/lib/wireOutput.ts` would make that a build error.
- **`dropWireNulls` recursion is unbounded.** Now that the walk is schema-guided its depth is bounded by the declared shape rather than by the payload, which removes the practical concern; a recursive concept reached through `z.lazy()` is still payload-driven.

### Not findings, recorded so they are not re-investigated

- **Path traversal via `artifacts[].path` is genuinely closed.** `runCodegenCheck` at `codegen.mts:179` runs before any write and routes every entry through `validateCanonicalPath`, which rejects empty paths, backslashes, control characters, leading `/`, drive prefixes, and any `.`/`..` component.
- **Secrets are clean.** The key travels only in an `Authorization` header, `isValidBaseUrl` rejects URL-embedded credentials, `loadEnvConfig`'s `info` logger is silenced, and no `dangerouslySetInnerHTML` / `innerHTML` / `eval` exists in `src/`.
- **`prettier --write` on an explicitly-staged generated file is a real no-op** — `.prettierignore` is honoured for explicit paths, so lint-staged cannot break a stamp.
- **`sources.json` is forgeable** (edit a bundle, recompute the hash, leave the tree stale) — but it is a forgetting-guard, not an integrity control, and `codegen:verify` is the answer to the deliberate case. Working as designed.
- **A deep payload no longer crashes the app.** `wireOutput` is called _inside_ each narrower's `try`, so even a `RangeError` becomes a classified `BadPipelineOutputError` rather than an unhandled throw.
