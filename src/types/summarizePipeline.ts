import { BadPipelineOutputError } from "@/types/pipelineError";

export type DocumentSummary = {
  title: string;
  docType: string;
  keyPoints: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Narrow the SDK's loosely-typed `pipe_output` into our DocumentSummary
 * shape. Throws `BadPipelineOutputError` on shape mismatch — this is a
 * system boundary (model output → typed app), so failures are real bugs.
 *
 * The bundle emits snake_case (`doc_type`, `key_points`); we map to
 * camelCase here so the rest of the app stays idiomatic TypeScript.
 */
export function parseDocumentSummary(pipeOutput: unknown): DocumentSummary {
  if (!pipeOutput || typeof pipeOutput !== "object") {
    throw new BadPipelineOutputError("Expected pipe_output to be an object");
  }

  const workingMemory = (pipeOutput as { working_memory?: unknown }).working_memory;
  if (!workingMemory || typeof workingMemory !== "object") {
    throw new BadPipelineOutputError("Expected pipe_output.working_memory to be an object");
  }

  const root = (workingMemory as { root?: unknown }).root;
  if (!root || typeof root !== "object") {
    throw new BadPipelineOutputError("Expected pipe_output.working_memory.root to be an object");
  }

  const candidate = Object.values(root as Record<string, unknown>)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const content = (entry as { content?: unknown }).content;
      return content && typeof content === "object" ? (content as Record<string, unknown>) : null;
    })
    .find(
      (content) =>
        content !== null && "title" in content && "doc_type" in content && "key_points" in content,
    );

  if (!candidate) {
    throw new BadPipelineOutputError(
      "Could not find DocumentSummary in pipe_output.working_memory",
    );
  }

  const { title, doc_type: docType, key_points: keyPoints } = candidate;
  if (typeof title !== "string" || typeof docType !== "string" || !isStringArray(keyPoints)) {
    throw new BadPipelineOutputError(
      "DocumentSummary requires a string title, a string doc_type, and a string-array key_points",
    );
  }

  return { title, docType, keyPoints };
}
