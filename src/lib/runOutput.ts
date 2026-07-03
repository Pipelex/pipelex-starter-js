import type { RunResults } from "@pipelex/sdk";

/** A pipeline output's content — the loosely-typed object a narrower validates. */
export type Content = Record<string, unknown>;

/**
 * Find the output content of a run that matches `predicate`, normalizing over
 * the two shapes `RunResults` can carry. The single entry point shared by all
 * three `parseXxx()` narrowers and all three execution paths, so the
 * shape-handling lives in exactly one place.
 *
 * The two arms differ because the sources differ:
 *   - **`main_stuff`** (durable hosted) is the SINGLE main output's *content*
 *     directly — confirmed live: NOT a `{ concept, content }` stuff wrapper and
 *     NOT a working-memory map. Validate it against the predicate; no search.
 *   - **`pipe_output`** (blocking `execute`, adapted onto `RunResults`) is the
 *     full `{ working_memory: { root } }`. Search `root[*].content` for the
 *     entry that matches the predicate — the original narrower logic.
 *
 * `main_stuff ?? pipe_output`: the durable arm wins when present. The predicate
 * does double duty — it is the search key in the `pipe_output` arm and the
 * validator in the `main_stuff` arm.
 */
export function findOutputContent(
  results: RunResults,
  predicate: (content: Content) => boolean,
): Content | undefined {
  if (results.main_stuff != null) {
    const content = results.main_stuff;
    // A non-object main output (e.g. a list output renders to a top-level
    // array) can't satisfy any of our object-shaped predicates — treat it as
    // "not found" so the narrower throws its tagged error.
    if (typeof content !== "object" || Array.isArray(content)) return undefined;
    return predicate(content as Content) ? (content as Content) : undefined;
  }

  const root = (
    results.pipe_output as {
      working_memory?: { root?: Record<string, unknown> };
    } | null
  )?.working_memory?.root;
  if (!root || typeof root !== "object") return undefined;

  for (const entry of Object.values(root)) {
    if (!entry || typeof entry !== "object") continue;
    const content = (entry as { content?: unknown }).content;
    if (content && typeof content === "object" && predicate(content as Content)) {
      return content as Content;
    }
  }
  return undefined;
}
