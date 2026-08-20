// Build-time boundary guard: a consumer importing a `parseXxx` narrower from a
// "use client" component gets a Next build error instead of silently shipping
// zod plus every generated schema to the browser. (Unit tests alias this to a
// stub — see vitest.server-only-stub.ts.)
import "server-only";

import { z } from "zod";
import type { RunResults } from "@pipelex/sdk";

/**
 * The two adapters every `parseXxx()` narrower needs between a run's wire
 * output and a generated zod binder. There is no shape-checking here on
 * purpose: the generated `Schema.parse` does all of it, rejecting arrays,
 * primitives and `null` with far better messages than a hand-rolled predicate.
 *
 * Both paths deliver the main output the same way — `RunResults.main_stuff` is
 * the single main output's *content* directly (not a `{ concept, content }`
 * wrapper, not a working-memory map). The SDK resolves it out of the working
 * memory on the blocking `execute` path too, so there is one shape to read.
 */

/**
 * Peel `.optional()` / `.nullable()` / `.default()` / `.readonly()` wrappers off a
 * field and report what was underneath, so the caller can tell "may be absent"
 * from "has a value to invent".
 */
function unwrap(schema: z.ZodType): { core: z.ZodType; hasFallback: boolean } {
  let core = schema;
  let hasFallback = false;
  // The wrapper chain is finite, but guard anyway: a hand-built schema could nest
  // these arbitrarily and a malformed one must not hang a Server Action.
  for (let depth = 0; depth < 32; depth += 1) {
    const def = core.def as { type: string; innerType?: z.ZodType; getter?: () => z.ZodType };
    if (def.type === "default" || def.type === "prefault" || def.type === "catch") {
      hasFallback = true;
    }
    if (def.type === "lazy" && def.getter) {
      // Concept references project as `z.lazy(() => XSchema)`. Resolving it is safe:
      // the recursion below is driven by the payload, not by the schema.
      core = def.getter();
      continue;
    }
    if (def.innerType === undefined) break;
    core = def.innerType;
  }
  return { core, hasFallback };
}

/**
 * Whether a wire `null` on this field means "unset" — i.e. the field accepts
 * `undefined` and rejects `null`, and has no default that dropping would invent.
 *
 * Asked of the schema rather than pattern-matched on it, so `.nullish()`,
 * `.nullable()` and `.default(v)` all answer correctly without this file
 * enumerating zod's wrapper vocabulary.
 */
function nullMeansAbsent(field: z.ZodType): boolean {
  if (unwrap(field).hasFallback) return false;
  return field.safeParse(undefined).success && !field.safeParse(null).success;
}

/**
 * Turn the wire's explicit `null`s back into absence, but only where the schema
 * says absence is what `null` meant.
 *
 * Pipelex concepts are pydantic models, and an unset optional field is `None`
 * that the runtime serializes as an explicit `"caption": null` rather than
 * omitting the key. Confirmed live against api-dev: the `main_stuff` of a
 * hosted `PipeImgGen` run carries `source_negative_prompt`, `caption` and
 * `filename` as `null`. The ts-zod projection models the same field as
 * `.optional()` — which means `| undefined` and *rejects* `null` — so without
 * this step `parseImage` throws on every real image run.
 *
 * **The walk is schema-guided, and that is the whole point.** An earlier version
 * stripped every null-valued key at every depth, which is precisely the "blind
 * deep key transform" the ts-zod emitter's own design note rules out: inside a
 * `z.record()` or a `z.unknown()` a `null` is *data*, and a blind strip deletes
 * it before the schema can object — silently, with a green check. So descent
 * follows declared shapes only: object fields are considered individually,
 * arrays and record *values* are descended for their declared element type, and
 * anything opaque (`z.unknown()`, `z.any()`, a union) is passed through
 * untouched. A field carrying `.default(v)` is passed through too, because
 * dropping the key there would substitute the default for a `null` the pipeline
 * actually sent.
 *
 * It exists only until the emitter projects a non-required field as
 * `.nullish()` (or the transport dump stops serializing unset fields) —
 * reported upstream to pipelex; see docs/codegen.md for the evidence trail.
 */
export function dropWireNulls(value: unknown, schema: z.ZodType): unknown {
  const { core } = unwrap(schema);
  const def = core.def as {
    type: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    valueType?: z.ZodType;
  };

  if (def.type === "array" && def.element && Array.isArray(value)) {
    // A null list *item* is data, never absence — only object keys are optional
    // on the wire — so items are descended, never dropped.
    return value.map((item) => dropWireNulls(item, def.element as z.ZodType));
  }

  if (!isPlainObject(value)) return value;

  if (def.type === "record" && def.valueType) {
    // Keys are data here, so none are removed; values are still normalized in
    // case the record's declared value type is itself a concept.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        dropWireNulls(item, def.valueType as z.ZodType),
      ]),
    );
  }

  if (def.type !== "object" || !def.shape) return value;
  const shape = def.shape;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const field = shape[key];
    // An undeclared key is not ours to reshape — `Schema.parse` strips it.
    if (field === undefined) {
      out[key] = item;
      continue;
    }
    if (item === null) {
      if (nullMeansAbsent(field)) continue;
      out[key] = item;
      continue;
    }
    out[key] = dropWireNulls(item, field);
  }
  return out;
}

/** A JSON object — not an array, not null. Arrays are handled by their own branch. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The wire payload a narrower should hand to its generated binder: the run's
 * main output, with the wire's `null`s normalized away per `schema`.
 */
export function wireOutput(results: RunResults, schema: z.ZodType): unknown {
  return dropWireNulls(results.main_stuff, schema);
}

/**
 * Render a binder failure as a message for `BadPipelineOutputError` /
 * `BadImageOutputError`. A `ZodError`'s own `.message` is a JSON dump of its
 * issue array; `z.prettifyError` turns it into the field-by-field list a
 * developer can act on, which is what `<ErrorDisplay>` shows under "Details".
 */
export function describeSchemaFailure(err: unknown, typeName: string): string {
  if (err instanceof z.ZodError) {
    return `The run output did not match ${typeName}:\n${z.prettifyError(err)}`;
  }
  return err instanceof Error ? err.message : String(err);
}
