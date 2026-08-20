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
 * Turn the wire's explicit `null`s back into absence so a generated schema can
 * validate the payload.
 *
 * Pipelex concepts are pydantic models, and an unset optional field is `None`
 * that the runtime serializes as an explicit `"caption": null` rather than
 * omitting the key. Confirmed live against api-dev: the `main_stuff` of a
 * hosted `PipeImgGen` run carries `source_negative_prompt`, `caption` and
 * `filename` as `null`. The ts-zod projection models the same field as
 * `.optional()` — which means `| undefined` and *rejects* `null` — so without
 * this step `parseImage` throws on every real image run.
 *
 * This is a wire normalization, not a shape: `null` and absent mean the same
 * thing on the far side, so nothing is lost and no field name is re-declared
 * here. It exists only until the emitter projects a non-required field as
 * `.nullish()`, which is filed upstream in
 * `../wip/inbox/2026-08-20-pipelex-ts-zod-optional-rejects-wire-null.md`.
 *
 * Known limit: an *opaque* concept field (projected as `z.unknown()`) whose
 * payload legitimately carries a `null` value loses it here. No method in this
 * template has one, and the emitter fix removes the need for this entirely.
 */
export function dropWireNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Only object *keys* are optional on the wire; a null list item is data.
    return value.map((item) => dropWireNulls(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, dropWireNulls(item)]),
  );
}

/**
 * The wire payload a narrower should hand to its generated binder: the run's
 * main output, with the wire's `null`s normalized away.
 */
export function wireOutput(results: RunResults): unknown {
  return dropWireNulls(results.main_stuff);
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
