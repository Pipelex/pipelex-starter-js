import { describe, it, expect } from "vitest";
import { loadHelloBundle } from "./loadBundle";

describe("loadHelloBundle", () => {
  it("reads the hello bundle TOML from disk", async () => {
    const bundle = await loadHelloBundle();
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle).toContain('domain      = "hello"');
    expect(bundle).toContain("[pipe.extract_entities]");
    expect(bundle).toContain("[concept.ExtractedEntities]");
  });
});
