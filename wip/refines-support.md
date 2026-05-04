# Follow-up: `refines` (Concept inheritance) in TS codegen

## Why this exists

v0 (see [`../TODOS.md`](../TODOS.md)) defers `refines`. Pipelex supports `refines = "OtherConcept"` to express inheritance — a Concept reuses another's structure plus its own additions. Skipping this in TS means any user with even mild domain modelling will have to flatten their hierarchy by hand or fall back to the v0 hand-narrowing pattern. Not acceptable long-term.

## Goal

`mthds gen` honours `refines` and produces TS schemas that mirror pipelex's effective Concept (parent fields + child fields, child overrides win).

## Open design questions

- **Inheritance semantics**: pipelex flattens at structure-build time (parent fields are copied into the child's Pydantic model). Do we flatten the same way in JSON Schema, or use JSON Schema `allOf` and let zod compose via `.merge()` / `.extend()`? Flattening matches pipelex's wire format; composition reads better in generated TS.
- **Refines + cross-bundle refs**: if `refines` points to a Concept in another bundle, this couples to [`./cross-bundle-concept-refs.md`](./cross-bundle-concept-refs.md). Sequencing matters.
- **Field overrides**: pipelex rules around overriding required, type, choices, defaults — lift the rules verbatim from `pipelex/pipelex/core/concepts/concept_blueprint.py` and the `StructureGenerator` merging logic.
- **Multi-level chains**: A refines B refines C. Pipelex resolves transitively; TS must too.

## Pre-work

- Read pipelex's refines validation in `concept_blueprint.py` (mutual exclusivity rules with inline structure) and the merging logic in `structure_generation/generator.py`.
- Decide flatten vs. compose **before** writing tests; the assertion shape depends on it.

## Definition of done

- Pipelex's refines tests (search `pipelex/tests/` for `refines`) all have TS conformance counterparts in `cli-harness/`.
- A starter example with a non-trivial refines hierarchy (e.g. `Customer refines Person`) generates correct TS that round-trips through `executePipeline`.
