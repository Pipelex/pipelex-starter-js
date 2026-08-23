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

## → RESUME HERE (cold start): Phase 4

**Read first, in this order:** `wip/adopt-form/design.md`, then `wip/adopt-form/integration-log.md` end to end — Phase 4's docs are written from those entries. `CLAUDE.md` is still unchanged; Phase 4 updates it.

**Branch state:** `feature/Adopt-form`, on top of `32edc66 plan` — `2239824` (Phase 0), `5474235` (Phase 1), `592f0ec` (Checkpoint 1), `6b05805` (Phase 2), plus Phase 3. No PR is open yet; the PR is Checkpoint 2's last item.

**What Phase 4 documents (all three forms are already swapped):**

- `src/components/RunInputsForm.tsx` (the kernel composition), `src/hooks/useRunInputs.ts` (values + readiness + wire shape), `src/lib/runInputs.ts` (`requireContract` + `gateRunInputs`), and the per-method `contracts.ts` in the generated tree.
- The action trios take the schema-shaped data dict; inputs travel as the runtime's `{concept, content}` envelope. The PDF action adds a host byte gate after the shape gate.
- All four e2e specs already carry the new selectors (Phases 2 and 3 updated them as the forms changed), so Phase 4's e2e item is a full `make test-e2e` run, not a rewrite.

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

## Phase 3 — the file path (Decision E) — **DONE**

- [x] **Decision E probe run first, live against the hosted API**, and recorded with its raw evidence in the log: `prepareInputs` accepts the kernel's enveloped `{concept, content}` value, finds and uploads the data URL inside `content.url`, and **preserves the envelope on output** (the `concept` annotation and the sibling `filename` both ride through). No deflate step, no upstream filing — the gate's payload goes straight to `prepareInputs`.
- [x] Swapped `PdfForm` onto `RunInputsForm`: the contract's document input renders as `DocumentField`, and the host seam is `env.onDropFile(id, file)` → `fileToDataUrl` → `setValueAtPath(values, id.split("."), {url, filename})`. "Use sample PDF" kept, routed through the same handler.
- [x] The kernel's `uploadingIds` disables the control while a file encodes, which makes the old stale-`FileReader` race unreachable — `selectionTokenRef` deleted rather than ported. The sample shortcut, which bypasses the dropzone, is disabled on the same condition.
- [x] Guard deletions, with the line drawn in the log: client type check **deleted** (a bypassable check is not a gate; the kernel's `accept` turns out to be a display hint, not a filter), client size check **kept as an early exit** on the same exported constant (past the cap the payload cannot fit the Server Action body limit, so without it a large file yields an opaque transport failure), and the empty-MIME normalization **kept** — it looked like a duplicated type check but is an encoding fix for a real browser case, and deleting it would have broken those uploads.
- [x] Reshaped `runSummarizePdfPipeline.ts` onto the same Decision D gate, then a host byte gate over the **gated** inputs (`checkDocumentBytes`), which no-ops on a non-`data:` URL — the kernel's paste-a-URL affordance is a capability gained for free, pinned by a test.
- [x] Rewrote `PdfForm.test.tsx` (real timers). The kernel's file control carries no accessible label, so the input is reached by `input[type="file"]` — the same element a real drop delivers to. New tests: the contract-derived label, the oversize early exit, the empty-MIME normalization.
- [x] `make all` clean.
- [x] **Live verification:** `e2e/summarize-pdf.spec.ts` green — the whole chain (dropzone seam → encode → shape gate → byte gate → enveloped `prepareInputs` upload → durable run → rendered summary). The spec needed no selector change.
- [x] Log entries written: 4 Decisions (the probe result, the file seam, the guard-deletion line, the two-gate ordering), 2 Traps (no accessible label on the file control; a hydration warning that turned out to be Playwright's screenshot caret-hiding, with the one-minute check that settles it), 1 Command.

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
