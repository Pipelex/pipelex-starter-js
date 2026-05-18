import { describe, it, expect } from "vitest";
import { parseDocumentSummary } from "./summarizePipeline";

function makePipeOutput(content: unknown) {
  return {
    pipeline_run_id: "run-123",
    working_memory: {
      root: {
        summary: { content },
      },
      aliases: {},
    },
  };
}

describe("parseDocumentSummary", () => {
  it("extracts a valid DocumentSummary and maps snake_case to camelCase", () => {
    const result = parseDocumentSummary(
      makePipeOutput({
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

  it("accepts an empty key_points list", () => {
    const result = parseDocumentSummary(
      makePipeOutput({ title: "Memo", doc_type: "memo", key_points: [] }),
    );
    expect(result.keyPoints).toEqual([]);
  });

  it("throws when pipe_output is not an object", () => {
    expect(() => parseDocumentSummary(null)).toThrow();
    expect(() => parseDocumentSummary("nope")).toThrow();
  });

  it("throws when working_memory has no root key", () => {
    expect(() =>
      parseDocumentSummary({ pipeline_run_id: "x", working_memory: { aliases: {} } }),
    ).toThrow(/working_memory\.root/);
  });

  it("throws when no root entry matches the DocumentSummary shape", () => {
    expect(() => parseDocumentSummary(makePipeOutput({ foo: "bar" }))).toThrow();
  });

  it("throws when a field has the wrong type", () => {
    expect(() =>
      parseDocumentSummary(makePipeOutput({ title: 42, doc_type: "report", key_points: [] })),
    ).toThrow();
    expect(() =>
      parseDocumentSummary(
        makePipeOutput({ title: "T", doc_type: "report", key_points: ["ok", 7] }),
      ),
    ).toThrow();
  });
});
