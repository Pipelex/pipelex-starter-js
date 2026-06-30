import { describe, it, expect } from "vitest";
import type { RunResults } from "@pipelex/sdk";
import { parseDocumentSummary } from "./summarizePipeline";

function mainStuff(content: unknown): RunResults {
  return { pipeline_run_id: "run-123", main_stuff: content };
}

function pipeOutput(content: unknown): RunResults {
  return {
    pipeline_run_id: "run-123",
    pipe_output: {
      working_memory: { root: { summary: { concept: "X", content } }, aliases: {} },
      pipeline_run_id: "run-123",
    },
  };
}

describe("parseDocumentSummary", () => {
  it("extracts a DocumentSummary from durable main_stuff (snake→camel)", () => {
    const result = parseDocumentSummary(
      mainStuff({
        title: "Q1 Revenue Report",
        doc_type: "report",
        key_points: ["Revenue up 12%", "Costs flat"],
      }),
    );
    expect(result).toEqual({
      title: "Q1 Revenue Report",
      docType: "report",
      keyPoints: ["Revenue up 12%", "Costs flat"],
    });
  });

  it("extracts a DocumentSummary from blocking pipe_output", () => {
    const result = parseDocumentSummary(
      pipeOutput({ title: "Memo", doc_type: "memo", key_points: ["one"] }),
    );
    expect(result).toEqual({ title: "Memo", docType: "memo", keyPoints: ["one"] });
  });

  it("accepts an empty key_points list", () => {
    const result = parseDocumentSummary(
      mainStuff({ title: "Memo", doc_type: "memo", key_points: [] }),
    );
    expect(result.keyPoints).toEqual([]);
  });

  it("throws when neither main_stuff nor pipe_output is present", () => {
    expect(() => parseDocumentSummary({ pipeline_run_id: "x" })).toThrow();
  });

  it("throws when no output content matches the DocumentSummary shape", () => {
    expect(() => parseDocumentSummary(mainStuff({ foo: "bar" }))).toThrow();
  });

  it("throws when a field has the wrong type", () => {
    expect(() =>
      parseDocumentSummary(mainStuff({ title: 42, doc_type: "report", key_points: [] })),
    ).toThrow();
    expect(() =>
      parseDocumentSummary(mainStuff({ title: "T", doc_type: "report", key_points: ["ok", 7] })),
    ).toThrow();
  });
});
