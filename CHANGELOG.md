# Changelog

## [Unreleased]

### Changed

- **Bumped `@pipelex/sdk` to `^0.12.0`** (the declared range was `^0.5.1`; the working tree had been running a local `make use-local` tarball of `0.9.0`). No migration was needed in this template: the only breaking changes across the intervening releases are on the methods-catalog surface — `listMethods` now returns one page of `MethodSummary` rows rather than the whole catalog as `MethodData` — and this template never calls it. Everything the examples do use (`PipelexApiClient`, `RunResults`, `StartOptions`, `TokensUsageRecord`, `DictPipeOutput`, and the error classes) is unchanged.
- **The SDK now exposes the crate routes `client.resolve()` and `client.codegen()`.** `resolve` returns a method's normalized library crate; `codegen` projects that crate into stamped typed artifacts (`ts-zod` for TypeScript consumers) plus a `codegen.lock`, so a method's `.mthds` bundle can generate the very types this template currently hand-writes in `src/types/`. No example uses them yet. Worth knowing before adopting them: they are served by any `pipelex-api` runner and by `api-dev.pipelex.com`, but `api.pipelex.com` still answers `403` pending its deploy — so a template consumer pointing at the default hosted base URL cannot reach them today.

### Fixed

- **`make use-npm` restored a stale version instead of the current one.** The target ran `npm install @pipelex/sdk`, which re-resolves the range already declared in `package.json` rather than fetching the current release. Because `@pipelex/sdk` is pre-1.0, a caret range never crosses a minor — so returning from a `make use-local` session with an out-of-date range reinstalled that range's newest match and called it "restored", silently **downgrading** the SDK. It now installs `@pipelex/sdk@latest`, which fetches the published release and re-pins the range to it, and it echoes the version it actually restored so the result is visible rather than assumed.

### Security

- **Bumped `next` to `^16.3.1`** (was `^16.2.9`), clearing every high-severity advisory `npm audit --omit=dev` reported against this template's production dependency tree. All of them came in through Next.js: a set of Next.js advisories of its own (Server Action denial of service and unbounded Edge-runtime payloads, SSRF via rewrites and on custom servers, cache confusion of response bodies, Image Optimization denial of service on SVGs, unauthenticated disclosure of internal Server Function endpoints, and a Turbopack middleware bypass), plus its pinned transitives — `postcss` (arbitrary `.map` file disclosure via an attacker-controlled `sourceMappingURL`, and XSS through unescaped `</style>` in stringify output), `nanoid` (non-terminating generator loops), and `sharp` (inherited libvips CVEs). Next `16.3.1` pins `postcss` `8.5.23` and `sharp` `^0.35.3`, which is what moves the whole tree onto patched versions; `16.2.12`, the highest remaining `16.2.x`, still carries `postcss` `8.4.31` and does not fix them. `eslint-config-next` was raised to `^16.3.1` alongside it to keep the linter in lockstep with the framework.
- **Bumped the `postcss` dev dependency to `^8.5.23`** and refreshed `brace-expansion` and `js-yaml` in the lockfile, so the full `npm audit` — development dependencies included — is now clean as well.

## [v0.3.0] - 2026-07-22

### Added

- **Cost Reports (`tokens_usages`)**: Added token usage and cost tracking for both blocking and durable runs, surfaced via a new `<CostReport>` component (rendered across the Entity, Image, and PDF example forms) that breaks down per-call token usage, model types, and computed USD costs. Backed by new `src/lib/usageReport.ts` utilities that parse and project raw `tokens_usages` and `usage_assembly_error` data into a render-ready format.
- **Upload Error Handling**: Added an `upload_failed` error kind in `src/lib/errors.ts` to classify SDK `InputPreparationError`s (e.g., `UnsupportedUploadCapabilityError`, `RejectedAssetError`, `UploadAuthenticationError`) with actionable, user-friendly UI messages.

### Changed

- **Cleaner File Uploads (Breaking)**: Replaced the hand-rolled base64 `Document` envelope in the PDF summarization pipeline with the SDK's `client.prepareInputs()`. Files now upload directly to Pipelex storage and pass to the run as lightweight `pipelex-storage://` URIs. This removes `buildDocumentInput` and `DocumentInput` from `src/lib/fileEncoding.ts` (pre-flight size and MIME validation remains intact).
- **Improved Polling Status UI**: Refactored the `useRun` hook and `<RunStatus>` component to replace the generic `degraded` boolean with a descriptive `health` state (`"reconnecting"` or `"retrying"`), providing cause-specific copy during transient network blips or server reconnects.
- **Development Port**: Changed the default local development and Playwright testing port from `3000` to `4100` (`package.json`, `README.md`, `playwright.config.ts`).
- **Dependencies**: Bumped `@pipelex/sdk` from `0.3.1` to `^0.5.1` (through `0.4.0` and `0.5.0`). `0.4.0`'s breaking changes are scoped to the `/v1/build/*` and tools routes this repo doesn't call; `0.5.0` delivered the typed `tokens_usages` and `prepareInputs` upload surface the two features above build on.
- **Testing**: Updated action-layer tests to use `toMatchObject` instead of `toEqual` to accommodate the new `usage` sibling property in run outcomes.

### Security

- **SDK Dependency Patch**: The final `0.5.1` hop inherits a patch for a transitive **dev** dependency (`brace-expansion`, CVE-2026-13149) in the SDK's own lockfile. That dependency is never shipped in the SDK's runtime surface, so no code changes were required here.

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
