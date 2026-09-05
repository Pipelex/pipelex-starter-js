# `make add-method`: scaffolding a method that lives elsewhere

This is the reference for the second way a method reaches this app. The first is the one the four demo tabs tell: the bundle lives at `methods/<name>/main.mthds`, [`npm run codegen`](codegen.md) projects it, and a person writes the five files that turn the projection into a tab. `make add-method` is the same story for a method that lives **on the platform** (a catalog id) or **in a published package** (an address): the method stays where it is, a one-line manifest names it, and everything the demo tabs have by hand is written by the same projections.

```bash
make add-method METHOD=github.com/Pipelex/methods/text_stats@v0.1.1
```

The template ships the output of exactly that command as its fifth tab, "Text stats" — which is what keeps the scaffold's emitted code compiling on every `make all`, and what you diff your own run against.

## The gesture

|            |                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Make       | `make add-method METHOD=<selector> [PIPE=…] [NAME=…] [LABEL=…] [DRY_RUN=1]`                                                |
| npm        | `npm run add-method -- <selector> [--pipe …] [--name …] [--label …] [--dry-run]`                                           |
| Needs      | `PIPELEX_API_KEY`, and a base URL that advertises the selector kind (see [The handshake](#the-handshake-and-the-base-url)) |
| Exit codes | `0` written (or rehearsed), `1` refused or failed — never a thrown stack                                                   |

It is out of `make all` for the same reason `codegen` and `test-e2e` are: it needs a key and a network.

`METHOD` is the one required argument, and it is one of two forms:

- **A catalog id** — `mt_…`, a method saved under your key's organization on [app.pipelex.com](https://app.pipelex.com). Sent as `method_id`.
- **An address** — `github.com/<owner>/<repo>[/<package>][@<tag>]`, a published MTHDS package, with or without an `https://` prefix. Sent as `method_ref`, normalized to the bare form.

Anything else is refused naming both. There is deliberately **no local `.mthds` path**: that story already exists — put the bundle in `methods/<name>/` and run `npm run codegen`.

The optional arguments:

| Argument                  | What it does                                                                                     | Default                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `PIPE` / `--pipe`         | Which pipe of the method to wire, bare (`analyze_text`) or qualified (`text_stats.analyze_text`) | The pipe rule below                       |
| `NAME` / `--name`         | The kebab-case slug every derived name is built from                                             | Derived from the selector                 |
| `LABEL` / `--label`       | The tab's visible label                                                                          | The catalog name, else the humanized slug |
| `DRY_RUN=1` / `--dry-run` | Fetch, derive and print the whole plan; write nothing                                            | off                                       |

A flag whose value is missing — or is itself another flag, which is what `--label --dry-run` looks like when the real label was dropped — is refused rather than swallowed.

## What it writes

For `METHOD=github.com/Pipelex/methods/text_stats@v0.1.1`, with no other arguments:

```
methods/text-stats/method.json          # { "method_ref": "github.com/Pipelex/methods/text_stats@v0.1.1" }
src/generated/text-stats/               # types.ts, binder.ts, contracts.ts, codegen.lock, sources.json
src/types/textStatsPipeline.ts          # the narrower over the generated binder
src/actions/runTextStatsPipeline.ts     # the blocking + start + poll trio
src/actions/runTextStatsPipeline.test.ts
src/components/TextStatsForm.tsx        # useRunInputs + RunInputsForm + useRun + JsonResult
src/components/ExampleTabs.tsx          # one import line, one tab entry
```

That is the same file set the "Swap in your own pipeline" checklist in the README asks you to write by hand, minus the loader — a selector-sourced slice reads no bundle from disk, so `src/lib/loadBundle.ts` gains nothing.

**Nothing is written until everything has been fetched and derived.** The gesture runs in two halves: a read-only half that parses the selector, shakes hands with the API, fetches the projection and the contracts, chooses the pipe, binds the output, derives every name, checks every collision and locates the anchors in `ExampleTabs.tsx`; and a write half that runs only once all of that has passed. Every refusal happens in the first half, with nothing on disk changed. `--dry-run` stops at the boundary and prints the plan.

**The emitted files are formatted through this repo's own Prettier config** before they are written. Not a nicety: they land under `src/`, which `make check` runs `prettier --check` over, so a slice whose names pushed one line past the print width would fail the very first `make all` after being scaffolded — a bad first minute with a template. A Prettier that cannot be loaded writes unformatted and says so; a Prettier that loads and then throws is a broken template and propagates.

## The manifest is the source

`methods/<name>/method.json` holds exactly the selector and nothing else:

```json
{ "method_ref": "github.com/Pipelex/methods/text_stats@v0.1.1" }
```

It sits under `methods/` rather than beside the generated tree, and that placement is the whole reason the codegen scripts needed almost no new logic. `methods/` stays the source of truth and `src/generated/` stays purely derived, so every rule the [trust chain](codegen.md#the-trust-chain) rests on holds by construction: `sources.json` hashes the manifest the way it hashes a bundle, orphan detection still reads "a generated tree with no `methods/<name>/`", and `npm run codegen` regenerates selector-sourced trees beside file-sourced ones rather than being a second regeneration path. A method directory holds either `.mthds` files or a `method.json`, never both — the two would disagree about where the tree came from, and the check refuses that naming both.

**To move to another version of a published method, edit the tag and run `npm run codegen`.** That is the whole upgrade: the manifest's hash changes, `make check` fails with the usual "run `npm run codegen`" remedy until you do, and the regenerated diff shows what the new tag changed. See [Two source kinds](codegen.md#two-source-kinds) for the mechanics.

## One-shot, on purpose

The gesture never overwrites. Run it for a name that already exists and it refuses, naming the collision and the two ways forward: `npm run codegen` to refresh the tree, or the README's "Remove an example" checklist to start over. A `--force` that rewrote the app files would delete work you had done in them to save you an `rm`, and the four files it writes are explicitly yours to edit from the moment they land — each carries a header saying so.

The refresh is therefore always `npm run codegen`, and it refreshes only the generated tree. It does not re-derive the action, the narrower, the form or the tab: those are yours now, and a method change that alters what they need — a renamed output concept, say — surfaces as a type error against the regenerated tree, which is the loud failure you want.

Two escapes if you actually want a second slice of the same method: `--name` scaffolds beside the existing one, and `--pipe` is what makes that useful, since a package with several pipes is the usual reason.

## How each name is derived

Everything comes from one kebab-case slug.

- **The slug** is `--name` when given; otherwise the catalog method's `name` for an id (a person chose it) and the address's last path segment for a ref — the package, falling back to the repository for an address naming no package. It is kebab-cased (`text_stats` → `text-stats`, `CV screening` → `cv-screening`) and validated: a name that cannot be a directory, a tab id and the stem of four source files is a refusal here, not a broken import later.
- **`TextStats`** (Pascal) names the component, the three actions and the output type; **`textStats`** (camel) names the adapter module; **`Text stats`** (humanized) is the fallback tab label.
- **The tab id** is the slug.

## The pipe rule

A published package can carry several pipes, so the pipe is chosen by a rule that ends in a refusal rather than a guess. In order:

1. `PIPE`, if given — bare or qualified, refused if the method declares no such pipe (the message lists the ones it does), and refused as ambiguous if a bare code matches more than one domain.
2. The validate report's `default_pipe_ref`, when the method names one. This is read in preference to `bundle_blueprint.main_pipe` because it is typed and because it is the field a **package manifest's** entry pipe arrives in — `github.com/Pipelex/methods/documents` has no bundle-level main pipe and still has a default here.
3. The only pipe, when the method declares exactly one.
4. Otherwise a refusal listing the pipes and asking for `PIPE`.

The chosen ref is split at its last dot: the domain and the code are what `requireContract` and `requireInputForm` take, and the action sends the bare `pipe_code` beside the selector, which is what the four demo actions do.

## The output: a typed narrower, a generic view

**The narrower is typed, like the hand-written ones.** The ts-zod projection emits a schema and a binder for every concept the crate materializes, natives included, so `src/types/<camel>Pipeline.ts` is written exactly like `src/types/summarizePipeline.ts`: it re-exports the concept type under the slice's own name and hands `wireOutput(results, <Code>Schema)` to `parse<Code>` inside the `try/catch` that rethrows a `BadPipelineOutputError`. The concept code is the segment after the last dot of the pipe's `output.concept_ref`, and the scaffold **confirms those exports exist** in the artifacts it just fetched before writing anything — so an emitter naming change is a refusal with nothing written, not a type error in a file you did not write.

A **plural** output (a `multiplicity` other than `single`) arrives from the runtime as a `{ items: [ … ] }` envelope rather than a bare array — measured, not assumed — so the adapter for one declares that envelope beside the generated schema (`z.object({ items: z.array(<Code>Schema) })`) and parses through it. The envelope is the transport's shape, not a concept, which is why declaring it in the adapter layer is not the duplicated surface codegen exists to remove.

**The result component cannot be projected**, because a component is a design decision about a shape and the scaffold has no design — it would be inventing headings for fields it has never seen. So every scaffolded form renders `<JsonResult value={state.output} />` (`src/components/JsonResult.tsx`): the typed value as formatted JSON, plus an `<img>` for any web-renderable image URL it carries (`public_url ?? url`, one level down, the same preference `parseGeneratedImage` applies). The scaffold's closing message names that line as the one to replace, and `EntityResult` / `PdfSummaryResult` are what replacing it looks like.

## The form, and file inputs

The scaffolded form is the same kernel composition as the four hand-written ones, and it is worth reading `src/components/TextStatsForm.tsx` beside `src/components/ComplexForm.tsx` to see that it is not a lesser one: `useRunInputs(CONTRACT, DESCRIPTOR)` for values, readiness and the wire shape, `<RunInputsForm>` for the controls, `useRun({ mode, blocking, start, poll })` for the run, `<ModeToggle>`, `<RunStatus>`, `<ErrorDisplay>`. **No field, label or control is written** — they come from the method's own descriptor. The full reference is [`docs/input-form.md`](input-form.md).

When the method's descriptor declares a **top-level** `document` or `image` input, the scaffolded action takes the PDF example's shape: the shape gate, then `checkFileInputs` over the gated inputs with a media-type set chosen by kind (`application/pdf` for a document; PNG/JPEG/WebP for an image — emitted as a named constant with a comment saying it is yours to widen) and `MAX_PDF_BYTES` as the cap, then `prepareInputs({ ...selector, pipe_ref, inputs })` inside `buildOptions`. The form gets the drop seam through `src/hooks/useFileInputs.ts`, the hook extracted from `PdfForm` for exactly this.

A file position **nested** inside a structured or list input is refused by `checkFileInputs` at run time, because a public Server Action must not hand `prepareInputs` a path it has not verified. The scaffold warns about it at scaffold time, naming the dotted paths, so the first run is not the first you hear of it.

## The emitted test

The scaffold writes one test file, `src/actions/run<Name>Pipeline.test.ts`, and it is deliberately fixture-free. A test that guessed input fixtures from a descriptor would be a liability the day it guessed wrong. What can be asserted without inventing data is the trust boundary: when the pipe has a gating input, `run<Name>Blocking({})` and `start<Name>Run({})` return a `bad_request` **without calling the SDK**; when it has none, `{}` reaches `execute` carrying the selector and the bare `pipe_code`.

Everything else the slice does is already covered — by the shared code's own tests (`useRun`, `RunInputsForm`, `runInputs`, `blockingRun`, `durableRun`) and, for the shipped slice, by a hand-written `TextStatsForm.test.tsx` on the `EntityForm.test.tsx` pattern and an `e2e/text-stats.spec.ts` guarded like the other live specs.

## The tab, and the two anchors

`src/components/ExampleTabs.tsx` is data-driven: one `TABS` array of `{ id, label, Component }`, with the panels mapped from it rather than written out one per form. That is a small improvement on its own, and it is what makes a scaffolded tab **one** insertion point instead of two.

The file carries two marker comments, and they are the scaffold's whole contract with it:

```
// add-method:imports
// add-method:tabs
```

The scaffold inserts one import line directly above the first and one array entry directly above the second, refusing if either marker is missing or if the tab id is already taken. The match is on the **token alone**, not the full comment line, so the prose after the marker can be reworded freely — but **the tokens themselves must not move, be reworded, or be deleted.** A test in `scripts/lib/add-method.test.mts` reads the real file, so a template edit that loses an anchor fails the suite rather than the next person's scaffold run.

## The handshake, and the base URL

A selector is resolved **server-side**, so the API has to forward it. `GET /v1/version`'s `extensions` array is the SDK's documented handshake for that, and the three keyed scripts — `add-method`, `codegen` and `codegen:verify` — ask it once per run whenever a selector is involved, before anything is fetched or written. A missing extension is a refusal naming the base URL, the missing kind and what does advertise it, rather than the bare `403` an env-scoped key otherwise produces.

Two cases deliberately **proceed** rather than refuse, because in both the handshake has no verdict to give and the real call's own error is the better message: the handshake itself failing, and a response that advertises no capabilities at all.

**Today `api.pipelex.com` advertises `runs` and `method_id`, not `method_ref`** (hosted `0.10.1`, measured 2026-09-05), and the same deployment does not yet serve `/v1/validate`'s `input_form` view — which `npm run codegen` needs for **every** method, bundle-sourced ones included. So regeneration currently wants `PIPELEX_BASE_URL=https://api-dev.pipelex.com`. This is a deploy away and nothing in the committed tree depends on it: `codegen:check` is pure hashing, so `git clone && make all` stays green with no key and no network. See the README's environment table.

A selector that the API cannot resolve — an unknown package, a foreign-org id — comes back as a 404, and the server's own message is printed **verbatim** under a line naming the selector. For a bad address that message lists the packages the repository does contain, which is far more useful than a guess about `PIPELEX_BASE_URL` would be.

## Removing a scaffolded slice

The README's "Remove an example" checklist, with two differences: there is no bundle and no loader entry, and `methods/<name>/method.json` is what goes instead of `methods/<name>/main.mthds`. In one commit, delete:

1. `methods/<name>/` (the manifest) **and** `src/generated/<name>/` — `make check` fails on either half without the other.
2. `src/types/<camel>Pipeline.ts`, `src/actions/run<Name>Pipeline.ts` and its `.test.ts`, `src/components/<Name>Form.tsx` and any test you wrote for it.
3. The import line and the `TABS` entry in `src/components/ExampleTabs.tsx` — leaving both anchors in place.
4. Any e2e spec that drives the tab.

Then `make all`. `tsc` names most dangling references itself; the ones it cannot see are the `vi.mock` module strings in `ExampleTabs.test.tsx` and the Playwright selectors, which surface as test failures.

## What this deliberately does not do

- **No local `.mthds` path.** That story already exists, and serving it here would be a second way to do one thing.
- **No result component per output shape.** `JsonResult` is the honest view; the closing message names the line to replace.
- **No prose edits.** `src/app/page.tsx` describes the examples in a sentence, and the scaffold leaves prose to people.
- **No `--force`, no refresh mode.** `npm run codegen` is the refresh.
- **No skill.** A Make target and an npm script is what the gesture is; a slash command would wrap a one-line command.
- **No `method_id` slice in the template.** A catalog id is scoped to one organization, so ours would 404 for everyone else. The shipped slice is an address for that reason, and the gesture warns when it writes an id-sourced manifest that regeneration will need a key of the same org.

## References

- [`docs/codegen.md`](codegen.md) — the trust chain this extends, and the two source kinds in full.
- [`docs/input-form.md`](input-form.md) — the kernel composition every scaffolded form is an instance of.
- `scripts/lib/add-method.mts` — the behavior, with the pure helpers each unit-tested over a table in `add-method.test.mts`.
- `@pipelex/sdk` `dist/client.d.ts` — `validate` / `codegen` / `prepareInputs` selectors, and `version().extensions`.
