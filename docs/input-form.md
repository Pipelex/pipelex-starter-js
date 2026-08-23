# Input forms: rendered from the method, not written by hand

This is the reference for how the three demo forms are built — why none of them names its own inputs, how the browser and the server share one validation gate, and what the styling setup is doing. The day-to-day rules live in [`CLAUDE.md`](../CLAUDE.md); this document is the "why" behind them, and its companion is [`docs/codegen.md`](codegen.md), which owns the artifact these forms read.

## Why

The same argument as [codegen](codegen.md), one layer up. A method's `.mthds` bundle already declares what it takes: variable names, concepts, which inputs are required. Before this, each demo form hand-rolled a `<textarea>` or a file picker for those inputs and hand-wrote a guard for each on **both** sides of the Server Action boundary. Every consumer who swapped in their own method inherited the obligation to write a form and to write its validation twice.

Now the form is derived from the method's own input contract. Swap the method, run `npm run codegen`, and the form follows — new inputs appear, renamed inputs relabel, a file input becomes a dropzone, and the Run button gates on whatever that method actually requires.

The kernel doing the deriving is [`@pipelex/mthds-form`](https://www.npmjs.com/package/@pipelex/mthds-form), which ships in two halves and this app uses both:

- **`@pipelex/mthds-form`** — the headless core. No React: the `RunField` descriptor, the derivation that produces it, the run gate, the wire format. Server-safe, which is what makes one gate serve two call sites.
- **`@pipelex/mthds-form/react`** — the themed control set: `FieldRenderer` and the per-kind controls it dispatches to.

Import from those two specifiers only. Never reach into `dist/`.

## The contract artifact

`buildRunFields` consumes the `inputs` map of a pipe's IO contract — the `pipe_io_contracts` payload from `POST /v1/validate`. This app takes it as a **committed codegen artifact** rather than a runtime fetch, so first paint needs no network and no API key: `npm run codegen` writes `src/generated/<method>/contracts.ts` alongside the types and the binder.

```ts
export const PIPE_IO_CONTRACTS: PipeIOContracts = {
  "extract_entities.extract_entities": {
    inputs: { text: { concept_ref: "native.Text", optional: false, json_schema: { … } } },
    output: { concept_ref: "extract_entities.ExtractedEntities", multiplicity: "single" },
  },
};
```

The map is keyed by **namespaced pipe ref** (`<domain>.<pipe_code>`), so entries are looked up rather than indexed:

```ts
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");
```

`requireContract` (`src/lib/runInputs.ts`) wraps the kernel's `getPipeIOContract` — **contracts, then domain, then pipe code** — and throws when it misses. That wrapper earns its place: the kernel returns `undefined` on a miss, and an undefined contract renders as an empty form with a live Run button, which reads like a styling bug rather than a typo. Both the form and its Server Action call it at module scope, so a bad lookup fails at import.

Drift is covered the same way the rest of the tree is: `contracts.ts` carries no codegen stamp (it is not the codegen server's output), so its SHA-256 rides in the `sources.json` sidecar's `derived` map, and `npm run codegen:verify` re-fetches `/v1/validate` and compares the rendered bytes. See [`docs/codegen.md`](codegen.md).

## The three pieces in the app

| File                               | What it owns                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/hooks/useRunInputs.ts`        | Form values, the derived `fields`, readiness, and the wire shape. The companion to `useRun`: this one owns what goes **in**, `useRun` owns the run and what comes **out**.           |
| `src/components/RunInputsForm.tsx` | The kernel composition, purely presentational — `FieldRenderer` per field, empty optionals folded behind `OptionalToggle`, all under `FieldPresentationProvider presentation="app"`. |
| `src/lib/runInputs.ts`             | `requireContract` and `gateRunInputs` — the four-step gate, and the mapping from an invalid verdict to a `PipelineError`.                                                            |

A form is then two lines of wiring plus its own chrome:

```tsx
const { fields, values, setValues, ready, toData } = useRunInputs(CONTRACT, { text: SAMPLE_TEXT });
// …
<RunInputsForm fields={fields} values={values} onValuesChange={setValues} disabled={running} />
<button type="submit" disabled={running || !ready}>Extract entities</button>
```

`presentation="app"` is the kernel's own seam for a use-facing surface: labels become humanized questions (`image_prompt` → "Image prompt") and the concept pills disappear, because `native.Text` is implementation detail to somebody filling in a form. The `studio` presentation shows the identifier verbatim with its type, which is what a method _builder_ wants.

## One gate, two call sites

The kernel's headless core is server-safe on purpose, and that is the whole design:

- **In the browser, for UX.** `computeReadiness(fields, values)` decides whether the Run button is live. Nothing more — the browser's checks are trivially bypassed and are not a gate.
- **On the server, for trust.** A Server Action is a public endpoint. It runs the full four-step gate itself against the same committed contract the browser rendered from:

  ```
  buildRunInputsSchema(contract.inputs)   # combine the per-input schemas; `required` is the gating set
  prepareRunInputs(data, schema)          # heal legacy wrappers, prune empty optionals
  validateRunInputs(prepared, …)          # ajv, plus the scan that names the VARIABLE at fault
  apiInputsFromSchemaData(prepared, …)    # the {concept, content} payload the run expects
  ```

Because both sides run the same implementation, the hand-written guards on both sides are **deleted**, not kept as belt-and-braces. Two rules that can disagree is the failure mode this removes.

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

The `id` is a **dotted path**, not a name, which is what makes the same handler work for a file nested inside a structured concept. While the field's id sits in `env.uploadingIds`, the kernel disables that control and shows a spinner — which is also why this app needs no staleness token: the user cannot start a second read while the first is in flight.

Here the "upload" is the same base64 data URL the template always used, and the Server Action still hands it to the SDK's `prepareInputs`, which uploads the bytes to Pipelex storage and rewrites the input to a `pipelex-storage://` URI. **`prepareInputs` accepts the gate's `{concept, content}` envelope as readily as a bare value** — verified live: it finds the data URL inside `content.url`, uploads it, and preserves the envelope (and the sibling `filename`) on output. So no conversion layer sits at that seam.

A host with real storage would put its own upload call where `fileToDataUrl` sits, and nothing else would change.

### Which client-side checks survived, and why

The bundle can say the document input carries a `url`. It cannot say "a PDF, under 8 MB" — those are host policy. So the action runs the shape gate first and a host byte gate second, over the **gated** inputs, and the three original client-side checks did not all meet the same fate:

- **The type check is gone from the browser.** The server's MIME check is the only one now. Worth knowing: the kernel's `accept` (`PDF, DOCX, TXT` under the dropzone) is a _display hint_, not a filter — `useDropzone` is configured with no `accept`, so anything can be dropped and the rejection happens after the round-trip.
- **The size check stayed, as an early exit.** It reads the same exported `MAX_PDF_BYTES` the server re-reads, so it is not a second rule. It survives because past that cap the base64 payload does not fit `next.config.js`'s `serverActions.bodySizeLimit`, so without it a large file produces a slow encode and then an opaque transport failure instead of "PDF too large".
- **The empty-MIME normalization stayed, because it was never a guard.** Some drag-drop sources and some Windows configurations report an empty `file.type` for a valid PDF, and `FileReader` writes that emptiness into the data URL — which the server's MIME gate then rejects. Re-wrapping the file before encoding is an _encoding_ fix, and deleting it would have broken a real browser case.

The byte gate no-ops when the value is not a `data:` URL, because the kernel's file control also offers "paste a URL instead" — an `https://` or `pipelex-storage://` reference carries no bytes across the boundary, and resolving it is `prepareInputs`' job. That escape hatch is a capability the adoption gained for free.

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

## What is deliberately not built

- **No client-side pre-validation with inline field errors.** The kernel supports it (`validateRunInputs` plus `describeValidationError` render per-field messages), and every demo method here has exactly one required input, so readiness is the whole story. A form with several structured inputs would want it.
- **No `resolveUrl` in the field env.** It exists so an already-stored `pipelex-storage://` file previews in place; nothing in this template renders a form seeded from a previous run.
- **No custom `FieldStrings`.** The kernel's English defaults are used verbatim. A localized host injects its own through `FieldStringsProvider`.
- **No eject.** Generating per-method form wiring the way `binder.ts` is generated is a real option later; the kernel adoption is what would make it cheap.
