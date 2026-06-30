import type { RunResults } from "@pipelex/sdk";
import { findOutputContent } from "@/lib/runOutput";
import { BadPipelineOutputError } from "@/types/pipelineError";

export type ExtractedEntities = {
  people: string[];
  orgs: string[];
  dates: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Narrow a run's output into our ExtractedEntities shape. Takes `RunResults`
 * (durable `main_stuff` or the adapted blocking `pipe_output`) and reads the
 * main output content via `findOutputContent`. Throws `BadPipelineOutputError`
 * on shape mismatch — this is a system boundary (LLM output → typed app), so
 * failures are real bugs we want surfaced (the poll/blocking catch classifies
 * them).
 */
export function parseEntities(results: RunResults): ExtractedEntities {
  const content = findOutputContent(results, (c) => "people" in c && "orgs" in c && "dates" in c);
  if (!content) {
    throw new BadPipelineOutputError("Could not find ExtractedEntities in the run output");
  }

  const { people, orgs, dates } = content;
  if (!isStringArray(people) || !isStringArray(orgs) || !isStringArray(dates)) {
    throw new BadPipelineOutputError("ExtractedEntities fields must each be an array of strings");
  }

  return { people, orgs, dates };
}
