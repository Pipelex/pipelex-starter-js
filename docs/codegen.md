# Codegen: generated types from `.mthds` bundles

This is the reference for the code-generation workflow behind `src/generated/` — why it exists, how the commands relate, what the trust chain guarantees, and the one workaround it currently carries. The day-to-day rules live in [`CLAUDE.md`](../CLAUDE.md) ("Generated types"); this document is the deeper "why" behind them.

## Why

This template's role is to show developers how to build on Pipelex, and everything our tools can build deterministically should be built by them. Before codegen, the template hand-wrote in `src/types/` the very thing each method already declares in its `.mthds` bundle: the output concept's shape plus a hand-rolled runtime narrower per shape. That is a duplicated type surface with no drift guard — edit a bundle's structure and nothing tells you the TypeScript is now lying.

`@pipelex/sdk` exposes the crate routes: `client.codegen({ kind: "types", target: "ts-zod" })` projects a method's normalized library crate into stamped typed artifacts — a `types.ts` (zod schemas + inferred types), a `binder.ts` (typed `parse<Name>` / `serialize<Name>` pairs), and a `codegen.lock` — byte-identical to a local `pipelex codegen types` run. The SDK also ships `runCodegenCheck`, the pure offline drift check: a port of pipelex's `codegen check` that reaches the same verdict over the same bytes, down to the drift `detail` sentences.

The design goal in one sentence: **`npm run codegen` regenerates committed, typed, zod-validated artifacts for every method in `methods/`, `npm run codegen:check` proves offline that they are current, and the app's narrowers are thin adapters over the generated binders.**

## The commands

The npm scripts are the primary interface — this is a JS template and `npm run` is what its consumers reach for. The Make targets (`make codegen`, `make codegen-check`, `make codegen-verify`) are thin wrappers.

| Command                  | What it does                                                                                                                         | Needs network / key?                                       | When                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `npm run codegen`        | Regenerate `src/generated/<method>/` for every method in `methods/`, via `POST /v1/codegen`                                          | Yes — `PIPELEX_API_KEY` + a base URL that serves the route | Dev action: after editing any `.mthds` file            |
| `npm run codegen:check`  | Offline drift check of every generated tree against its `codegen.lock` and sources sidecar                                           | No — pure hashing                                          | CI action: part of `make check`, so `make all` runs it |
| `npm run codegen:verify` | Re-run `codegen()` live and compare its `crate_fingerprint` to each committed lock's — the _semantic_ staleness gate. Writes nothing | Yes — same as `codegen`                                    | Before a release, or in a keyed CI job                 |

Regeneration is the dev action, the offline check is the CI action — the split pipelex's codegen engine is designed around, so engine improvements never redden a consumer's CI. `npm run codegen` stays out of `make all` for the same reason `test-e2e` does: it needs a key and a network.

## Layout

```
methods/
  extract-entities/main.mthds        # source of truth
src/generated/                        # committed, generated, never hand-edited
  extract-entities/
    types.ts                          # zod schemas + z.infer types — imports only `zod`
    binder.ts                         # parse<Name> / serialize<Name> over the schemas
    codegen.lock                      # pipelex trust-chain lock, written verbatim
    sources.json                      # starter-owned staleness sidecar (see below)
  summarize-pdf/ …                    # same trio + sidecar per method
scripts/
  codegen.mts                         # the generator (npm run codegen)
  codegen-check.mts                   # the offline check (npm run codegen:check)
  codegen-verify.mts                  # the keyed semantic gate (npm run codegen:verify)
  codegenShared.mts                   # paths, walk, sha256, discoverMethods, the sidecar
tsconfig.scripts.json                 # type-checks scripts/, the tsconfig.e2e.json pattern
```

One generated tree per method, mirroring `methods/` one-to-one: each method is its own closure, so each gets its own crate, artifact set, and lock. The trees live under `src/` so the `@/` alias reaches them and `tsc` type-checks them as part of the app.

**Committed, deliberately.** A template consumer must see the generated code without holding an API key, `git clone && make all` must pass keyless, and the diff of a regeneration is itself documentation of what a bundle edit changed. The offline check keeps the committed tree honest.

## The trust chain

**The server's artifacts are written verbatim.** Every `artifacts[]` entry lands at its `path` and the lock content at `codegen.lock`, byte-for-byte, so the tree is identical to a local `pipelex codegen types` run — same stamps, same lock — and the offline check holds. Editing an artifact or re-serializing the lock breaks the chain, which is why `src/generated/` is excluded from Prettier and ESLint (the emitter targets Prettier's defaults at 80 columns; this repo prints at 100, so a reformat would rewrite bytes and break every stamp). `tsc` keeps full coverage — the trees are inside `src/` and the base tsconfig — and that is the check that matters.

The generator also mirrors pipelex's own write discipline:

- **Write-if-changed** — no mtime churn, clean diffs, a full regeneration over a current tree is a true no-op.
- **Orphan cleanup defers to the checker.** Stale artifacts that dropped out of the set are removed, but the authority on what may be removed is `runCodegenCheck`'s own `orphan` verdict over the tree just written — not a filename test. A suffix test answers "could this file type be an artifact"; the SDK's orphan rule additionally requires the file to carry a codegen stamp. Deleting on the weaker test would destroy any hand-written sibling `.ts` a consumer parks in the tree — the very "sibling module" the generated header recommends for declaration merging. Deferring to the check makes the writer and the checker agree by construction.
- **A renamed lock is refused, not followed.** The offline check opens `codegen.lock` by name; if the server ever returns a different `lock_filename`, silently following it would leave the old lock in place for the check to keep validating — green, from the wrong file. The writer reports it and writes nothing.
- **Self-verify before writing.** The generator runs `runCodegenCheck` over the server's own response before touching disk; a tree that would fail its own check is never written.

## Two staleness gates, because they answer different questions

The offline check proves the tree matches the lock; it deliberately never proves the tree is current with the _bundles_, since that needs the engine. So there are two gates:

- **Offline (`codegen:check`, in `make check`)** — the `sources.json` sidecar. `npm run codegen` writes it beside each lock: the repo-relative path and SHA-256 of every source `.mthds` in the closure, compared on every check. Edit a bundle, forget to regenerate, and `make check` fails with "run `npm run codegen`" instead of shipping silently stale types. Coarse and knowingly so — a byte hash where the crate fingerprint is semantic, so reformatting a bundle trips a false "stale" whose remedy is a regeneration that write-if-changed turns into a clean no-op. Hashing normalizes CRLF and lone CR first, so a Windows checkout is not a false stale. The sidecar is starter-owned, unstamped, and outside the lock (which stays byte-exact); the check also covers the whole-tree cases a single tree cannot see — a method with no generated tree, and a generated tree with no method behind it.
- **Keyed (`codegen:verify`)** — the semantic gate the sidecar approximates. The script re-runs `codegen()` live and compares its `crate_fingerprint` against each committed lock's, writing nothing. No false positives on reformatting — the fingerprint is semantic — but it needs a key and a network, so it stays out of `make all` and complements the sidecar rather than replacing it.

**Exit codes are a contract**: `0` current, `1` drift or stale sources, `2` no verdict. No-verdict causes: a missing or malformed lock; a `lock_version` this SDK build does not know (whose message names the version found and says to bump `@pipelex/sdk`, not to touch the tree); a refused symlink or special file; a non-UTF-8 `.mthds` source; or any other tree-read failure — in that last case the check prints the underlying message and never the regenerate remedy, which would claim a verdict the run did not produce. Aggregation across methods is by precedence — no-verdict outranks drift outranks current — because as long as any method could not be checked, the run has not produced the full verdict a `0` or `1` would claim. A per-category summary line (`N current · N drift · N no verdict`) at the end shows the mix the single exit code cannot.

## Gate fidelity policies

The verdicts above are only worth trusting because of a few deliberately loud policies in the shared layer (`scripts/codegenShared.mts`), each of which replaced a way the gate could be _silently wrong_:

- **Symlinks and special files are refused by name.** Anything under `methods/` or a generated tree that is not a regular file or a directory — a symlink, FIFO, or socket, including a symlinked tree root, method directory, or the `methods/` / `src/generated/` roots themselves — throws `SymlinkRefusedError` naming the path, and the check reports no verdict. Following symlinks would need cycle handling, and a symlinked `.mthds` used to drop out of the codegen closure _and_ `sources.json`, so editing it never tripped `stale-source`.
- **UTF-8 decoding is fatal.** Every text read goes through `readTextFile`, which throws `NonUtf8FileError` instead of substituting U+FFFD. A lossy decode could hash a corrupted artifact to its locked value and report it `current`. The error maps by ownership: in a generated tree it is drift (regenerating rewrites the file), in a `.mthds` source it is a refusal (regenerating would ship garbage to the API).
- **A case-mismatched tree gets a rename remedy, never a delete.** On a case-insensitive filesystem (macOS's default) the per-method check happily opens a tree whose on-disk name differs from the method's in case only and certifies it current; a byte-wise orphan scan would then print a delete remedy for that same tree. The scan case-folds the comparison and reports "rename `src/generated/<X>/` to `<y>`" as drift.
- **Orphan detection runs even when `methods/` is empty.** Generated trees left behind after the last method was removed report as orphans (drift), not "nothing to check"; only empty-and-clean keeps the no-verdict exit.
- **The scripts are cwd-independent.** `REPO_ROOT` anchors on `import.meta.dirname`, not `process.cwd()`, so running a script from any directory produces the same verdict instead of a raw ENOENT.
- **The keyed scripts refuse a plaintext `http:` base URL for any non-loopback host** (`assertSecureBaseUrl`; `localhost`, `*.localhost`, `127.0.0.1`, and `[::1]` are allowed). They send the API key as a bearer token and write server-supplied TypeScript into the repo, so a non-local plaintext URL exposes both on the wire.

**An engine bump restamps everything, and that is expected.** `engine_version` rides in the artifact stamps, so an upstream pipelex release restamps the whole tree with zero semantic change — `crate_fingerprint` is the semantic signal, and it stays put. `codegen:verify` reports an engine difference as a **note**, not a failure, leaving the whole-tree restamp to a deliberate commit.

## The narrowers are adapters, and the one workaround

Each `parseXxx(results: RunResults)` narrower in `src/types/` hands `wireOutput(results)` to the generated binder and translates a thrown `ZodError` into the template's tagged error model (`describeSchemaFailure` renders it through `z.prettifyError`, because a `ZodError`'s own `.message` is a JSON dump). Hand-written validation survives only where it adds semantics the concept does not declare — `parseGeneratedImage`'s web-renderable-URL check is the single example. Generated types flow to the components with their wire-native snake_case keys (`doc_type`, `public_url`); a camelCase mirror would be exactly the duplicated surface codegen removes.

**`dropWireNulls` is a workaround with an expiry, not a design.** The ts-zod projection emits a non-required concept field as `.optional()`, which in zod means `| undefined` and **rejects `null`** — but the runtime serializes an unset optional field as an explicit `null`, because `WorkingMemory.dump_for_transport()` is a `model_dump(serialize_as_any=True)` with no `exclude_none`. This was traced through the emitter, the pydantic defaults, and the transport dump, then **confirmed against a live hosted run** rather than trusted: a `PipeImgGen` run's `main_stuff` carries `caption: null`, `filename: null`, and `source_negative_prompt: null`, so without normalization `parseImage` throws on every real image run — the naive adoption would have shipped an example broken in production and green in unit tests.

The strip is **schema-guided, and that is load-bearing**. `dropWireNulls(value, schema)` takes the concept's generated zod schema and descends only declared shapes: an object field is dropped only when the schema says a `null` there means absence (it accepts `undefined`, rejects `null`, and carries no `.default()` to invent), arrays and record _values_ are descended for their declared element type, and anything opaque — `z.unknown()`, `z.any()`, a union, a `z.record()`'s keys — is passed through untouched. A blind deep strip is precisely what the ts-zod emitter's own design note rules out: inside a `z.record()` a `null` is _data_, and stripping it deletes a value before the schema can object, silently and with a green check. `src/lib/wireOutput.test.ts` pins each of those cases.

It normalizes **values, never names** — it re-declares no field, so it is not the duplicated surface codegen removes — and it is deletable the day the emitter projects non-required fields as `.nullish()` (or the transport dump excludes unset fields). Reported upstream to pipelex; revisit at each pipelex release.

## What is deliberately not built

- **No `resolve` example.** Codegen subsumes it for this template's purpose; the bare crate becomes interesting only for fingerprint-based caching or a custom projection.
- **No generated-code edits, ever.** Customization rides sibling extension files; the adapters in `src/types/` _are_ that sibling layer here.
- **No watch mode, no build-time hook.** Regeneration stays an explicit dev action; wiring it into `next dev` or `next build` would put a network + key dependency inside the build. The sidecar check is the forgetting-guard.
- **No per-pipe kinds.** `kind: "types"` is concept-set-wide and is the only kind served today.

## Open questions

- **The `.optional()`-versus-wire-`null` mismatch** is the one thing here that is a workaround rather than a design. `dropWireNulls` should be deleted, not maintained — the fix belongs in the emitter (or the transport dump), and it is reported upstream.
- **`sources.json` upstreaming**: if the staleness sidecar proves its worth, it may belong in the engine's own lock story rather than a starter convention.
- **Production 403**: `/v1/codegen` is served by any self-hosted `pipelex-api` runner and by `api-dev.pipelex.com`, but `api.pipelex.com` still answers `403` pending its deploy. When production catches up, sweep the caveat from every place that states it: `README.md` ("Generated types"), `CLAUDE.md` (the codegen command table and the workflow rule), `CHANGELOG.md`'s `[Unreleased]` entry, `.env.example`, this list — **and `scripts/codegen.mts`'s `explain()` message**, which is code, not docs, and would otherwise keep steering users at api-dev after the reason expired.
- **`lock_version` upgrade ordering**: an SDK that tolerates a new lock version must ship _before_ the pipelex release that starts writing it. If `make check` ever fails with a version message naming a version this SDK does not know, the fix is bumping `@pipelex/sdk`, not touching the generated tree.
