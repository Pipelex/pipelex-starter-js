# Input forms: rendered from the method, not written by hand

This is the reference for how the demo forms are built — why none of them names its own inputs, how the browser and the server share one set of validation rules, and what the styling setup is doing. The day-to-day rules live in [`CLAUDE.md`](../CLAUDE.md); this document is the "why" behind them, and its companion is [`docs/codegen.md`](codegen.md), which owns the artifact these forms read.

## Why

The same argument as [codegen](codegen.md), one layer up. A method's `.mthds` bundle already declares what it takes: variable names, concepts, which inputs are required. Before this, each demo form hand-rolled a `<textarea>` or a file picker for those inputs and hand-wrote a guard for each on **both** sides of the Server Action boundary. Every consumer who swapped in their own method inherited the obligation to write a form and to write its validation twice.

Now the form is derived from the method's own **wire input-form descriptor** — the standard's per-pipe, ordered presentation view of a method's inputs, requested from `POST /v1/validate` with `views: ["input_form"]` — with the IO contract co-walked beside it for the two facts the wire deliberately omits (the scalar content-wrapper key, a nested list's bounds). Swap the method, run `npm run codegen`, and the form follows — new inputs appear, renamed inputs relabel, a file input becomes a dropzone, and the Run button gates on whatever that method actually requires.

The kernel doing the deriving is [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form), which ships in two halves and this app uses both:

- **`@pipelex/mthds-form`** — the headless core. No React: the `RunField` descriptor, the derivation that produces it, the run gate, the wire format. Server-safe, which is what lets the browser and the Server Action take their input rules from one implementation.
- **`@pipelex/mthds-form/react`** — the themed control set: `FieldRenderer` and the per-kind controls it dispatches to.

Import from those two specifiers only. Never reach into `dist/`.

## The contract artifacts

`fieldsForContract(contract, descriptor)` consumes two payloads of one `POST /v1/validate` response: the pipe's IO contract (`pipe_io_contracts`) and its input-form descriptor (`input_form`, an opt-in structured view requested with `views: ["input_form"]`). The descriptor states what each field IS — kind, order, constraints, presence, gating — so the kernel maps it structurally instead of guessing from concept names and schema shapes; the contract is co-walked for the two facts the wire deliberately omits (the scalar wrapper key, a nested list's bounds) and is what the run gate validates against. This app takes both as one **committed codegen artifact** rather than a runtime fetch, so first paint needs no network and no API key: `npm run codegen` writes `src/generated/<method>/contracts.ts` alongside the types and the binder.

```ts
export const PIPE_IO_CONTRACTS: PipeIOContracts = {
  "extract_entities.extract_entities": {
    inputs: {
      text: {
        concept_ref: "native.Text",
        presence: "plain", // the authored marker, verbatim: plain | optional (?) | force (!)
        multiplicity: "single", // single | variable ([]) | fixed ([N])
        item_count: null, // non-null exactly when multiplicity is "fixed"
        json_schema: { … },
      },
    },
    output: { concept_ref: "extract_entities.ExtractedEntities", multiplicity: "single", item_count: null, optional: false },
  },
};

export const INPUT_FORM = {
  "extract_entities.extract_entities": {
    fields: [
      // one descriptor per declared input slot, in authored order
      { kind: "prose", name: "text", concept_ref: "native.Text", required: true, presence: "plain", gating: true },
    ],
  },
} as InputForm;
```

(`INPUT_FORM` is emitted with an `as` assertion rather than a `:` annotation, a documented workaround with an expiry: the deployed hosted engine still emits a `name` on a list's `item`, which the standard's closed shape forbids and tsc's excess-property check would reject. Fixed upstream in pipelex 0.54.0 — once the hosted engine carries it, the emitter reverts to an annotation. See `renderContracts` in `scripts/lib/shared.mts`.)

Both maps are keyed by **namespaced pipe ref** (`<domain>.<pipe_code>`), so entries are looked up rather than indexed:

```ts
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "extract_entities", "extract_entities");
```

`requireContract` (`src/lib/runInputs.ts`) wraps the kernel's `getPipeIOContract` — **contracts, then domain, then pipe code** — and throws when it misses; `requireInputForm` is its twin over `getPipeInputForm`, same argument order. The wrappers earn their place: the kernel returns `undefined` on a miss, and `fieldsForContract` returns `[]` unless both artifacts are present — so a missed lookup renders as an empty form with a live Run button, which reads like a styling bug rather than a typo. Both the form and its Server Action call `requireContract` at module scope (the form additionally `requireInputForm`), so a bad lookup fails at import.

Drift is covered the same way the rest of the tree is: `contracts.ts` carries no codegen stamp (it is not the codegen server's output), so its SHA-256 rides in the `sources.json` sidecar's `derived` map, and `npm run codegen:verify` re-fetches `/v1/validate` — with the same `views` opt-in — and compares the rendered bytes. See [`docs/codegen.md`](codegen.md).

## The three pieces in the app

| File                               | What it owns                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/hooks/useRunInputs.ts`        | Form values, the derived `fields`, readiness, and the wire shape. The companion to `useRun`: this one owns what goes **in**, `useRun` owns the run and what comes **out**.           |
| `src/components/RunInputsForm.tsx` | The kernel composition, purely presentational — `FieldRenderer` per field, empty optionals folded behind `OptionalToggle`, all under `FieldPresentationProvider presentation="app"`. |
| `src/lib/runInputs.ts`             | `requireContract`, `requireInputForm` and `gateRunInputs` — the server-side gate, and the mapping from an invalid verdict to a `PipelineError`.                                      |

A form is then two lines of wiring plus its own chrome:

```tsx
const { fields, values, setValues, ready, toData } = useRunInputs(CONTRACT, DESCRIPTOR, { text: SAMPLE_TEXT });
// …
<RunInputsForm fields={fields} values={values} onValuesChange={setValues} disabled={running} />
<button type="submit" disabled={running || !ready}>Extract entities</button>
```

`presentation="app"` is the kernel's own seam for a use-facing surface: labels become humanized questions (`image_prompt` → "Image prompt") and the concept pills disappear, because `native.Text` is implementation detail to somebody filling in a form. The `studio` presentation shows the identifier verbatim with its type, which is what a method _builder_ wants.

## One set of rules, two sides

The kernel's headless core is server-safe on purpose, and that is the whole design:

- **In the browser, for UX.** `computeReadiness(fields, values)` decides whether the Run button is live. Nothing more — the browser's checks are trivially bypassed and are not a gate.
- **On the server, for trust.** A Server Action is a public endpoint. It runs the kernel's **`gateRunInputs(contract, data)`** against the same committed contract the browser co-rendered from: one call that combines the per-input schemas, repairs the data, validates it with ajv, re-applies the readiness rules over the contract's own schema, and builds the `{concept, content}` payload the run expects. The gate deliberately takes the **contract alone**, never the descriptor — a machine consumer must never need the presentation artifact to validate a payload — so its emptiness re-check walks the contract's `json_schema` for itself, and the kernel's gate-agreement suite proves that walk and the descriptor-mapped readiness answer together. `src/lib/runInputs.ts` is a thin shim over it — all that remains here is rendering the kernel's refusal (`missingInputs`, raw ajv `errors`) as the `bad_request` `PipelineError` this template's `<ErrorDisplay>` shows.

Because both sides get their rules from the same kernel, the hand-written guards on both sides are **deleted**, not kept as belt-and-braces. Two rules that can disagree is the failure mode this removes. An earlier version of this repo assembled the gate from the kernel's four exported steps itself; the kernel now owns that assembly precisely because the emptiness step is where assemblies go wrong — there are four look-alike predicates and only two of them are the ones the Run button reads (the near-miss pair, `inputMustBeFilled` + `isFilled`, agrees on every native concept and diverges on a structured one in both directions). The kernel's `docs/run-gate.md` tells that story in full.

The invariant to preserve is not "the two sides are identical" — they are not, and should not be — but "**the server side is a strict superset of the client side**". Readiness is UX; this is the gate. The kernel asserts the invariant in its own suite by running both sides over one table of structured fixtures, and `src/lib/runInputs.test.ts` re-asserts it over this repo's **committed contracts**: it drives a table of inputs through `computeReadiness` and through `gateRunInputs` and demands the same verdict, which is what would catch a method redesign reaching a shape the kernel's fixtures do not. A comment claiming the two agree is worth very little — two successive versions of this repo's gate shipped one that was wrong.

That table mixes synthetic contracts with the real `complex-form` one, deliberately. The synthetic rows isolate shapes no committed method has (a struct with required children, a half-filled struct); the real rows cover every state that method's form can actually reach, because a redesign of the method is the likeliest way to reintroduce a disagreement. Adding a method with a structured or plural input means adding its states there — that is the check that catches "the Run button was enabled and the run was rejected anyway".

The action's argument is therefore the schema-shaped data dict rather than a hand-typed `text: string`:

```ts
export async function runExtractEntitiesBlocking(data: Record<string, unknown>) {
  const gated = gateRunInputs(CONTRACT, data);
  if (!gated.ok) return gated; // a bad_request PipelineError, never a throw
  return executeBlockingRun(() => buildOptions(gated.inputs), parseEntities);
}
```

An invalid verdict becomes a structured error rather than an exception, for the same reason every other failure in this template does: Next.js strips a thrown Server Action error to an opaque digest in production builds. The mapping reads `missingInputs` first (it names the variables, which is nearly every real failure) and falls back to `errors` rendered through the kernel's `describeValidationError` — the scan can come up empty on a malformed value, and a rejection must never be undiagnosable. `describeValidationError` takes an injected translator so the kernel stays i18n-agnostic; this app has no i18n, so it supplies the English wording directly, typed on the kernel's key union so a new key fails the build rather than rendering `undefined`.

### What travels on the wire

Inputs go out in the runtime's **explicit envelope**, which is `apiInputsFromSchemaData`'s output:

```json
{ "text": { "concept": "native.Text", "content": { "text": "Apple announced…" } } }
```

Two special cases are the kernel's, and worth knowing before you "simplify" them: a blank **optional** (`?`) input is omitted entirely, so the runtime records a real absence rather than an empty string; and an empty **plural** (`[]`) input keeps its key but is sent **bare**, without the envelope, because the envelope bypasses the shaper that knows how to type an empty list.

### Two validators, on purpose

The dependency tree ends up with two: the kernel's **ajv** gates inputs, and the generated **zod** narrows outputs. That is coherent — each guards one direction of the wire — and it is not something to clean up.

## File inputs

The kernel never uploads. `DocumentField` fires `env.onDropFile(id, file)` and waits for the host to write a value back:

```ts
const url = await fileToDataUrl(file);
setValues((current) => setValueAtPath(current, id.split("."), { url, filename: file.name }));
```

The `id` is a **dotted path**, not a name, which is what makes the same handler work for a file nested inside a structured concept. While the field's id sits in `env.uploadingIds`, the kernel shuts **every door into that value** — the dropzone, the "paste a URL instead" toggle and the URL input behind it — and shows a spinner. That guarantee is why this app needs no staleness token for a second selection mid-encode, and why `PdfForm` passes plain run state as the form's `disabled` rather than folding encode state in. The one write path `uploadingIds` cannot cover is the host's own chrome: the "Use sample PDF" shortcut writes into the same field, so it disables itself while the field is resolving (`running || encodingIds.size > 0`) — the same rule, applied by the one who owns the button.

Here the "upload" is the same base64 data URL the template always used, and the Server Action still hands it to the SDK's `prepareInputs`, which uploads the bytes to Pipelex storage and rewrites the input to a `pipelex-storage://` URI. **`prepareInputs` accepts the gate's `{concept, content}` envelope as readily as a bare value** — verified live: it finds the data URL inside `content.url`, uploads it, and preserves the envelope (and the sibling `filename`) on output. So no conversion layer sits at that seam.

A host with real storage would put its own upload call where `fileToDataUrl` sits, and nothing else would change.

### Which client-side checks survived, and why

The bundle can say the document input carries a `url`. It cannot say "a PDF, under 8 MB" — those are host policy. So the action runs the shape gate first and a host byte gate second, over the **gated** inputs, and the three original client-side checks did not all meet the same fate:

- **The type check is gone from the browser.** The server's MIME check is the only one now. Worth knowing: the kernel's `accept` (`PDF, DOCX, TXT` under the dropzone) is a _display hint_, not a filter — `useDropzone` is configured with no `accept`, so anything can be dropped and the rejection happens after the round-trip.
- **The size check stayed, as an early exit.** It reads the same exported `MAX_PDF_BYTES` the server re-reads, so it is not a second rule. It survives because past that cap the base64 payload does not fit `next.config.js`'s `serverActions.bodySizeLimit`, so without it a large file produces a slow encode and then an opaque transport failure instead of "File too large".
- **The empty-MIME normalization stayed, because it was never a guard.** Some drag-drop sources and some Windows configurations report an empty `file.type` for a valid PDF, and `FileReader` writes that emptiness into the data URL — which the server's MIME gate then rejects. Re-wrapping the file before encoding is an _encoding_ fix, and deleting it would have broken a real browser case.

The byte gate no-ops when the value carries no bytes, because the kernel's file control also offers "paste a URL instead" — an `https://` or `pipelex-storage://` reference is resolved by `prepareInputs`, not here. That escape hatch is a capability the adoption gained for free, and it came with a trap worth stating plainly, because the first version of this code walked straight into it:

**"No bytes to inspect" is not "nothing to verify", and the scheme check is the part that matters.** `prepareInputs` resolves any string it does not recognise as a `data:`, `http(s)://` or `pipelex-storage://` URL as a **local filesystem path** — it reads that path and uploads it (`@pipelex/sdk`'s `prepare-inputs.js` → `readLocalPath`). A Server Action is a public endpoint, so a gate that returns "fine" for everything that is not a data URL hands an arbitrary server-side file read to any caller, with the contents coming back summarized. `checkFileInputs` therefore validates the scheme against a closed set **first** and refuses by default; only then, and only for `data:`, does it check MIME and size. `http://` is deliberately outside that set: nothing here needs a cleartext fetch.

The same function finds the files by walking the method's **wire descriptor**, not by reading the input values' shape and not by the literal name `document`. A gate that reads `inputs.document` silently stops applying the day the bundle renames that input — codegen carries the rename into the form, the readiness rules and the wire envelope, and the byte cap just quietly disappears. Failing open on a routine edit is worse than not having the check. And a gate that looked for `url` keys in the values would get both directions wrong: a structured concept with a `url` field of its own is not a file, and a `Document` inside a list or two levels down a structured concept is. So `checkFileInputs` takes the pipe's `PipeInputFormDescriptor` (the action looks it up with `requireInputForm`, beside `requireContract`) and descends it the way the SDK's `prepareInputs` does — `document` / `image` is a file position at any depth, `object` descends its declared fields, `list` descends each item — reading a value only where the descriptor has promised a file. That is what makes a plural file input (`cvs: Document[]`) or a nested one ordinary rather than refused: the set of positions the gate verifies is, by construction, the set the SDK goes on to upload.

## Styling

The kernel's controls are Tailwind classes over the standard shadcn semantic tokens, and its docs define two **mutually exclusive** host lanes. Pick by one question: _does the host run a Tailwind build?_

- **Compile lane (what this app uses).** Add the package's bundle to the `content` globs and define the tokens in your own config.
- **Prebuilt lane.** Import `@pipelex/mthds-form/styles.css`. Only for a host with no Tailwind build — it carries Tailwind preflight, which would fight a Tailwind host's own `@tailwind base`.

Concretely, in `tailwind.config.ts`:

1. `content` gains `"./node_modules/@pipelex/mthds-form/dist/**/*.js"`. The controls ship compiled, so their class strings live in the package bundle, outside every source glob a host normally scans.
2. `theme.extend` gains the `colors` and `borderRadius` token mapping, mirrored from the kernel's own `tailwind.config.cjs` — that file is not a config to extend, it is the token contract in executable form. Without it, `bg-background`, `text-muted-foreground`, `border-input` and `rounded-md` are simply not utilities Tailwind knows.
3. `plugins` gains `tailwindcss-animate`, for the select popover's enter/exit utilities.

The token _values_ come from `@pipelex/mthds-form/theme.css` (stock neutral shadcn variables, no preflight), imported in `src/app/layout.tsx` **before** `globals.css` so a host-level override wins on ordering. Restyling the forms is then a matter of overriding CSS variables. A host that already runs shadcn/ui has all of this except the content glob, and needs no `theme.css`.

**The purge trap, because it is silent.** A missing content glob does not fail the build. It produces a _mostly_-styled form — only the classes unique to the controls vanish (focus ring, placeholder color, textarea height, dropzone drag state), which reads as a broken design system rather than a missing glob. The deterministic check is diffing the built stylesheet with and without the glob, not eyeballing the form:

```bash
sed '/mthds-form\/dist/d' tailwind.config.ts > tailwind.noglob.config.ts
npx tailwindcss -c tailwind.noglob.config.ts -i src/app/globals.css -o /tmp/without.css
npx tailwindcss -c tailwind.config.ts        -i src/app/globals.css -o /tmp/with.css
wc -l /tmp/without.css /tmp/with.css && rm tailwind.noglob.config.ts
```

`darkMode: ['class']` is deliberately **not** copied from the kernel's config: this app never sets a dark class, so it would be inert. A host with a dark-mode toggle needs it, plus dark token values.

## Adding an input to a method

Nothing in `src/` changes. Edit `methods/<name>/main.mthds`, run `npm run codegen`, commit the regenerated tree. The new input appears in the form with the right control, the right label, and the right gating; the server's gate starts requiring it; the tests that name it are the only place you touch.

`methods/complex-form/` is the worked demonstration: it is the one method here whose inputs go past a single text box, and `src/components/ComplexForm.tsx` is the payoff — no longer than `EntityForm.tsx`, and naming no input. Diff the two.

Two behaviour details of the current kernel worth knowing rather than debugging, both deliberate: a **required structured input must be touched** before Run lights up — a concept whose properties are all optional no longer reads ready while untouched, exactly as an untouched required number would not — and a **touched optional input enters the readiness count** (3 of 3 untouched, 3 of 4 once something is filled in it, 4 of 4 once complete), so the count a host displays moves when an optional structure is started.

The check that would catch a readiness-versus-gate regression is the agreement table in `src/lib/runInputs.test.ts`. A new method with a structured or plural input should add its states there before anything else.

**When the method lives elsewhere, the shape of this is identical.** A slice written by [`make add-method`](add-method.md) — one whose source is a `methods/<name>/method.json` selector rather than a bundle in this repo — renders through exactly the same composition: `useRunInputs(CONTRACT, DESCRIPTOR)`, `<RunInputsForm>`, and `gateRunInputs` on the server, all reading the same committed `contracts.ts`. `src/components/TextStatsForm.tsx` is the scaffolded example, and reading it beside `EntityForm.tsx` is the point — the scaffold could write it precisely because there was nothing method-specific to write. The one difference is where you go to add an input: the method is not yours to edit here, so you change it where it lives (its repository, or [app.pipelex.com](https://app.pipelex.com) for a catalog method), point the manifest at the new version, and run `npm run codegen`.

## What is deliberately not built

- **No client-side pre-validation with inline field errors.** The kernel supports it (`validateRunInputs` plus `describeValidationError` render per-field messages), and every demo method here has exactly one _required_ input, so readiness is the whole story. A form with several structured inputs would want it.
- **No custom URL resolution.** The kernel previews `http(s):`, `data:` and `blob:` URLs directly — the sample PDF's `data:` URL included — and asks the host's `resolveUrl` only for a value it cannot paint, which in this template is a `pipelex-storage://…/x.pdf` pasted through the control's own "paste a URL instead". `PdfForm` passes a resolver that hands the URI straight back: the kernel then renders its `<object>`, whose "Preview unavailable" child is what a browser shows for a scheme it cannot fetch, which beats no preview at all. Genuine resolution — exchanging that reference for a signed web URL — is not built, and a form seeded from a previous run would want it. Pinned by a regression test.

- **No custom `FieldStrings`.** The kernel's English defaults are used verbatim. A localized host injects its own through `FieldStringsProvider`.
- **No eject.** Generating per-method form wiring the way `binder.ts` is generated is a real option later; the kernel adoption is what would make it cheap.
