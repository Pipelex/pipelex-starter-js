import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError } from "@pipelex/sdk";

const execute = vi.fn();
const start = vi.fn();
const getRunStatus = vi.fn();
const getRunResult = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadSummarizePdfBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute, start, getRunStatus, getRunResult }),
}));

import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "./runSummarizePdfPipeline";

const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQK";
const SUMMARY = { title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] };
const PARSED = { title: "Invoice", docType: "invoice", keyPoints: ["Total $1,728"] };

// Blocking execute returns a PipelexExecuteResult with the resolved `main_stuff`.
const BLOCKING_RESPONSE = { pipeline_run_id: "run-1", main_stuff: SUMMARY };

const DOC_INPUT = {
  document: {
    concept: "Document",
    content: { url: PDF_DATA_URL, filename: "invoice.pdf", mime_type: "application/pdf" },
  },
};

beforeEach(() => {
  execute.mockReset();
  start.mockReset();
  getRunStatus.mockReset();
  getRunResult.mockReset();
});

describe("runSummarizePdfBlocking", () => {
  it("calls execute with a Document input envelope; returns narrowed output", async () => {
    execute.mockResolvedValueOnce(BLOCKING_RESPONSE);
    const result = await runSummarizePdfBlocking({
      dataUrl: PDF_DATA_URL,
      filename: "invoice.pdf",
    });
    expect(execute).toHaveBeenCalledWith({
      pipe_code: "summarize_pdf",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: DOC_INPUT,
    });
    // `toMatchObject`: these tests assert delegation + narrowed output; the `usage`
    // sibling now on the outcome is covered in the helper/model tests.
    expect(result).toMatchObject({ ok: true, output: PARSED });
  });

  it("returns a bad_request error on empty input without calling the SDK", async () => {
    const result = await runSummarizePdfBlocking({ dataUrl: "", filename: "" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "bad_request" }) });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF data URL as unsupported_file_type without calling the SDK", async () => {
    const result = await runSummarizePdfBlocking({
      dataUrl: "data:image/png;base64,AAAA",
      filename: "photo.png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported_file_type");
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies SDK errors into a structured PipelineError", async () => {
    execute.mockRejectedValueOnce(
      new ApiUnreachableError("unreachable", "http://localhost:8081", "ECONNREFUSED"),
    );
    const result = await runSummarizePdfBlocking({
      dataUrl: PDF_DATA_URL,
      filename: "invoice.pdf",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });
});

describe("startSummarizePdfRun", () => {
  it("calls start with the Document input envelope; returns the run id", async () => {
    start.mockResolvedValueOnce({ pipeline_run_id: "run-1" });
    const result = await startSummarizePdfRun({ dataUrl: PDF_DATA_URL, filename: "invoice.pdf" });
    expect(start).toHaveBeenCalledWith({
      pipe_code: "summarize_pdf",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: DOC_INPUT,
    });
    expect(result).toEqual({ ok: true, runId: "run-1" });
  });

  it("re-runs the file pre-flight: rejects a non-PDF without calling start", async () => {
    const result = await startSummarizePdfRun({
      dataUrl: "data:image/png;base64,AAAA",
      filename: "photo.png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported_file_type");
    expect(start).not.toHaveBeenCalled();
  });
});

describe("pollSummarizePdfRun", () => {
  it("narrows the completed durable result (main_stuff)", async () => {
    getRunStatus.mockResolvedValueOnce({ status: "COMPLETED", degraded: false });
    getRunResult.mockResolvedValueOnce({
      state: "completed",
      pipeline_run_id: "run-1",
      result: { pipeline_run_id: "run-1", main_stuff: SUMMARY },
    });
    const result = await pollSummarizePdfRun("run-1");
    expect(result).toMatchObject({ ok: true, state: "completed", output: PARSED });
  });
});
