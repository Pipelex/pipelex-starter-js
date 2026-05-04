# Follow-up: Cross-bundle Concept references in TS codegen

## Why this exists

v0 of `mthds gen` (see [`../TODOS.md`](../TODOS.md)) scopes codegen to a single `.mthds` bundle: every `concept_ref` / `item_concept_ref` must resolve to a Concept defined in the same bundle. Pipelex Python supports cross-bundle / cross-domain refs (e.g. `legal.contracts.Customer` resolving against the loaded library). TS must reach the same level eventually — anything less leaves users hand-stitching types across bundles, which is exactly what we set out to avoid.

## Goal

`mthds gen` resolves Concept references that point outside the current bundle, producing TS imports between generated `.types.ts` files (or a single bundled output, depending on the resolution model).

## Open design questions

- **Resolution model**: do we resolve refs by walking a known method-package directory (mirroring how `pipelex` discovers libraries), by accepting an explicit `--include <bundle>` list, or via a project-level manifest (`METHODS.toml`)?
- **Output shape**: one `.types.ts` per bundle with cross-file `import { OtherSchema } from "../other-bundle/main.types";`, or a single combined `index.types.ts` per project? The first matches the bundle-as-unit philosophy; the second is simpler to consume.
- **Cycle handling**: bundles A and B referencing each other's Concepts. Probably need `z.lazy()` across files, which works but is uglier than the within-bundle case.
- **Versioning**: if bundle A pins concept `legal.contracts.Customer@1.2.0`, the generated TS needs to import the matching version. Coordinate with the existing `mthds install` versioning model.

## Pre-work needed

- Survey how pipelex resolves cross-domain refs (`pipelex/pipelex/core/concepts/concept_provider.py` or similar — confirm path during work).
- Decide the resolution model **before** touching codegen — it changes the IR (`Phase 3` of v0) significantly.

## Definition of done

- All of pipelex's cross-domain integration tests have a TS conformance counterpart in `cli-harness/`.
- `mthds gen` against any bundle in `methods/` (multi-bundle workspace) produces compiling, importable TS without manual edits.
