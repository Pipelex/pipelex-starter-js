# Changelog

## [v0.2.1] - 2026-07-10

### Changed

- Bumped `@pipelex/sdk` to `0.3.1` (was `0.3.0`). A coordination-only bump — the SDK raises its own `mthds` dependency floor to `^0.18.0` (CLI/tooling changes that don't touch the `mthds/protocol` wire types the SDK imports); the SDK's own surface is unchanged, so no code changes were needed in this repo.

## [v0.2.0] - 2026-07-05

### Changed

- Breaking: swapped the Pipelex SDK from `mthds` (`MthdsApiClient`) to `@pipelex/sdk` (`PipelexApiClient`). `PipelexApiClient` reads `PIPELEX_API_KEY` / `PIPELEX_BASE_URL` natively, so the client is constructed bare with no env-var bridging. Error classes are imported from the `@pipelex/sdk` barrel (it has no `/errors` subpath; the barrel is client-bundle-safe).
- Breaking: renamed the env var `PIPELEX_API_URL` to `PIPELEX_BASE_URL` for consistency with the SDK's `baseUrl` naming. There is no read alias — update `.env.local` / your environment.
- `make use-local` / `make use-npm` now target the sibling `../pipelex-sdk-js` repo instead of `../mthds-js`.
- Bumped `@pipelex/sdk` to `0.2.0` (was `0.1.5`). No code changes needed for the `0.2.0` breaking renames (constructor option `apiToken` → `apiKey`, env var `PIPELEX_API_URL` → `PIPELEX_BASE_URL`): this repo constructs `PipelexApiClient` bare and already used `PIPELEX_BASE_URL`.
- Bumped `@pipelex/sdk` to `0.2.1` (was `0.2.0`), which makes the ESM-only SDK loadable from CommonJS (`default` export condition). The e2e specs now import `DEFAULT_API_BASE_URL` from the SDK directly instead of mirroring it as a local constant in `e2e/liveApi.ts`.
- Raised the minimum Node.js to 22.12 (`engines.node: ">=22.12.0"`, was `>=22`), matching the SDK's new floor: Playwright loads the e2e specs via CommonJS `require()`, and `require(esm)` is only unflagged from Node 22.12.
- Bumped `@pipelex/sdk` to `0.3.0` — one resolved output accessor across both execution modes. `RunResults.main_stuff` is now required (non-null), and the blocking `execute()` returns a `PipelexExecuteResult` whose `.main_stuff` the SDK resolves out of the working memory (via the response's `main_stuff_name`). `executeBlockingRun` therefore adapts the blocking response onto `RunResults` as `{ pipeline_run_id, main_stuff }`, and `findOutputContent` reads only `main_stuff` — the `pipe_output` working-memory search arm is gone, so both modes narrow the same resolved field.

### Fixed

- Blocking and durable modes now agree on which output is the "main" one. Previously the blocking path dropped the server's `main_stuff_name` and had `findOutputContent` guess the main output by predicate-shape-matching the first working-memory entry, so a pipeline with an intermediate stuff matching the same narrower predicate could render the wrong result in blocking mode while durable mode read the true `main_stuff` and was correct. With the SDK resolving `.main_stuff` on both paths, the shape-guessing is gone and the two modes can't disagree (closes the latent finding tracked in `wip/durable-runs-review-followups.md` #6).

## [v0.1.1] - 2026-05-21

### Added

- PDF summary example: `summarize-pdf` method, Server Action, and form/result components
- Image generation example: `generate-image` method with `gpt-image-1-mini`
- Sample PDF (`public/sample-invoice.pdf`) so the PDF example works out of the box
- Tabbed UI (`ExampleTabs`) to switch between the three examples
- Structured error handling: `classifyPipelineError`, `PipelineError`, `ErrorDisplay`, tagged `BadPipelineOutputError` subclasses
- Transport-level rejection handling via `classifyTransportError` for client-side `await` failures
- File input pipeline: client-side base64 encoding (`clientFile.ts`) + server-side validation/envelope (`fileEncoding.ts`)

### Changed

- Bumped `mthds` SDK to `0.7.1`
- Server Actions now return discriminated `{ ok: true } | { ok: false, error }` unions instead of throwing across the server→client boundary

### Fixed

- README docs for `make use-local` corrected to match the tarball install (Turbopack does not follow symlinks)

### Repository

- Added MIT `LICENSE` (Evotis S.A.S.) and refreshed the README license section ahead of open-sourcing
- Added CI workflows `lint-check` (runs `make check`) and `tests-check` (runs `make agent-test` + `make build`) on PRs to `main` and `release/vX.Y.Z`
- Removed internal-only planning docs (`TODOS.md`, `wip/`)
- Gitignored `.claude/settings.local.json` so per-user Claude Code settings don't get committed
