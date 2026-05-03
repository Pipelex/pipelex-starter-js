export type ExtractedEntities = {
  people: string[];
  orgs: string[];
  dates: string[];
};

/**
 * Tagged so error classification can distinguish a malformed pipeline output
 * (a real bug in the bundle or LLM provider) from an SDK/network error.
 */
export class BadPipelineOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadPipelineOutputError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Narrow the SDK's loosely-typed `pipe_output` into our ExtractedEntities shape.
 * Throws `BadPipelineOutputError` on shape mismatch — this is a system boundary
 * (LLM output → typed app), so failures are real bugs we want surfaced.
 */
export function parseEntities(pipeOutput: unknown): ExtractedEntities {
  if (!pipeOutput || typeof pipeOutput !== "object") {
    throw new BadPipelineOutputError("Expected pipe_output to be an object");
  }

  const workingMemory = (pipeOutput as { working_memory?: unknown }).working_memory;
  if (!workingMemory || typeof workingMemory !== "object") {
    throw new BadPipelineOutputError("Expected pipe_output.working_memory to be an object");
  }

  const entries = Object.values(workingMemory as Record<string, unknown>);
  const candidate = entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const content = (entry as { content?: unknown }).content;
      return content && typeof content === "object" ? (content as Record<string, unknown>) : null;
    })
    .find(
      (content) =>
        content !== null && "people" in content && "orgs" in content && "dates" in content,
    );

  if (!candidate) {
    throw new BadPipelineOutputError(
      "Could not find ExtractedEntities in pipe_output.working_memory",
    );
  }

  const { people, orgs, dates } = candidate;
  if (!isStringArray(people) || !isStringArray(orgs) || !isStringArray(dates)) {
    throw new BadPipelineOutputError("ExtractedEntities fields must each be an array of strings");
  }

  return { people, orgs, dates };
}
