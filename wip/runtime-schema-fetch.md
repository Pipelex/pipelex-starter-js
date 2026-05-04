# Follow-up: Runtime schema fetching from live pipelex API

## Why this exists

v0 generates types at build time from the local `.mthds` file. That covers the common case but not two real ones: (a) consumers who load bundles dynamically (e.g. a generic playground) and want types-at-runtime, (b) staying authoritative when pipelex's understanding of the bundle differs from mthds-js's (rare in steady state, painful when it happens during a pipelex breaking change).

The pipelex API already exposes JSON Schema per pipe via `/validate` (`pipelex-api/api/routes/pipelex/validate.py:42`, returns `pipe_structures[].json_schema`). It's right there for the asking.

## Goal

Optional runtime path: `client.fetchOutputSchema(bundle, pipe_code)` returns a zod schema (or JSON Schema, with a separate helper to convert). Consumers can use it directly with `executePipeline({ outputSchema })` without prior codegen.

## Open design questions

- **Caching**: schemas are stable per bundle hash. In-memory LRU? Disk? Leave to the consumer?
- **Conversion path**: reuse Phase 5's `jsonSchemaToZod` from v0. Pure win — exercises the same code path twice (build-time and runtime).
- **Error model**: `/validate` failures (network, auth, unknown pipe, malformed bundle) need the same `classifyPipelineError` treatment the rest of the SDK uses.
- **Trust boundary**: a server-fetched schema can change between requests. Document this loud — runtime types are weaker guarantees than codegen-time types.

## Pre-work

- Confirm `/validate` is stable enough to depend on (not breaking-changed every release).
- Decide whether to expose this as a method on `MthdsApiClient` or as a standalone utility.

## Definition of done

- `client.fetchOutputSchema(bundle, pipe_code)` returns a working zod schema for any fixture in v0's set.
- E2E test in `pipelex-starter-js` (or a separate playground) exercises the runtime path with a bundle the codegen never saw.
