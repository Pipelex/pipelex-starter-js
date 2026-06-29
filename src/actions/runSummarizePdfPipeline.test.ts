import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError } from "mthds/errors";

const execute = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadSummarizePdfBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute }),
}));

import { runSummarizePdfPipeline } from "./runSummarizePdfPipeline";

const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQK";

function summaryOutput() {
  return {
    pipeline_run_id: "run-1",
    pipe_output: {
      pipeline_run_id: "run-1",
      working_memory: {
        root: {
          summary: {
            content: { title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] },
          },
        },
        aliases: {},
      },
    },
  };
}

beforeEach(() => {
  execute.mockReset();
});

describe("runSummarizePdfPipeline", () => {
  it("calls the SDK with the bundle, pipe code, and a Document input envelope", async () => {
    execute.mockResolvedValue(summaryOutput());

    const result = await runSummarizePdfPipeline({
      dataUrl: PDF_DATA_URL,
      filename: "invoice.pdf",
    });

    expect(execute).toHaveBeenCalledWith({
      pipe_code: "summarize_pdf",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: {
        document: {
          concept: "Document",
          content: { url: PDF_DATA_URL, filename: "invoice.pdf", mime_type: "application/pdf" },
        },
      },
    });
    expect(result).toEqual({
      ok: true,
      summary: { title: "Invoice", docType: "invoice", keyPoints: ["Total $1,728"] },
    });
  });

  it("returns a bad_request error on empty input without calling the SDK", async () => {
    const result = await runSummarizePdfPipeline({ dataUrl: "", filename: "" });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "bad_request" }),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF data URL as unsupported_file_type without calling the SDK", async () => {
    const result = await runSummarizePdfPipeline({
      dataUrl: "data:image/png;base64,AAAA",
      filename: "photo.png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported_file_type");
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies SDK errors into a structured PipelineError", async () => {
    execute.mockRejectedValue(
      new ApiUnreachableError(
        "Could not reach Pipelex API at http://localhost:8081 (ECONNREFUSED)",
        "http://localhost:8081",
        "ECONNREFUSED",
      ),
    );

    const result = await runSummarizePdfPipeline({
      dataUrl: PDF_DATA_URL,
      filename: "invoice.pdf",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });
});
