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
