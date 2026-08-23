# Changelog

## [Unreleased]

### Added

- **The input forms are rendered from each method's own contract.** The template adopts [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form): `npm run codegen` now also asks `POST /v1/validate` for a method's pipe IO contracts and commits them as `src/generated/<method>/contracts.ts`, and the three demo forms derive every field, label, control and required-ness from that artifact. Add an input to a `.mthds` bundle, re-run codegen, and it appears in the form with no component edit. `src/components/RunInputsForm.tsx` is the single kernel composition — it decides foldability once, at mount, rather than from the live value, so clearing a seeded optional field cannot make its own control vanish mid-edit — `src/hooks/useRunInputs.ts` owns form values and readiness (the companion to `useRun`, which owns the run), and `docs/input-form.md` is the reference.
- **`src/lib/runInputs.ts` — the server-side input gate, sharing the kernel's rules with the browser.** `gateRunInputs` combines the per-input schemas, repairs the data, validates it, re-applies the emptiness rule by calling `computeReadiness`'s own `mustBeFilled` + `fieldFilled` over the same derived fields (ajv's `required` only asserts key presence, so an empty string would otherwise pass), and builds the `{concept, content}` payload. The browser runs `computeReadiness` for the Run button; the Server Action is the trust boundary, because a Server Action is a public endpoint, and stays a strict superset of what the button enforces. The two are held to that by a test that runs both sides over one table of inputs, rather than by a comment asserting they match. `requireContract` throws when a contract lookup misses, since an undefined contract otherwise renders as an empty form with a live Run button. Two properties of the gate are load-bearing enough to be worth stating: the combined schema is memoized per contract in a `WeakMap`, because the kernel validates through a module-level ajv singleton whose cache is keyed on schema object _identity_ and never evicted — a fresh-but-equal object per call would retain another compiled validator on every request to a public endpoint; and the payload is normalized to an object before anything indexes it, because the kernel reads `preparedData[varName]` without first checking the value is indexable, so a `null` body would throw past the classifier and reach the browser as an opaque Next digest.
- **A fourth example — "Complex inputs" (`methods/complex-form/`) — whose method declares more than a text box.** It takes the required text, an optional structured input (a concept with an enum child and a free-text one) and a plural text input, so the form derives a nested card with its own optional-folding, a segmented enum, and a repeater with add/remove. The example exists for what its code does _not_ contain: `src/components/ComplexForm.tsx` is no longer than `EntityForm.tsx` and names no input, no label and no control. It is also the first committed method to reach the structured and plural branches of the shared gate, so its form states join the readiness-versus-gate table in `src/lib/runInputs.test.ts` — which is the check that catches an input shape the browser accepts and the run then rejects.

  **Two input shapes are avoided deliberately, and both are upstream kernel bugs** (filed, and documented in `docs/input-form.md`): a `native.Number` input renders but can never run, because its value is never wrapped into the `NumberContent` envelope its own contract declares; and a **required** field inside an **optional** structured input is rejected on a form nobody opened, because the kernel materializes an empty shell that ajv then judges. The second is why every field of `ExtractionFocus` is optional — an expressiveness loss the bundle comments on rather than hides.

- **A drift gate for artifacts the codegen lock cannot sign.** `contracts.ts` carries no codegen stamp on purpose — the SDK's orphan rule deletes stamped files the lock does not track — so its SHA-256 rides in `sources.json`'s new `derived` map, written by the generator from the content it wrote and compared by `npm run codegen:check`. `npm run codegen:verify` re-fetches `/v1/validate` and compares the rendered bytes, since a crate fingerprint says nothing about another route's response.

### Changed

- **Breaking: the Server Actions take the method's schema-shaped input dict.** `runExtractEntitiesBlocking("some text")` becomes `runExtractEntitiesBlocking({ text: { text: "some text" } })`, and the PDF trio takes `{ document: { url, filename } }` instead of `{ dataUrl, filename }`. Inputs consequently travel to the API in the runtime's explicit `{concept, content}` envelope. Verified live in both execution modes, and against `prepareInputs`, which accepts the envelope as readily as a bare value and preserves it on output.
- **Breaking: the hand-written per-input guards are deleted, not kept as belt-and-braces.** The empty-text checks in each action and the client-side file type check in the PDF form are gone; the kernel gate and the server's MIME check replace them. Two survivors are deliberate and documented: the client-side size check stays as an early exit on the same exported constant (past the cap the payload cannot fit the Server Action body limit), and the empty-MIME re-wrap stays because it is an encoding fix for browsers that report no `file.type` for a valid PDF, not a validation.
- **The PDF example uses the kernel's dropzone**, including its "paste a URL instead" affordance — so a document input can now be an `https://` or `pipelex-storage://` reference with no upload at all. The old staleness token for a second file picked mid-encode is gone: the kernel disables the dropzone while its id is uploading, which makes that race unreachable — and the form disables itself as a whole while any input is still resolving, which closes the "paste a URL instead" door the kernel's per-field flag does not reach. That form-wide flag is what a file input needs rather than the bare run state: the kernel threads its uploading set to the dropzone alone, so a URL pasted during the sample PDF's fetch would otherwise make the form ready, and the durable run it started would be abandoned client-side when the fetch landed — while that run went on executing and billing. Reported upstream as well, since form-wide disabling is coarser than the per-field flag ought to need.
- **A pasted storage URL can be previewed.** The kernel previews a file it took through its own dropzone from an object URL it made; for any other value it asks the host to resolve `value.url` and spins until that answers. A `pipelex-storage://…/x.pdf` pasted through the control's own "paste a URL instead" reaches that path, so with no resolver its Preview spun forever. `PdfForm` now supplies one that hands the URI straight back, letting the kernel's "Preview unavailable" fallback render. Two related gaps are upstream, not fixed here: a file the user replaces still previews as the earlier one, and the sample PDF cannot be previewed at all (the kernel's extension sniff runs against `"<filename> <url>"`, where a filename's extension can never match).
- **The file gate checks the scheme before the bytes, against a closed set, and is keyed on the input's value rather than its name.** `checkFileInputs` (`src/lib/fileEncoding.ts`, replacing the action-local `checkDocumentBytes`) accepts `data:`, `https://` and `pipelex-storage://` and refuses everything else. The SDK's `prepareInputs` resolves any string it does not recognise as a **local filesystem path** — it reads that path and uploads it — so a gate that treats "not a data URL" as "nothing to check" turns a public Server Action into an arbitrary server-side file read whose contents come back summarized to the caller. Keying on the value rather than on the literal name `document` also stops the whole gate silently lapsing the day a bundle renames that input. It reads `content.url`, one level down, and **refuses** any input that hides a file position deeper — inside a list, or nested in a structured concept — rather than passing it through unverified, because `prepareInputs` walks the method's whole signature and would resolve those. That refusal is asked unconditionally rather than only when `content.url` is missing: `url` is a key the caller supplies, so guarding on its absence would let a benign outer URL pasted beside the nested one switch the check off. The `url` key itself is excluded from the walk only when it holds the string the scheme check actually reads — a non-string there is a subtree the gate never inspects, and a name is not a reason to trust one. It also reads the SDK's compact form — a bare source string where `{url}` would go, which `prepareInputs` resolves identically — so the verdict rests on this gate's own walk rather than on the schema in front of it happening to refuse a string.
- **Tailwind gains the form kernel's token contract.** `tailwind.config.ts` adds the package bundle to `content` (its classes ship compiled, outside every source glob), mirrors the shadcn colour and radius tokens, and adds `tailwindcss-animate`; `@pipelex/mthds-form/theme.css` supplies stock token values, imported before `globals.css` so a host override wins. Restyling the forms is now a matter of overriding CSS variables.
- **Regeneration no longer needs the dev gateway.** `POST /v1/codegen` is served on `api.pipelex.com`, so `npm run codegen` runs against the default hosted URL with nothing but `PIPELEX_API_KEY`. The v0.4.0 caveat that pointed `PIPELEX_BASE_URL` at `api-dev.pipelex.com` is removed from the README, the environment table, `.env.example`, `AGENTS.md`, the docs, and the codegen script's own error message, which used to steer readers at the dev origin.

### Fixed

- **A PDF between roughly 3.2 MB and the advertised 8 MB cap crashed the Server Action instead of running.** `validateDataUrl`'s base64 shape check was a repeated-group regex, and V8 walks one with a recursive backtracking stack: past about 4.47 M payload characters it threw `RangeError: Maximum call stack size exceeded` rather than returning a verdict, surfacing as an opaque transport failure. That also made `file_too_large` unreachable, since anything large enough to trip it blew the stack first. The check is now a flat alternation plus an explicit length rule — the same predicate, linear — and size is tested before shape. Pre-existing, not introduced by the form adoption.

- **A rejected file left its error on screen after the input was fixed.** "File too large" is set by the drop handler, but the kernel's "paste a URL instead" writes straight through `onValuesChange` without touching it — so the alert outlived the value that caused it. The setter now clears the error, which is where a rejection tied to a value belongs.

- **An optional input the user filled disappeared when the section was collapsed.** Foldability is decided at mount, deliberately, so that clearing a seeded field cannot unmount the control mid-edit. But the decision was never revisited, so a field filled while the section was open still counted as foldable: collapsing hid it, the toggle went on describing it as one of the empty inputs it was offering to reveal, and its value went out on the run anyway. The set is now re-decided on the way back to collapsed — the one moment where nothing is being edited, so the protection the freeze exists for is not weakened.

- **`npm run codegen` could write a permanently broken tree and exit 0.** Two ways, both silent. If the server ever returns an artifact named `contracts.ts`, the locally emitted one overwrote it, and `codegen:check` then reported `hand-edited` forever with a remedy that reproduced the same tree — refused up front now, like a changed `lock_filename`. And if the SDK's orphan rule ever stopped exempting unstamped files, the orphan pass would delete `contracts.ts` while the sidecar still recorded its hash — the writer now fails loudly instead, which is what the ordering was always supposed to buy.

### Known gap

- **A whitespace-only required input starts a run.** The old per-input guards trimmed; the kernel's emptiness rule does not, so `"   "` reads as filled on both sides. The browser enables Run and the server gate agrees — which is why the parity test cannot catch it: the two sides agree, and they are both wrong in the same direction. Not fixed here on purpose. Re-adding a trim host-side would restore a local definition of a rule the kernel owns, which is the divergence this whole change removes; the fix belongs in `@pipelex/mthds-form` and is filed there.

## [v0.4.0] - 2026-08-21

### Added

- **Type generation from the `.mthds` bundles.** `npm run codegen` (`make codegen`) sends every method under `methods/` to the API's `/v1/codegen` route and writes what comes back, byte-for-byte, to `src/generated/<method>/`: zod schemas with their inferred TypeScript types, binders over those schemas, and a `codegen.lock`. The trees are committed, so `git clone && make all` passes without an API key. This replaces the hand-written output shapes the template used to keep in `src/types/`, so the types can no longer drift from the bundles that declare them. One caveat while it lasts: `/v1/codegen` is served by `api-dev.pipelex.com` and `api.pipelex.com` still answers `403` pending its deploy, so regeneration needs `PIPELEX_BASE_URL` pointed at api-dev today.
- **Two staleness gates over the generated trees.** `npm run codegen:check` (`make codegen-check`) is offline and needs no key: it verifies each tree against its own lock and compares a `sources.json` sidecar of source hashes against the `.mthds` files on disk, so editing a bundle without regenerating fails the build instead of shipping types that quietly lie. It is wired into `make check`. `npm run codegen:verify` (`make codegen-verify`) asks the question the offline check cannot — whether the committed tree still comes from the crate the method resolves to today — by comparing live `crate_fingerprint`s against the locks. It needs a key, writes nothing, and stays out of `make all`.
- **Security guards on the codegen scripts.** A plaintext `http:` guard refuses a non-loopback `PIPELEX_BASE_URL`, since the scripts send the API key as a bearer token and write server-supplied TypeScript into the repo. A containment guard checks every path the response names before anything is written, refusing the method whole if one resolves outside its tree.
- **`import "server-only"` in `src/lib/wireOutput.ts`**, so calling a generated narrower from a `"use client"` component fails the Next build instead of silently shipping zod plus every generated schema to the browser.
- **`tsconfig.scripts.json`**, which type-checks `scripts/` under `make typecheck` the way `tsconfig.e2e.json` covers the Playwright specs. The scripts are native-Node TypeScript, so the template gains no `tsx` or `ts-node` dependency.
- **A `docs/` directory, `AGENTS.md`, and a removal checklist.** `docs/codegen.md` is the design reference for the generated-types workflow and `docs/adopt-in-an-existing-project.md` is an executable checklist for transplanting the pattern into an existing app. `AGENTS.md` gives agents other than Claude Code the rules that matter. The README's new "Remove an example" section lists the full vertical slice a demo owns, so stripping one doesn't have to be assembled from compile errors.

### Changed

- **Breaking: output field names are wire-native snake_case.** `DocumentSummary` is now `{ title, doc_type, key_points }` and the image envelope carries `public_url`, `mime_type`, and `source_prompt`. The names travel unchanged from the bundle to the components, because a hand-maintained camelCase mirror is exactly the duplication this release removes.
- **Breaking: `src/lib/runOutput.ts` is gone**, replaced by `src/lib/wireOutput.ts`. The narrowers in `src/types/` are now thin adapters over the generated binders rather than hand-written shape-checkers; `findOutputContent`'s predicate search is subsumed by the generated schema's own `parse`, which rejects arrays, primitives, and `null` with a message naming the failing field.
- **A schema-guided wire-null normalization step, and it is a workaround with an expiry.** The projection emits a non-required concept field as `.optional()`, which in zod rejects `null`, while the runtime serializes an unset optional field as an explicit `null` — verified against a live image run. `dropWireNulls(value, schema)` strips a null-valued key only where the schema says a `null` there means absence, leaving a `null` inside a `z.record()`, a `.nullable()` field or a `.default()` field exactly as the pipeline sent it. It is deletable once the emitter emits `.nullish()`, and is reported upstream.
- **Bumped `@pipelex/sdk` to `^0.13.0`** (the declared range was `^0.5.1`) and added `zod` as a runtime dependency, since the generated binders validate run output inside Server Actions at request time. No migration was needed here: the intervening breaking changes are on the methods-catalog surface this template never calls, while `0.12.0` and `0.13.0` added the crate routes and the offline drift check the new scripts are built on.
- **`src/generated/` is excluded from Prettier and ESLint, deliberately.** The emitter targets Prettier's defaults while this repo prints at 100 columns, so formatting those files would rewrite their bytes and break every stamp. TypeScript still covers them in full.
- **The codegen scripts are thin CLI entries over a tested `scripts/lib/`.** All three ran their logic at module top level, so importing one executed a whole run and the orchestration could not be tested — including `writeTree`, the only code in the template that deletes files. Each module now owns its whole contract, exit code included.
- **The template assumes the hosted Pipelex API throughout — docs, error copy, comments, and specs.** Self-hosting is no longer offered as a supported path, and the localhost special case is gone: when a request doesn't reach a working Pipelex API, the error now says what the configured URL fails to provide and steers to verifying `PIPELEX_BASE_URL`.
- **The shared-helper tests no longer import any example's adapter.** `blockingRun.test.ts` and `durableRun.test.ts` now use inline fixture narrowers, so removing a demo example never touches the shared layer's tests.

### Fixed

- **Breaking: `parseGeneratedImage` gates a `data:` URL's media type against an allow-list, not just its scheme.** The validated URL feeds `<ImageResult>`'s download link as well as its `<img>`, so a saved payload runs on a `file://` origin once opened — which left `data:image/svg+xml` open as an active-content sink under a media type that passes for an image. Only `image/png`, `image/jpeg`, and `image/webp` are accepted, with a message of its own for a refused SVG. `http:` and `https:` outputs are unchanged, which is every image this template actually receives.
- **The codegen gate could be silently wrong in several ways, each now producing a loud, correct verdict.** Symlinks and special files were invisible to the walk and are now refused by name; lossy UTF-8 decoding let a corrupted artifact hash to its locked value and is now fatal; an empty `methods/` exited before orphan detection ever ran; a tree differing from its method's name in case only now gets a rename remedy rather than a delete one; and a stray `.DS_Store` no longer fails the check with a remedy naming a directory that does not exist.
- **`npm run codegen` deleted hand-written files parked in a generated tree.** Cleanup decided what it could remove with a filename test while the SDK's orphan rule also requires a codegen stamp, so a sibling module the generated header invites consumers to write was reported healthy by the check and destroyed by the next regeneration. Cleanup now defers to the SDK's own verdict, so the two agree by construction.
- **`codegen:check` reported every method stale on a Windows checkout.** Source hashes were taken over raw bytes, so a CRLF checkout disagreed with every committed hash. `hashSource` now normalizes line endings before hashing, the same normalization the SDK already applies to artifacts and locks. Nothing changes on an LF checkout.
- **A renamed lock file could have left the offline check validating the obsolete one.** The writer took whatever `lock_filename` the response named while the check has always opened `codegen.lock`; it now refuses any other name and writes nothing for that method.
- **`dropWireNulls` is depth-capped**, so a self-referential concept can no longer overflow the stack inside a Server Action. Past the cap the value passes through untouched and the generated schema still owns the verdict.
- **An empty-string `public_url` failed an image run that had a perfectly good `url`.** `public_url ?? url` let `""` win over the real URL; both that and `<ImageResult>`'s `alt` text now use `||`.
- **`make use-npm` restored a stale version instead of the current one.** It ran `npm install @pipelex/sdk`, which re-resolves the range already declared rather than fetching the current release — a silent downgrade, since a caret range never crosses a minor pre-1.0. It now installs `@pipelex/sdk@latest` and echoes the version it restored.
- **The README's "File & image inputs" section documented code deleted in v0.3.0.** It now matches the actual flow: validate the data URL server-side, hand it to `client.prepareInputs()`, and run against the `pipelex-storage://` reference it returns.

### Removed

- **Internal planning notes (`wip/`) are untracked again**, as v0.1.1 already decided before open-sourcing. The codegen design rationale they held now lives in `docs/codegen.md`.

### Security

- **Bumped `next` to `^16.3.1`** (was `^16.2.9`), clearing every high-severity advisory `npm audit --omit=dev` reported against this template's production tree. All of them came in through Next.js — Server Action denial of service, SSRF via rewrites and on custom servers, cache confusion, Image Optimization denial of service, disclosure of internal Server Function endpoints, a Turbopack middleware bypass — plus its pinned transitives `postcss`, `nanoid`, and `sharp`. `eslint-config-next` was raised alongside it to keep the linter in lockstep.
- **Bumped the `postcss` dev dependency to `^8.5.23`**, resolving arbitrary `.map` file disclosure and XSS through unescaped `</style>` in stringify output, so the full `npm audit` is clean with development dependencies included.

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
