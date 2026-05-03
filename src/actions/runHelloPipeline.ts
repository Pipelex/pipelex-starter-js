"use server";

import { getPipelexClient } from "@/lib/pipelexClient";
import { loadHelloBundle } from "@/lib/loadBundle";
import { parseEntities, type ExtractedEntities } from "@/types/helloPipeline";

/**
 * Server Action: run the hello pipeline against a piece of input text and
 * return the extracted entities. Fails loudly on empty input or malformed
 * SDK output — both are real bugs we want surfaced, not silently swallowed.
 */
export async function runHelloPipeline(text: string): Promise<ExtractedEntities> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Input text is required");
  }

  const bundle = await loadHelloBundle();
  const client = getPipelexClient();

  const response = await client.executePipeline({
    pipe_code: "extract_entities",
    mthds_contents: [bundle],
    inputs: { text: trimmed },
  });

  return parseEntities(response.pipe_output);
}
