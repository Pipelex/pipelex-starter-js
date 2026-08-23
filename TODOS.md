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

## Phase 1 — the contracts artifact (Decision A)

- [ ] Extend `scripts/lib/generate.mts`: per method, after the codegen self-checks pass, call the SDK validate surface and write a `contracts.ts` into `src/generated/<method>/` via the existing `writeIfChanged`.
  - [ ] **Decision to make and log:** `client.validateFiles(method.files, …)` vs `client.validate(contents, …, sources)`. `method.files` is `MthdsFileItem[]` (`{content, source}`); `validateFiles` takes `MthdsFile[]` — check shape compatibility in the installed SDK and pick the one that keeps per-file attribution in diagnostics. If the two file shapes differ gratuitously, that is an `Upstream` entry (unify in `pipelex-sdk-js`).
  - [ ] An `is_valid: false` verdict fails the method exactly like a failed codegen (print `validation_errors`, set `failed`, continue) — never write a contracts file from an invalid bundle.
  - [ ] Emit deterministically so regeneration over unchanged contracts is a byte-for-byte no-op: stable key order as returned, `JSON.stringify(…, null, 2)`, trailing newline, a starter-owned header comment stating the file is generated from `POST /v1/validate` and must not be hand-edited.
  - [ ] Type the literal against the kernel's mirror: `import type { PipeIOContracts } from "@pipelex/mthds-form";` + `export const PIPE_IO_CONTRACTS: PipeIOContracts = { … };`. This makes `tsc` a real gate: if the server's contract shape drifts from the kernel's mirror, `make typecheck` fails loudly. Type-only import, so `node --experimental-strip-types` never loads the package at script runtime.
- [ ] **Drift machinery decision (design A says decide here and record why).** Recommended: extend the starter-owned sidecar — add a `derived` map to `SourcesSidecar` in `scripts/lib/shared.mts` recording the SHA-256 of each starter-emitted artifact (`contracts.ts`), written by `generate.mts` and compared by `check.mts` beside `compareSources` (hand-edit or deletion → drift, exit 1, remedy "Run `npm run codegen`"). The lock cannot cover it (the lock hashes server-stamped artifacts only) and the existing `sources.json` staleness check already catches the edited-bundle case — the `derived` map closes the remaining hole (edited/deleted contracts with unchanged sources). Log the decision with this rationale; log as `Upstream` the nicer long-term shape (an SDK helper for stamping/checking host-emitted derived artifacts riding a generated tree — the stamp discipline already lives in `@pipelex/sdk`'s codegen-check).
- [ ] `codegen:verify` treatment: either re-fetch `validate` per method and compare the serialized contracts against the committed file, or explicitly exempt contracts from verify with a stated reason in `docs/codegen.md` (the crate fingerprint does not sign the contracts). Decide by cost: the verify script already holds a client and the closure, so the re-fetch is cheap — prefer it. Log the decision.
- [ ] Confirm the existing machinery tolerates the new file (each of these is a wrong-verdict class if broken — cover with tests in `scripts/lib/*.test.mts`, extending the existing suites):
  - [ ] `writeTree`'s orphan cleanup must not delete `contracts.ts` — it deletes only on `runCodegenCheck`'s `orphan` verdict, which requires a codegen _stamp_ the starter-owned file doesn't carry (same protection as the "sibling module" case). Test it.
  - [ ] `checkMethod` must not report `contracts.ts` as an orphan/drift against the lock (it feeds `runCodegenCheck` via `isStampableArtifactPath`, which passes `.ts` — verify the stamp rule keeps it healthy). Test it.
  - [ ] The new sidecar `derived` comparison: current / hand-edited / missing each produce the right verdict and remedy. Test it.
- [ ] `tsconfig.scripts.json` still typechecks (`make typecheck`) with the type-only kernel import — if module resolution balks, that's a Config entry with the fix.
- [ ] Run `npm run codegen` (needs `PIPELEX_API_KEY`); commit the three regenerated trees including `contracts.ts` and the extended sidecars.
- [ ] Gates: `make all` clean (which includes `codegen:check` over the new artifacts), plus one keyed `npm run codegen:verify` run.
- [ ] Log entries written (the two Decisions above, the emit-determinism Config, any shape surprise in `pipe_io_contracts` as Trap/Upstream).

## ★ Checkpoint 1 — foundation + contracts landed

- [ ] Update `wip/adopt-form/design.md`: decisions A/B confirmed or amended, the drift-machinery decision recorded, landed SHAs, deviations folded into the later phases. Verify it reads cold-start clean.
- [ ] Mirror the durable facts (SHAs, decisions) to the workspace roadmap `../wip/devx/input-form-roadmap.md` — this repo's `wip/` is untracked, the roadmap is the record that survives.
- [ ] Re-read the integration log's Phase 0–1 entries against its own generalization rule; fix any diary-speak now, while the context is fresh.

## Phase 2 — the text path (Decisions C + D)

- [ ] `src/components/RunInputsForm.tsx` (`"use client"`), the one shared kernel composition: props ≈ `{ contract, values, onValuesChange, disabled, env? }`; internals: `fieldsForContract(contract)` mapped over `FieldRenderer`, empty optionals folded behind `OptionalToggle`, readiness via `computeReadiness` surfaced to the parent (recommend an `onReadinessChange` callback or a readiness return from a small companion hook — decide, log the Decision and what would flip it), all wrapped in `FieldPresentationProvider presentation="app"` (humanized labels, no concept pill; strings stay the kernel's English defaults).
- [ ] Swap `EntityForm`: contract from `src/generated/extract-entities/contracts.ts` via `getPipeIOContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities")` — argument order is contracts, domain, pipe code; the domains are `extract_entities` / `generate_image` / `summarize_pdf` (each bundle's `domain` line). Keep the sample text as the seeded initial value. On submit: `rjsfDataFromRunValues` → pass the schema-shaped data dict to the action. Run button gates on readiness (replacing `!text.trim()`).
- [ ] Reshape `runExtractEntitiesPipeline.ts` per Decision D: the trio's input becomes the schema-shaped data dict. In a shared per-action preamble (server side): `buildRunInputsSchema(contract.inputs)` → `prepareRunInputs` → `validateRunInputs` — invalid verdict returns `{ ok: false, error }` as a `bad_request` `PipelineError` built from the verdict (`missingInputs`, falling back to `errors` + `describeValidationError`; never throw across the boundary) — → `apiInputsFromSchemaData` → `inputs` for `buildOptions`. Delete `emptyInputError` and the trim guards: one gate, two call sites. The server imports the same generated contract the client rendered from.
  - [ ] Consider one tiny shared helper in `src/lib/` (e.g. `gateRunInputs(contract, data)` returning `{ok: true, inputs} | {ok: false, error}`) so the three actions stay thin trios — log the Decision either way.
- [ ] Same swap for `ImageForm` + `runGenerateImagePipeline.ts`.
- [ ] Rewrite `EntityForm.test.tsx` and `ImageForm.test.tsx` against kernel-rendered controls: accessible queries still, but the labels are now the kernel's humanized input names, not the hand-written "Input text" / "Image prompt". Watch for happy-dom gaps around Radix primitives (these two are plain text/prose controls so risk is low; if a control needs `hasPointerCapture`/`scrollIntoView` shims, that's a Trap entry with the shim).
- [ ] Keep `useRun`, `ModeToggle`, `RunStatus`, `ErrorDisplay`, results, `CostReport` untouched (design's non-goals).
- [ ] `make all` clean.
- [ ] Log entries written (the action-boundary reshape as the skill's canonical pattern, the readiness-wiring Decision, the invalid-verdict → structured-error mapping, label changes breaking tests as a pre-warned Trap).

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
