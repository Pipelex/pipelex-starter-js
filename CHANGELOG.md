# Changelog

## [Unreleased]

### Changed

- Breaking: swapped the Pipelex SDK from `mthds` (`MthdsApiClient`) to `@pipelex/sdk` (`PipelexApiClient`). `PipelexApiClient` reads `PIPELEX_API_KEY` / `PIPELEX_API_URL` natively, so the client is constructed bare with no env-var bridging. Error classes are imported from the `@pipelex/sdk` barrel (it has no `/errors` subpath; the barrel is client-bundle-safe).
- `make use-local` / `make use-npm` now target the sibling `../pipelex-sdk-js` repo instead of `../mthds-js`.

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
