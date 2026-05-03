import { describe, it, expect } from "vitest";
import { parseEntities } from "./helloPipeline";

function makePipeOutput(content: unknown) {
  return {
    pipeline_run_id: "run-123",
    working_memory: {
      entities: { content },
    },
  };
}

describe("parseEntities", () => {
  it("extracts a valid ExtractedEntities object", () => {
    const result = parseEntities(
      makePipeOutput({
        people: ["Tim Cook"],
        orgs: ["Apple"],
        dates: ["March 5th, 2026"],
      }),
    );
    expect(result).toEqual({
      people: ["Tim Cook"],
      orgs: ["Apple"],
      dates: ["March 5th, 2026"],
    });
  });

  it("accepts empty arrays for any field", () => {
    const result = parseEntities(makePipeOutput({ people: [], orgs: [], dates: [] }));
    expect(result).toEqual({ people: [], orgs: [], dates: [] });
  });

  it("throws when pipe_output is not an object", () => {
    expect(() => parseEntities(null)).toThrow();
    expect(() => parseEntities("not an object")).toThrow();
  });

  it("throws when working_memory has no matching entry", () => {
    expect(() =>
      parseEntities({
        pipeline_run_id: "x",
        working_memory: { other: { content: { foo: "bar" } } },
      }),
    ).toThrow();
  });

  it("throws when a field is not an array of strings", () => {
    expect(() => parseEntities(makePipeOutput({ people: "Tim", orgs: [], dates: [] }))).toThrow();
    expect(() => parseEntities(makePipeOutput({ people: [1, 2], orgs: [], dates: [] }))).toThrow();
  });
});
