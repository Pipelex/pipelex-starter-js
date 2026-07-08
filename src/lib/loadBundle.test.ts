import { describe, it, expect } from "vitest";
import {
  loadGenerateImageBundle,
  loadExtractEntitiesBundle,
  loadSummarizePdfBundle,
} from "./loadBundle";

describe("loadExtractEntitiesBundle", () => {
  it("reads the extract-entities bundle TOML from disk", async () => {
    const bundle = await loadExtractEntitiesBundle();
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle).toContain('domain      = "extract_entities"');
    expect(bundle).toContain("[pipe.extract_entities]");
    expect(bundle).toContain("[concept.ExtractedEntities]");
  });
});

describe("loadSummarizePdfBundle", () => {
  it("reads the summarize-pdf bundle TOML from disk", async () => {
    const bundle = await loadSummarizePdfBundle();
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle).toContain('domain      = "summarize_pdf"');
    expect(bundle).toContain("[pipe.summarize_pdf]");
    expect(bundle).toContain("[concept.DocumentSummary]");
  });
});

describe("loadGenerateImageBundle", () => {
  it("reads the generate-image bundle TOML from disk", async () => {
    const bundle = await loadGenerateImageBundle();
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle).toContain('domain      = "generate_image"');
    expect(bundle).toContain("[pipe.generate_image]");
    expect(bundle).toContain('type        = "PipeImgGen"');
  });
});
