# Follow-up: TS codegen for pipe _inputs_

## Why this exists

v0 only types pipe _outputs_. Inputs to `executePipeline({ inputs: { ... } })` remain an untyped `Record<string, unknown>`. This is the second-most-common source of bugs after output drift — typos in input keys, wrong shape for a structured input Concept, missing required inputs. Generating types for the input surface closes the loop.

## Goal

`mthds gen` emits an `<PipeName>Inputs` type per pipe, derived from the pipe's declared `inputs = { name = "Concept" }` table. `executePipeline({ pipe_code, inputs })` becomes type-checked end-to-end.

## Open design questions

- **Concept-typed inputs**: when an input is a primitive Concept (`Text`, `Image`, etc.), TS should accept the primitive value directly (e.g. `string`). When it's a structured Concept, should it accept the structured value or the wrapped `Stuff` envelope? Pipelex API accepts both — we should pick the most ergonomic for TS.
- **Optional inputs**: pipes can have optional inputs. Need to mirror that in the generated type.
- **Multi-input pipes**: keys are open-ended in pipelex; the type must reject unknown keys (use `.strict()` in the input schema even though the output is lax — different concern).
- **Linking to `executePipeline`**: how do we connect "I'm calling `pipe_code: "extract_entities"`" to "TS should infer `inputs: ExtractEntitiesInputs`"? Probably via the `Schemas` map being expanded into a `Pipes` map: `{ pipe_code: { inputs: ZodSchema, output: ZodSchema } }`. Then a generic `executePipeline<P extends keyof Pipes>(...)` overload picks the right input/output types.

## Pre-work

- Decide whether to type inputs at all in v1, or wait for user demand. Output typing alone is a big win; inputs may not be the next priority.
- Confirm input structure in the pipelex API request body.

## Definition of done

- Calling `executePipeline({ pipe_code: "extract_entities", inputs: { typo: "..." } })` is a type error.
- All v0 fixtures gain matching `<PipeName>Inputs` types and are exercised in tests.
