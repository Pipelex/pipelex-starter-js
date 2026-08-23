import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError, UnsupportedUploadCapabilityError } from "@pipelex/sdk";

const execute = vi.fn();
const start = vi.fn();
const getRunStatus = vi.fn();
const getRunResult = vi.fn();
const prepareInputs = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadSummarizePdfBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute, start, getRunStatus, getRunResult, prepareInputs }),
}));

import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "./runSummarizePdfPipeline";

const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQK";
const SUMMARY = { title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] };
const PARSED = { title: "Invoice", doc_type: "invoice", key_points: ["Total $1,728"] };

// Blocking execute returns a PipelexExecuteResult with the resolved `main_stuff`.
const BLOCKING_RESPONSE = { pipeline_run_id: "run-1", main_stuff: SUMMARY };

// What `prepareInputs` returns after uploading the PDF: the `document` input
// rewritten to a `pipelex-storage://` reference (so the run request carries a
// small URI, not the fat inline base64 the old envelope embedded).
const PREPARED_INPUTS = { document: { url: "pipelex-storage://uploaded/doc-1" } };
const PREPARED = {
  inputs: PREPARED_INPUTS,
  uploads: [{ uri: "pipelex-storage://uploaded/doc-1" }],
};

// The schema-shaped data dict the form hands the action: a `native.Document`
// input is `{url, filename}` in schema shape (the kernel's `FileValue`).
const DATA = { document: { url: PDF_DATA_URL, filename: "invoice.pdf" } };

// What the kernel's gate puts on the wire, and hands straight to prepareInputs:
// the explicit `{concept, content}` envelope. `prepareInputs` interprets its
// `content` exactly as it would a bare value, classifies it as a file from the
// method's declared `document = Document` signature (pipe_ref defaults to
// main_pipe), and preserves the envelope on output — verified live.
const PREPARE_CALL = {
  files: [{ content: "DUMMY_BUNDLE_TOML" }],
  inputs: {
    document: {
      concept: "native.Document",
      content: { url: PDF_DATA_URL, filename: "invoice.pdf" },
    },
  },
};

beforeEach(() => {
  execute.mockReset();
  start.mockReset();
  getRunStatus.mockReset();
  getRunResult.mockReset();
  prepareInputs.mockReset();
});

describe("runSummarizePdfBlocking", () => {
  it("prepares inputs (uploads the PDF), then calls execute with the rewritten inputs", async () => {
    prepareInputs.mockResolvedValueOnce(PREPARED);
    execute.mockResolvedValueOnce(BLOCKING_RESPONSE);
    const result = await runSummarizePdfBlocking(DATA);
    expect(prepareInputs).toHaveBeenCalledWith(PREPARE_CALL);
    expect(execute).toHaveBeenCalledWith({
      pipe_code: "summarize_pdf",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: PREPARED_INPUTS,
    });
    // `toMatchObject`: these tests assert delegation + narrowed output; the `usage`
    // sibling now on the outcome is covered in the helper/model tests.
    expect(result).toMatchObject({ ok: true, output: PARSED });
  });

  it("returns a bad_request error on missing input without preparing or running", async () => {
    const result = await runSummarizePdfBlocking({});
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "bad_request", title: "Input required" }),
    });
    expect(prepareInputs).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF data URL as unsupported_file_type before preparing", async () => {
    // The contract says "a url"; it cannot say "a PDF, under 8 MB". The byte
    // gate runs after the shape gate and is what catches this.
    const result = await runSummarizePdfBlocking({
      document: { url: "data:image/png;base64,AAAA", filename: "photo.png" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported_file_type");
    expect(prepareInputs).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies an upload failure (prepareInputs throws) into upload_failed, never running", async () => {
    prepareInputs.mockRejectedValueOnce(
      new UnsupportedUploadCapabilityError("no /v1/upload route"),
    );
    const result = await runSummarizePdfBlocking(DATA);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("upload_failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies SDK errors from execute into a structured PipelineError", async () => {
    prepareInputs.mockResolvedValueOnce(PREPARED);
    execute.mockRejectedValueOnce(
      new ApiUnreachableError("unreachable", "https://api.unreachable.example", "ECONNREFUSED"),
    );
    const result = await runSummarizePdfBlocking(DATA);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });
});

describe("startSummarizePdfRun", () => {
  it("prepares inputs, then calls start with the rewritten inputs; returns the run id", async () => {
    prepareInputs.mockResolvedValueOnce(PREPARED);
    start.mockResolvedValueOnce({ pipeline_run_id: "run-1" });
    const result = await startSummarizePdfRun(DATA);
    expect(prepareInputs).toHaveBeenCalledWith(PREPARE_CALL);
    expect(start).toHaveBeenCalledWith({
      pipe_code: "summarize_pdf",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: PREPARED_INPUTS,
    });
    expect(result).toEqual({ ok: true, runId: "run-1" });
  });

  it("re-runs the file pre-flight: rejects a non-PDF without preparing or starting", async () => {
    const result = await startSummarizePdfRun({
      document: { url: "data:image/png;base64,AAAA", filename: "photo.png" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsupported_file_type");
    expect(prepareInputs).not.toHaveBeenCalled();
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

describe("the paste-a-URL escape hatch", () => {
  it("passes an https reference through the byte gate untouched", async () => {
    // The kernel's file control offers "paste a URL instead", so a document
    // input can arrive with no bytes at all. There is nothing to size-check;
    // resolving the reference is `prepareInputs`' job.
    prepareInputs.mockResolvedValueOnce(PREPARED);
    start.mockResolvedValueOnce({ pipeline_run_id: "run-1" });
    const result = await startSummarizePdfRun({
      document: { url: "https://example.com/invoice.pdf" },
    });
    expect(result).toEqual({ ok: true, runId: "run-1" });
    expect(prepareInputs).toHaveBeenCalledWith({
      files: [{ content: "DUMMY_BUNDLE_TOML" }],
      inputs: {
        document: {
          concept: "native.Document",
          content: { url: "https://example.com/invoice.pdf" },
        },
      },
    });
  });
});
