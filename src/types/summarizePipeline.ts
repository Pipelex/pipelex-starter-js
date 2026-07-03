import type { RunResults } from "@pipelex/sdk";
import { findOutputContent } from "@/lib/runOutput";
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
 * Narrow a run's output into our DocumentSummary shape. Takes `RunResults` and
 * reads the main output via `findOutputContent`. Throws `BadPipelineOutputError`
 * on shape mismatch — a system boundary (model output → typed app).
 *
 * The bundle emits snake_case (`doc_type`, `key_points`); we map to camelCase
 * here so the rest of the app stays idiomatic TypeScript.
 */
export function parseDocumentSummary(results: RunResults): DocumentSummary {
  const content = findOutputContent(
    results,
    (c) => "title" in c && "doc_type" in c && "key_points" in c,
  );
  if (!content) {
    throw new BadPipelineOutputError("Could not find DocumentSummary in the run output");
  }

  const { title, doc_type: docType, key_points: keyPoints } = content;
  if (typeof title !== "string" || typeof docType !== "string" || !isStringArray(keyPoints)) {
    throw new BadPipelineOutputError(
      "DocumentSummary requires a string title, a string doc_type, and a string-array key_points",
    );
  }

  return { title, docType, keyPoints };
}
