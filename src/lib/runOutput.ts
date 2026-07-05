import type { RunResults } from "@pipelex/sdk";

/** A pipeline output's content — the loosely-typed object a narrower validates. */
export type Content = Record<string, unknown>;

/**
 * Find the output content of a run that matches `predicate`. The single entry
 * point shared by all three `parseXxx()` narrowers and both execution paths, so
 * the shape-handling lives in exactly one place.
 *
 * Both paths now deliver the main output the same way: `RunResults.main_stuff`
 * is the single main output's *content* directly — confirmed live: NOT a
 * `{ concept, content }` stuff wrapper and NOT a working-memory map. The SDK
 * resolves it out of the working memory on the blocking `execute` path too (via
 * the response's `main_stuff_name`), so there is one shape to read — no search,
 * no unwrap. The predicate validates that content is the shape the caller wants.
 */
export function findOutputContent(
  results: RunResults,
  predicate: (content: Content) => boolean,
): Content | undefined {
  const content = results.main_stuff;
  // A non-object main output — a list output renders to a top-level array, a
  // scalar output (`0`, `false`, `""`) to a primitive — can't satisfy an
  // object-shaped predicate; treat it as "not found" so the narrower throws its
  // tagged error. (A genuinely absent `main_stuff` is `null`/`undefined` and
  // lands here too, but the SDK guarantees a completed run delivers one — it
  // throws `MissingMainStuffError` otherwise — so that case does not reach here.)
  if (content == null || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }
  return predicate(content as Content) ? (content as Content) : undefined;
}
