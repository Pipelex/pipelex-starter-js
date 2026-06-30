import { describe, it, expect } from "vitest";
import type { RunResults } from "@pipelex/sdk";
import { parseEntities } from "./helloPipeline";

/** Durable hosted shape: `main_stuff` IS the bare content (no wrapper). */
function mainStuff(content: unknown): RunResults {
  return { pipeline_run_id: "run-123", main_stuff: content };
}

/** Blocking/bare shape: `pipe_output` is the `{ working_memory: { root } }` map. */
function pipeOutput(content: unknown): RunResults {
  return {
    pipeline_run_id: "run-123",
    pipe_output: {
      working_memory: { root: { entities: { concept: "X", content } }, aliases: {} },
      pipeline_run_id: "run-123",
    },
  };
}

const VALID = { people: ["Tim Cook"], orgs: ["Apple"], dates: ["March 5th, 2026"] };

describe("parseEntities", () => {
  it("extracts a valid ExtractedEntities from durable main_stuff", () => {
    expect(parseEntities(mainStuff(VALID))).toEqual(VALID);
  });

  it("extracts a valid ExtractedEntities from blocking pipe_output", () => {
    expect(parseEntities(pipeOutput(VALID))).toEqual(VALID);
  });

  it("accepts empty arrays for any field", () => {
    const empty = { people: [], orgs: [], dates: [] };
    expect(parseEntities(mainStuff(empty))).toEqual(empty);
  });

  it("throws when no output content matches the ExtractedEntities shape", () => {
    expect(() => parseEntities(mainStuff({ foo: "bar" }))).toThrow();
    expect(() => parseEntities(pipeOutput({ foo: "bar" }))).toThrow();
  });

  it("throws when neither main_stuff nor pipe_output is present", () => {
    expect(() => parseEntities({ pipeline_run_id: "x" })).toThrow();
  });

  it("throws when a field is not an array of strings", () => {
    expect(() => parseEntities(mainStuff({ people: "Tim", orgs: [], dates: [] }))).toThrow();
    expect(() => parseEntities(mainStuff({ people: [1, 2], orgs: [], dates: [] }))).toThrow();
  });
});
