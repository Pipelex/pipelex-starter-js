# TODOS — integrate & demonstrate `@pipelex/sdk` 0.5.0 in the starter

**Goal:** integrate and demonstrate the two new capabilities that shipped in `@pipelex/sdk` **0.5.0** inside this reference template:

1. **Cost reports** — surface per-call token usage + computed USD `cost` from the new `RunResults.tokens_usages`.
2. **Cleaner file uploads** — replace the hand-rolled base64 `Document` envelope with the SDK's signature-driven `client.prepareInputs` (uploads to storage, rewrites inputs to `pipelex-storage://` URIs).

**Status:** planned, not started. Written 2026-07-22.

This template is a reference — keep every change small, clear, and something we'd want every consumer of the template to inherit. Two independent workstreams (A = cost, B = uploads); either order works. `make all` must stay green after every phase.

---

## Cold-start primer (read this first in a new session)

**SDK is already local.** `make use-local` has installed the sibling `../pipelex-sdk-js` (currently **0.5.0**) into `node_modules/@pipelex/sdk`. Re-run `make use-local` after editing the SDK. `package.json` still declares `^0.4.0` — Phase 0 bumps it.

**What 0.5.0 gives us (authoritative sources):**

- SDK changelog: `../pipelex-sdk-js/CHANGELOG.md` → `[v0.5.0]`.
- Cost: `RunResults.tokens_usages: TokensUsageRecord[] | null` + `usage_assembly_error: string | null` — defined in `../pipelex-sdk-js/src/runs.ts:110` (`TokensUsageRecord`) and `:158` (`RunResults`). Exported from `@pipelex/sdk`.
- Uploads: `client.uploadFile(asset, opts?)` and `client.prepareInputs({ files, pipe_ref?, inputs })` — surfaces in `../pipelex-sdk-js/src/upload.ts` (`UploadRecord`, `UploadableAsset`) and `../pipelex-sdk-js/src/prepare-inputs.ts` (`PrepareInputsRequest`, `PreparedInputs`). Client methods at `../pipelex-sdk-js/src/client.ts:1049` (`uploadFile`) and `:1062` (`prepareInputs`). Design contract: `../pipelex-sdk-js/docs/input-preparation.md`. Cross-repo behavior matrix (which sources upload vs pass through): `../wip/upload/behavior-matrix.md`.

**Key facts that shape the design:**

- `tokens_usages` is a **sibling** of `main_stuff` on `RunResults`, not inside it. So usage must **not** go through the `parseXxx(results)` narrowers (those stay focused on the main output). Extract it in the two run helpers (`blockingRun.ts` / `durableRun.ts`) where the whole `RunResults` is in hand, then thread it through the outcome types → hook state → a render component.
- **No run-level cost aggregate** — sum the per-record `cost`. Each `cost` is `null` when the model has no rate table (own-GPU/mock/dry-run) and `0` when a rate table priced it at zero. `nb_tokens_by_category` values are **not additive** (`input` already includes `input_cached`) — never sum categories; render them as-is or pick specific keys.
- Nullness of `tokens_usages`: `null` = assembly off / broke / pre-artifact; `[]` = ran, no inference happened; `usage_assembly_error` (non-null) is the **only** signal that separates "broke" from "off". Render must handle all three.
- **Durable path** already delivers `tokens_usages` on `RunResults` from `getRunResult`. **Blocking path** does not: `executeBlockingRun` adapts the execute response onto a `RunResults` carrying only `pipeline_run_id` + `main_stuff` (`src/lib/blockingRun.ts:34`). The usage pair rides the execute response's **extension-open `pipe_output`** (per the 0.5.0 changelog), so the adapter must also copy `pipe_output.tokens_usages` / `pipe_output.usage_assembly_error`. ⚠️ **Verify the exact access path against a live run** before trusting it (see Phase A task).
- **Uploads / the Server-Action boundary:** in this starter the SDK runs server-side (it holds the API key), so `prepareInputs` runs inside a Server Action. The browser still sends the file to our server as a base64 data URL, so Next's Server Action body limit (`next.config.js` `bodySizeLimit: "12mb"`) and the `MAX_PDF_BYTES` pre-flight are **still needed** and stay. What `prepareInputs` cleanly removes: the hand-rolled `{ concept: "Document", content }` envelope, our MIME/size envelope logic feeding the run, and the fat inline base64 in the **run** request (now a small `pipelex-storage://` URI). Truly letting the browser upload directly (bypassing the Server Action) is a **separate follow-up** — see `../wip/upload/followup-browser-direct-upload.md`.

**The only file-input example is `summarize-pdf`.** `generate-image` has a file _output_ (a URL), unrelated to `prepareInputs`. `extract-entities` is text-only. So Workstream B touches only the PDF path.

**Repo conventions (from `CLAUDE.md`):** Server Actions are the only SDK callers; each pipeline exports a trio (`run…Blocking` / `start…Run` / `poll…Run`) delegating to the shared helpers; narrow output with `parseXxx(results)`; return classified `{ ok:false, error }` (never throw across the boundary); add error kinds in `src/lib/errors.ts` (+ `errors.test.ts`); no barrels, no relative cross-folder imports, `@/` alias, Tailwind only, named exports. Run `make all` (check + test + build) after changes; `make agent-test` for silent tests; `make test-e2e` before shipping SDK-call-path changes (costs an LLM call, prompts first).

**Testing the SDK (unit):** mock `@/lib/pipelexClient` with `vi.mock`, returning only the methods under test as `vi.fn()`s — now including `prepareInputs`, `uploadFile` alongside `execute` / `start` / `getRunStatus` / `getRunResult`. Use `mockResolvedValueOnce` / `mockRejectedValueOnce` (not the persistent variants) on these spies. Durable form/hook tests use `vi.useFakeTimers()`; `PdfForm` keeps **real** timers (its `FileReader` needs them).

---

## Phase 0 — housekeeping & baseline

- [x] Confirm `node_modules/@pipelex/sdk/package.json` version is `0.5.0` (re-run `make use-local` if not). — confirmed `0.5.0`.
- [x] Bump `package.json` `@pipelex/sdk` `^0.4.0` → `^0.5.0`; ~~sync `package-lock.json`~~ **lock sync DEFERRED**. `@pipelex/sdk@0.5.0` is **not yet published to npm** (latest published = 0.4.0), so the lock cannot resolve a registry 0.5.0 tarball. Per decision (2026-07-22): keep `package.json` at `^0.5.0`, leave `package-lock.json` at the 0.4.0 registry entry, develop against the local tarball (`node_modules` = 0.5.0 via `make use-local --no-save`). Sync the lock at SDK-publish time. Caveat: a fresh `npm install` / `npm ci` fails to resolve `^0.5.0` until 0.5.0 lands on npm; `make all` stays green because it runs `npm run` scripts against `node_modules`, never `npm ci`.
- [x] Confirm the 0.5.0 **breaking changes don't bite us**: `pipe_output` narrowed to `DictPipeOutput | null` and `DictPipeOutput` made extension-open. Production code reads `main_stuff` only — unaffected. One **test fixture** did bite: `src/lib/runOutput.test.ts` constructs an inline `pipe_output` (a negative-assertion guard that `findOutputContent` never falls back to it); the now-concrete `DictPipeOutput` required `working_memory.aliases`, an inner `pipeline_run_id`, and a `concept` on the stuff. Fixed the fixture to a valid `DictPipeOutput`. Workstream A's `pipe_output.tokens_usages` read _depends on_ the extension-open widening, so it's aligned, not broken.
- [x] Baseline: `make all` green — green (all unit tests pass, production build succeeds).

> **Checkpoint 0:** SDK on 0.5.0, deps bumped (lock sync deferred to publish), baseline green. Safe to start either workstream. ✅ **REACHED**

---

## Workstream A — Cost reports (`tokens_usages`)

Additive and low-risk: no run-path behavior changes, just a new sibling value plumbed to a new render. Applies to **every** example (all runs produce usage), so the render lands in each form.

### A1 — Usage model + pure builder ✅

- [x] Add `src/lib/usageReport.ts` (pure — no React, no `process.env`; safe on either side):
  - `export interface UsageCall { modelName: string | null; modelType: string | null; pipeCode: string | null; tokensByCategory: Record<string, number> | null; costUsd: number | null; }`
  - `export interface UsageReport { calls: UsageCall[]; totalCostUsd: number | null; hasCost: boolean; state: "records" | "no-inference" | "unavailable"; assemblyError: string | null; }`
    - `state: "records"` when `tokens_usages` is a non-empty array; `"no-inference"` when `[]`; `"unavailable"` when `null`.
    - `totalCostUsd` = sum of non-null `cost` across records; `null` when **no** record carried a numeric cost (so the UI can say "cost not priced" vs "$0.00"). `hasCost` mirrors that.
  - `export function buildUsageReport(results: RunResults): UsageReport` mapping `results.tokens_usages` / `results.usage_assembly_error` (`import type { RunResults, TokensUsageRecord } from "@pipelex/sdk"`). **Do not** sum `nb_tokens_by_category` values together (non-additive) — carry the map through per call. **Done as specified**; `costUsd` uses `?? null` (not `|| null`) so a real `0` cost survives; `hasCost`/`totalCostUsd` keep `0` and drop only `null`.
- [x] `src/lib/usageReport.test.ts`: records case (mixed `cost` incl. `null`/`0`), `[]` → `no-inference`, `null` → `unavailable`, `usage_assembly_error` set, total-cost math (nulls skipped; all-null → `null` total). Also covers an absent (`undefined`) `tokens_usages` → `unavailable`.

### A2 — Thread usage through the run helpers ✅

- [x] `src/lib/blockingRun.ts`: widen `BlockingOutcome<T>` ok arm to `{ ok: true; output: T; usage: UsageReport }`. In `executeBlockingRun`, extend the adapter to copy the usage pair off the execute response's `pipe_output`, then build the report:

  ```ts
  const adapted: RunResults = {
    pipeline_run_id: response.pipeline_run_id,
    main_stuff: response.main_stuff,
    tokens_usages: (response.pipe_output?.tokens_usages ?? null) as TokensUsageRecord[] | null,
    usage_assembly_error: (response.pipe_output?.usage_assembly_error ?? null) as string | null,
  };
  return { ok: true, output: parse(adapted), usage: buildUsageReport(adapted) };
  ```

  - [ ] ⚠️ **Verify** `response.pipe_output?.tokens_usages` is the correct access (extension-open field) against a real blocking run — inspect the live response or the durable `getRunResult` shape. Adjust if the SDK surfaces it elsewhere. **Implemented per the 0.5.0 changelog contract but NOT yet live-verified — deferred to Phase C.** Access reads `pipe_output` typed as optional (`as DictPipeOutput | undefined`) since a bare runner / test double may omit it; the `?.` is then legitimately necessary (no unnecessary-optional-chain lint). Covered by a unit test that feeds `pipe_output.tokens_usages` and asserts a `records` report.

- [x] `src/lib/durableRun.ts`: widen `PollOutcome<T>` completed arm to `{ ok: true; state: "completed"; output: T; usage: UsageReport }`. In `pollDurableRun`, `res.result` is a full `RunResults` — `usage: buildUsageReport(res.result)`.

### A3 — Thread usage through the hook ✅

- [x] `src/hooks/useRun.ts`: widen `RunState<T>` done arm to `{ phase: "done"; output: T; usage: UsageReport }`. Update `succeed(output, usage)` and both call sites (blocking `.then`, durable `completed`) to pass `outcome.usage`.

### A4 — Render component ✅

- [x] Add `src/components/CostReport.tsx` (server component, pure render, named export, Tailwind only). Props `{ usage: UsageReport }`. Behavior:
  - `state: "records"` → compact table: model / pipe / raw token categories (rendered verbatim, never summed) / per-call `cost` (`null` → "—", `0`/positive → USD), plus a **total** row (`totalCostUsd`; "Not priced" + an explainer line when `null`).
  - `state: "no-inference"` → subtle note ("No billable inference in this run").
  - `state: "unavailable"` → **chose "render nothing" when off**; when `assemblyError` is set (assembly _broke_), a muted note + a "Technical details" `<details>` block (mirrors `<ErrorDisplay>`'s style) demonstrates the broke-vs-off distinction.
- [x] `src/components/CostReport.test.tsx`: one render assertion per `state`, plus null-cost formatting (per-call "—", total "Not priced").

### A5 — Wire into the example forms ✅

- [x] In each form (`EntityForm.tsx`, `PdfForm.tsx`, `ImageForm.tsx`), render `<CostReport usage={state.usage} />` when `state.phase === "done"`, next to the result component (fragment-wrapped so `space-y-*` still spaces it).
- [x] Update the affected form/hook unit tests to pass/allow the new `usage` in the done state. Also updated the **action-layer** tests (`run*Pipeline.test.ts`): their `{ ok, output }` / `{ ok, state, output }` assertions moved from `toEqual` → `toMatchObject` so the new `usage` sibling doesn't break delegation-focused tests (usage is exhaustively covered in the helper/model tests), and `blockingRun`/`durableRun` tests gained explicit usage assertions.

> **Checkpoint A:** `make all` green ✅ **REACHED** (195 unit tests pass, production build succeeds). Cost report renders under each example's result in both modes. Live-run verification (incl. the A2 blocking-path `pipe_output.tokens_usages` access) is deferred to Phase C per the plan.

---

## Workstream B — Cleaner file uploads (`prepareInputs`)

Replace the hand-rolled `Document` envelope in the PDF path with signature-driven `client.prepareInputs`. Keep the client-side data-URL encoding and the server-side pre-flight (they guard the still-present Server Action boundary).

### B1 — Swap the PDF `buildOptions` to `prepareInputs`

- [ ] `src/actions/runSummarizePdfPipeline.ts`: rewrite `buildOptions` to prepare inputs via the SDK instead of `buildDocumentInput`:

  ```ts
  async function buildOptions(input: SummarizePdfInput): Promise<StartOptions> {
    const bundle = await loadSummarizePdfBundle();
    const prepared = await getPipelexClient().prepareInputs({
      files: [{ content: bundle }],
      pipe_ref: "summarize_pdf.summarize_pdf", // domain.pipe_code; or omit → defaults to main_pipe
      inputs: { document: { url: input.dataUrl, filename: input.filename || "document.pdf" } },
    });
    return { pipe_code: PIPE_CODE, mthds_contents: [bundle], inputs: prepared.inputs };
  }
  ```

  - The method: `methods/summarize-pdf/main.mthds` — `domain = "summarize_pdf"`, `main_pipe = "summarize_pdf"`, input var `document` = concept `Document`.
  - **Decision (verify against `behavior-matrix.md` + a live run):** pass the **canonical content** `{ url: dataUrl, filename }` at `document` (preserves filename; exercises `prepareInputs`' url-bearing-content upload path). The more minimal signature-driven form is a **bare data-URL string** at `document` (let the Document-declared signature classify it) — try it and keep whichever reads cleanest as the template's teaching example. Note: nothing currently renders the filename, so losing it is cosmetic.
  - Because `prepareInputs` throws before the run on failure and it's called inside `buildOptions` (which runs within `executeBlockingRun` / `startDurableRun`'s try/catch), its errors are classified by the existing catch — no new try/catch here. On the **durable** path, `startDurableRun` calls `buildOptions` (upload happens once, at start); `poll` never rebuilds, so no re-upload.
  - `getPipelexClient` must be imported into the action (currently the action never touches the client directly — the helpers do). This is a deliberate, contained exception: preparing inputs is a pre-run SDK call, distinct from executing. Keep it in `buildOptions`.

### B2 — Classify upload / preparation errors

- [ ] `src/lib/errors.ts`: add a `PipelineErrorKind` for upload failures (recommend a single `"upload_failed"` with subclass-tailored copy, mirroring `classifyServerError`'s switch). Import the typed classes from `@pipelex/sdk`: `InputPreparationError` (base), `InvalidLocalSourceError`, `RejectedAssetError`, `UnsupportedUploadCapabilityError`, `UploadAuthenticationError`, `UploadTransportError`.
  - Add branches in `classifyPipelineError` **above** the generic fallthrough. Suggested copy:
    - `UnsupportedUploadCapabilityError` → "This API doesn't support file upload" — analogous to `lifecycle_unavailable`; point at the hosted API (`PIPELEX_BASE_URL=https://api.pipelex.com`). Consider setting `apiMessage` to the server's verbatim text.
    - `RejectedAssetError` → "The file was rejected" (server size cap / 413) — restate service-defined limit; suggest a smaller file.
    - `UploadAuthenticationError` → reuse the auth-missing/invalid framing (401/403 on upload).
    - `UploadTransportError` / `InvalidLocalSourceError` → generic upload-failed with technical details.
  - Keep the base `InputPreparationError` branch last so any future subclass is still classified (not `unknown`).
- [ ] `src/lib/errors.test.ts`: cover each new branch (construct each subclass and assert `kind` + title).

### B3 — Retire the hand-rolled envelope, keep the guards

- [ ] `src/lib/fileEncoding.ts`: remove `buildDocumentInput` + the `DocumentInput` type (now the SDK's job). **Keep** `validateDataUrl`, `MAX_PDF_BYTES`, `dataUrlMimeType`, `dataUrlByteLength`, `fileInputErrorToPipelineError` — the pre-flight still runs (fast UX + Server-Action body-limit protection) since the data URL still crosses to the server.
- [ ] Update `src/lib/fileEncoding.test.ts` (drop `buildDocumentInput` tests; keep validation tests).
- [ ] `runSummarizePdfPipeline.ts`: drop the `buildDocumentInput` import; `preflight` (empty-input + `validateDataUrl`) stays unchanged.
- [ ] `next.config.js`: leave `bodySizeLimit: "12mb"` and its comment (still accurate — the data URL still transits the Server Action). The follow-up doc is where that boundary gets removed.

### B4 — Unit tests for the new PDF path

- [ ] Action/helper tests: mock `@/lib/pipelexClient` to return `prepareInputs` (resolves `{ inputs: {...}, uploads: [...] }`) alongside `execute` / `start` / `getRunStatus` / `getRunResult`. Assert the blocking path calls `prepareInputs` then `execute` with `prepared.inputs`; assert a rejected `prepareInputs` (e.g. `UnsupportedUploadCapabilityError`) yields `{ ok:false, error.kind: "upload_failed" }`.
- [ ] `PdfForm` test: unchanged in spirit (mock `@/actions/runSummarizePdfPipeline`); the form doesn't know about uploads.

> **Checkpoint B:** `make all` green. PDF example uploads via `prepareInputs`; the run request carries a `pipelex-storage://` URI, not inline base64. Upload failures render as classified errors. Verified live in Phase C.

---

## Phase C — docs, e2e, finalize

- [ ] **Docs — `CLAUDE.md` (this repo):** update the "File & image inputs" section to describe the `prepareInputs` flow (signature-driven, `pipelex-storage://`, typed `InputPreparationError`s) replacing `buildDocumentInput`; add `tokens_usages` / `<CostReport>` to the integration pattern and the component/lib maps. Mention `uploadFile` as the single-asset escape hatch.
- [ ] **Docs — `docs/`:** add/update a short doc for the cost-report plumbing and the upload flow (create `docs/` if missing, per workspace policy). Link the SDK's `docs/input-preparation.md`.
- [ ] **e2e:** update `e2e/summarize-pdf.spec.ts` — it now exercises the real `/v1/upload` + `/v1/build/inputs` (`prepareInputs`) path. Assert the summary renders and (optionally) a `<CostReport>` is present. Consider a cost assertion in `e2e/extract.spec.ts` too. These hit the live API (`PIPELEX_API_KEY`); point `.env.local` at `api.pipelex.com` (a local bare runner can't serve the durable poll path or hosted upload — see memory `e2e-run-against-cloud-api`).
- [ ] Run `make test-e2e` (prompts; costs LLM calls) to verify both features end-to-end against the hosted API, **including the Phase A2 blocking-path `tokens_usages` access verification**.
- [ ] Final `make all` green; open a `feature/…` branch (e.g. `feature/sdk-0.5-cost-and-uploads`) targeting `main`.

> **Checkpoint C:** both capabilities integrated, demonstrated, documented, and live-verified. Ship.

---

## Decisions & open questions

- **Cost render scope:** render `<CostReport>` under **every** example (shared component, consistent template UX) rather than a single showcase. Cheap and instructive.
- **Usage is a sibling, not narrower output** — settled: extract in the helpers, not in `parseXxx`. Keeps the narrower contract (`main_stuff` only) intact.
- **`prepareInputs` input shape** (canonical `{ url, filename }` vs bare data-URL string) — decide during B1 against `behavior-matrix.md` + a live run; both are valid, pick the clearest for a template.
- **Blocking-path usage access** (`pipe_output.tokens_usages`) — must be live-verified (A2). If the SDK exposes it more directly on `PipelexExecuteResult`, prefer that.
- **`upload_failed` granularity** — one kind + tailored copy vs several kinds. Recommend one kind; revisit if the UI wants to branch.
- **Out of scope (follow-up):** browser-direct upload to bypass the Server Action body limit — written up in `../wip/upload/followup-browser-direct-upload.md`.

## References

- SDK changelog: `../pipelex-sdk-js/CHANGELOG.md` (`[v0.5.0]`).
- Upload contract: `../pipelex-sdk-js/docs/input-preparation.md`.
- Cross-repo upload plan + matrix: `../wip/upload/README.md`, `../wip/upload/behavior-matrix.md`.
- Types: `../pipelex-sdk-js/src/runs.ts` (`RunResults`, `TokensUsageRecord`), `../pipelex-sdk-js/src/upload.ts`, `../pipelex-sdk-js/src/prepare-inputs.ts`, `../pipelex-sdk-js/src/client.ts` (`uploadFile` @1049, `prepareInputs` @1062).
- This repo's integration pattern & conventions: `CLAUDE.md`.
