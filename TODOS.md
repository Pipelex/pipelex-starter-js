# K2 adoption — implementation plan

Tracker for `wip/adopt-form/design.md` (read it first; decisions A–E and the kernel facts there govern everything below). Work lands on `feature/Adopt-form`, PR into `dev`. This file is a **local working tracker — never commit it** (it would ship to template consumers); delete it at close-out. `wip/` is already gitignored, so the design doc and the integration log never ship either.

## Standing rules (apply to every phase)

- **Log as you go.** Every phase appends to `wip/adopt-form/integration-log.md` following its entry discipline (Dependency / Config / Command / Decision / Trap / Upstream), written as generalizable adoption material, not repo diary. A phase's checkbox is not done until its log entries are written — logging retroactively at the end loses the symptoms and the disambiguating evidence, which are the whole point.
- **`make all` after every code change**; `make format` (never hand-edits) if format-check fails.
- **After editing anything under `methods/` or `scripts/lib/generate.mts`'s output, run `npm run codegen`** and commit the regenerated tree in the same commit.
- **Anything better fixed upstream gets an `Upstream` log entry** and, if we work around it locally, a `wip/inbox/` filing at the workspace root (`../wip/inbox/YYYY-MM-DD-<target>-<slug>.md`). Louis has offered to take upstream changes in `pipelex-sdk-js` / `mthds-form` — prefer that over local workarounds when the fix is small and unblocks this milestone; otherwise work around, file, and note the expiry.
- **One commit per phase** (roughly), with the phase's regenerated artifacts riding the same commit as the change that caused them.

## Phase 0 — foundation (styling lane, verified before any form logic exists) — **DONE**

- [x] Install the kernel and the animate plugin: `npm install @pipelex/mthds-form` (npm has `0.2.0` = latest, verified) and `npm install -D tailwindcss-animate`.
- [x] `tailwind.config.ts` (Decision B):
  - [x] Add `"./node_modules/@pipelex/mthds-form/dist/**/*.js"` to `content` — the kernel's classes live in the package bundle, outside both current globs.
  - [x] Mirror the token mapping from `mthds-form/tailwind.config.cjs` (the executable copy of the token contract) into `theme.extend`: the `colors` block (`border`, `input`, `ring`, `background`, `foreground`, `primary`, `secondary`, `destructive`, `muted`, `accent`, `popover`, `card` — each `hsl(var(--…))`, the paired ones with `DEFAULT`/`foreground`) and the `borderRadius` block (`lg`/`md`/`sm` from `--radius`).
  - [x] Add `tailwindcss-animate` to `plugins` (the select popover's enter/exit utilities need it).
  - [x] Do **not** copy `darkMode: ['class']` — this app never sets a dark class; log as a Decision (a host with a dark-mode toggle would need it plus dark token values).
- [x] Import `@pipelex/mthds-form/theme.css` in `src/app/layout.tsx` beside `globals.css` (variables only, no preflight — that is what makes it safe in the compile lane). Imported **before** `globals.css` so a host-level token override wins on ordering.
- [x] **Prove the lane before building on it** — the purge failure mode is silent:
  - [x] Scratch-render (`text` + `prose` + `document`) eyeballed styled under `make dev` — humanized labels, OPTIONAL badge, dashed dropzone, content-sized textarea all correct.
  - [x] Deterministic check run: 1246 lines without the glob → 2005 with it, 759 added lines carrying the kernel-unique utilities. Commands logged.
  - [x] Delete the scratch render.
- [x] `make all` clean.
- [x] Log entries written: Dependency ×2, Config ×2, the purge-proof Command, the scratch-render Command, the darkMode Decision, one pre-warned Trap, one Upstream (README arg order, filed to `../wip/inbox/2026-08-23-mthds-form-readme-arg-order.md`).

## Phase 1 — the contracts artifact (Decision A) — **DONE**

- [x] Extend `scripts/lib/generate.mts`: per method, after the codegen self-checks pass, call the SDK validate surface and write a `contracts.ts` into `src/generated/<method>/` via the existing `writeIfChanged`.
  - [x] **Decided: `validateFiles`.** Not ergonomics — the server 422s a length-mismatched `mthds_sources`, and hand-building the parallel arrays is a latent bug that surfaces at the first two-bundle method. One-line `{content, uri: source}` rename at the call site; filed upstream as a widening request.
  - [x] An `is_valid: false` verdict fails the method exactly like a failed codegen. Placed **last** in the per-method sequence so any failure leaves the tree untouched rather than half-updated.
  - [x] Deterministic emit (`renderContracts` in `shared.mts`, shared by all three scripts). Regeneration over unchanged contracts confirmed a true no-op.
  - [x] Typed against the kernel's mirror via a type-only import.
- [x] **Drift machinery: the sidecar's `derived` map** — `SourcesSidecar.derived`, written by `generate.mts` from the content it wrote, compared by `compareSidecar` (which replaced `compareSources`: one read, one unreadable-message, both halves in one pass). Expected set is the `DERIVED_ARTIFACTS` constant, never the sidecar's own keys. Upstream filing for the generic helper: `../wip/inbox/2026-08-23-pipelex-sdk-js-derived-artifact-stamping.md`.
- [x] **`codegen:verify` re-fetches** `/v1/validate` per method and compares the rendered bytes. Verified live: `✓ … crate <fp> matches the engine, contracts.ts matches /v1/validate`.
- [x] Machinery tolerance, all covered by tests:
  - [x] `writeTree`'s orphan cleanup keeps `contracts.ts` (written before the pass, deliberately).
  - [x] `checkMethod` over a **real** lock + real stamp: current with contracts present, drift on hand-edit / deletion / unrecorded.
  - [x] The sidecar `derived` comparison: hand-edited · deleted · unrecorded · retired · CRLF-invariant.
- [x] `make typecheck` clean with the type-only kernel import.
- [x] `npm run codegen` run against **prod**; three trees regenerated with `contracts.ts` + extended sidecars.
- [x] Gates: `make all` clean, one keyed `npm run codegen:verify` run green.
- [x] Log entries written: 5 Decisions, 2 Traps (the unstamped-`.ts` orphan rule; the exported-shell-var override), 2 Configs, 2 Upstreams (both filed).

## ★ Checkpoint 1 — foundation + contracts landed — **DONE**

- [x] Updated `wip/adopt-form/design.md` with a "Checkpoint 1" section: A and B confirmed unamended, the drift-machinery decision recorded with the two load-bearing shapes inside it, landed SHAs, "no deviations reach the later phases", and a concrete "what Phase 2 inherits".
- [x] Mirrored the durable facts to `../wip/devx/input-form-roadmap.md` — a "K2 in `pipelex-starter-js`" section carrying the SHAs, the three decisions that generalize, and the three upstream filings.
- [x] Re-read the Phase 0–1 log entries against the generalization rule; each Decision names its disambiguator, each Trap its observed symptom, and no entry names a repo path without saying what that file is in adoption terms.

---

## → RESUME HERE (cold start): Phase 3

**Read first, in this order:** `wip/adopt-form/design.md` (Decision E governs Phase 3), then `wip/adopt-form/integration-log.md` — its entry discipline at the top, and its Phase 2 entries, which carry the patterns Phase 3 repeats. `CLAUDE.md` is unchanged so far; Phase 4 updates it.

**Branch state:** `feature/Adopt-form`, on top of `32edc66 plan` — `2239824` (Phase 0), `5474235` (Phase 1), `592f0ec` (Checkpoint 1), plus Phase 2. No PR is open yet; the PR is Checkpoint 2's last item.

**What already exists that Phase 3 builds on:**

- `@pipelex/mthds-form@0.2.0`, styling lane proven, `PIPE_IO_CONTRACTS` committed for all three methods. `summarize_pdf.summarize_pdf` has one required input, `document`.
- `src/lib/runInputs.ts` — `requireContract` + `gateRunInputs`. The PDF action reshapes onto exactly the same gate; nothing new is needed there.
- `src/hooks/useRunInputs.ts` and `src/components/RunInputsForm.tsx`. `RunInputsForm` already threads a `FieldEnv` through (`env` prop, merged so the form's `disabled` always wins) — that is the seam `onDropFile` plugs into, no component change required.
- `src/lib/clientFile.ts`'s `fileToDataUrl` is the host upload handler; write the result back with `setValueAtPath(values, id.split("."), { url, filename })` via the hook's `setValues`.

**Gotchas already paid for, don't rediscover:**

- Query kernel-rendered controls by **role plus name** (`getByRole("textbox", { name: "Text" })`), never `getByLabelText` — humanized labels are short and collide with page chrome under Playwright/Testing Library strict mode.
- The shell may export `PIPELEX_BASE_URL` / `PIPELEX_API_KEY`, which **silently beat `.env.local`**. Run keyed scripts as `env -u PIPELEX_BASE_URL -u PIPELEX_API_KEY npm run codegen`.
- `make test-e2e` prompts before spending; `npx playwright test <spec>` runs one spec directly, and `playwright.config.ts` reuses an existing dev server on port 4100.
- `src/generated/` is out of Prettier's and ESLint's reach on purpose — never hand-edit anything there, `contracts.ts` included.

## Phase 2 — the text path (Decisions C + D) — **DONE**

- [x] `src/components/RunInputsForm.tsx` (`"use client"`), the one shared kernel composition — **presentational only**: props are `{ fields, values, onValuesChange, disabled, env? }` (deviation: `fields`, not `contract`, so the derivation happens once in the hook), `FieldRenderer` per field, empty optionals folded behind `OptionalToggle`, all wrapped in `FieldPresentationProvider presentation="app"`.
- [x] **Readiness decision: a companion hook, `src/hooks/useRunInputs.ts`** — owns the value state, derives `fields` once, exposes `ready` (`computeReadiness`) and `toData()` (`rjsfDataFromRunValues`, built on submit rather than per keystroke). Chosen over an `onReadinessChange` callback (needs an effect, classic loop shape) and over parent-derives-everything (correct but repeated per form). Logged with what would flip it.
- [x] Swapped `EntityForm` and `ImageForm` onto it; sample text/prompt survive as the hook's seeded initial values. Run gates on `ready`, not `!text.trim()`.
- [x] Reshaped both action trios per Decision D: the argument is now the schema-shaped data dict, `emptyInputError` and the trim guards are gone, and `gateRunInputs` runs the four kernel steps server-side.
- [x] **Shared helper decided: `src/lib/runInputs.ts`** — `gateRunInputs(contract, data)` returning `{ok:true,inputs} | {ok:false,error}`, plus `requireContract` (throws at module load; `getPipeIOContract` returning `undefined` renders as an empty form with a live Run button). Pure module, importable from either side. Covered by `src/lib/runInputs.test.ts`.
- [x] Invalid verdict → `bad_request` `PipelineError`: `missingInputs` when the scan names something, otherwise `errors` through `describeValidationError` with a local 6-key English translator typed on `ValidationMessageKey`.
- [x] Rewrote `EntityForm.test.tsx` and `ImageForm.test.tsx` against kernel-rendered controls (labels are now `humanizeFieldName` of the contract's input names — "Text", "Image prompt"). Two new EntityForm tests pin the contract-derived label and the contract-driven Run gating. No happy-dom shims needed (plain text controls).
- [x] `useRun`, `ModeToggle`, `RunStatus`, `ErrorDisplay`, results and `CostReport` untouched.
- [x] `make all` clean.
- [x] **Live verification of the wire-shape change** (bare value → `{concept, content}` envelope), which unit tests cannot reach: `e2e/extract.spec.ts` (1 passed) and `e2e/generate-image.spec.ts` (2 passed, durable + blocking cap) against the hosted API. Their label selectors were updated here rather than deferred to Phase 4 — a knowingly-broken spec must not straddle two phases. `summarize-pdf.spec.ts` still waits on Phase 3.
- [x] Log entries written: 5 Decisions, 2 Traps (label churn + the strict-mode label collision; whitespace-only input), 1 Upstream (`isFilled` and blank strings, filed at `../wip/inbox/2026-08-23-mthds-form-isfilled-blank-string.md`), 1 Command (the live e2e proof).

## Phase 3 — the file path (Decision E)

- [ ] Swap `PdfForm` onto `RunInputsForm`: the contract's PDF input renders as `DocumentField`; supply the host seam via `FieldEnv` — `onDropFile(id, file)` → `fileToDataUrl(file)` → write a `FileValue` (`{ url: dataUrl, filename }`) back at the field's dotted path with `setValueAtPath`. Keep the "Use sample PDF" affordance (it now writes a `FileValue` for `public/sample-invoice.pdf` through the same path).
- [ ] **Run the Decision E probe and log it prominently:** does `client.prepareInputs()` accept the kernel's enveloped wire values, or only the bare simplified shape? If bare: apply the kernel's deflate utilities (`deflateAllInputs`) at the gate — still kernel-powered, no hand-written conversion — **and file an `Upstream` entry** (teaching `prepareInputs` to accept enveloped inputs in `pipelex-sdk-js` is the better home; Louis has offered to take it there). Record the probe's raw evidence (request shape sent, response/error received) in the log.
- [ ] Delete the duplicated hand guards: client `checkFile`/`inferPdfMime` (the kernel's `accept` on `DocumentField` takes over the client UX) and the server-side duplicates in the action's preflight. `validateDataUrl` stays **only** for what the kernel gate cannot express (the byte-size cap and server-side MIME re-check are the trust boundary — trivially bypassed client checks are not a gate); log the Decision drawing exactly that line, since "delete the duplicates, keep the single authoritative byte gate" is the generalizable rule.
- [ ] Reshape `runSummarizePdfPipeline.ts` onto the same Decision D gate as Phase 2.
- [ ] Rewrite `PdfForm.test.tsx` (keep real timers — its `FileReader` encoding needs them; durable poll completes on the first tick so `findBy` works).
- [ ] `make all` clean.
- [ ] Log entries written (the probe result, the `FileValue`/data-URL seam as the file-input pattern, the guard-deletion line, any dropzone/happy-dom Trap).

## Phase 4 — docs and gate

- [ ] `README.md`: Stack (add the kernel), How it works (form derived from the method's contract), File & image inputs, Swap in your own pipeline (the form now follows codegen automatically), the structure block (`RunInputsForm`, `contracts.ts` in the generated quartet→quintet).
- [ ] New `docs/input-form.md`: the two styling lanes and why this repo compiles, the token contract + `theme.css`, the contracts artifact and its drift story, the one-gate-two-call-sites pattern, the purge trap with the deterministic diff check, and the one-sentence "two validators coexist on purpose" note (kernel ajv gates inputs, generated zod narrows outputs — each guards one direction of the wire).
- [ ] `docs/codegen.md`: the contracts artifact (source endpoint, determinism, sidecar `derived` map, verify treatment).
- [ ] `CLAUDE.md`: project-structure block (new component, `contracts.ts`), the generated-types section (fifth artifact), the integration-pattern section (actions take schema-shaped data; the gate), anti-patterns if any new one earned its place (e.g. "no hand-rolled input markup for method inputs — derive from the contract").
- [ ] `CHANGELOG.md` under `[Unreleased]` (no version bump — no artifact published).
- [ ] Update the e2e specs for the new labels/controls: `extract.spec.ts` (`getByLabel("Input text")` → the humanized contract label), `generate-image.spec.ts` (`Image prompt`), `summarize-pdf.spec.ts` (sample-PDF flow through the dropzone), and `error-display.spec.ts` (offline, also fills "Input text").
- [ ] Gates: `make all` clean, then `make test-e2e` — **mandatory this phase** (actions and `src/lib` are on the SDK call path; unit tests mock the SDK). Needs the key in `.env.local`; runs against the hosted API per the standing memory (a local stack can't serve the durable poll path).
- [ ] Log entries written (e2e selector churn as a pre-warned Trap; anything the live runs surfaced).

## ★ Checkpoint 2 — close

- [ ] **K2 gate check:** the three demo forms render entirely from kernel imports over the committed contracts — the only method-specific input knowledge left in `src/` is the generated artifact. Grep for leftovers: no hand-rolled `<textarea>`/`<input>`/file-pick markup for method inputs in `src/components/`, no per-action hand validation beyond the shared gate + `validateDataUrl`'s byte cap.
- [ ] Sweep the integration log once end-to-end: every Decision has its disambiguator, every Trap its symptom, every Upstream either filed to `../wip/inbox/` or resolved upstream. This is the deliverable the future skill is built from.
- [ ] Update `wip/adopt-form/design.md` (status → done, final SHAs); record the K2 closure and durable facts at `../wip/devx/input-form-roadmap.md`.
- [ ] Delete this `TODOS.md` (local tracker, must not ship in the template); confirm nothing under `wip/` is staged.
- [ ] PR `feature/Adopt-form` → `dev`.

## Upstream SDK watchlist (running list — add as found, resolve via `Upstream` log entries)

- [ ] **`prepareInputs` vs enveloped wire values** — the Phase 3 probe decides; if it only takes the bare shape, the fix belongs in `pipelex-sdk-js`.
- [ ] **Derived-artifact stamping** — the sidecar `derived` map is starter-local; a generic stamp/check helper for host-emitted files riding a generated tree belongs beside `runCodegenCheck` in `@pipelex/sdk`.
- [ ] **`MthdsFileItem` vs `MthdsFile`** — if the codegen and validate file shapes differ gratuitously, unify upstream.
- [ ] _(standing, already roadmapped)_ D3/D4 replace the validate-derived contracts with the wire input-form descriptor via `views: ["input_form"]` at this same codegen seam — nothing here should make that swap harder than "one artifact changes".
