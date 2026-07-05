import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError } from "@pipelex/sdk";

const execute = vi.fn();
const start = vi.fn();
const getRunStatus = vi.fn();
const getRunResult = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadGenerateImageBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute, start, getRunStatus, getRunResult }),
}));

import {
  pollGenerateImageRun,
  runGenerateImageBlocking,
  startGenerateImageRun,
} from "./runGenerateImagePipeline";

const IMAGE_CONTENT = { url: "https://cdn.pipelex.com/x.png", mime_type: "image/png" };
const PARSED = {
  url: "https://cdn.pipelex.com/x.png",
  publicUrl: null,
  mimeType: "image/png",
  caption: null,
};

// Blocking execute returns a PipelexExecuteResult with the resolved `main_stuff`.
const BLOCKING_RESPONSE = { pipeline_run_id: "run-1", main_stuff: IMAGE_CONTENT };

beforeEach(() => {
  execute.mockReset();
  start.mockReset();
  getRunStatus.mockReset();
  getRunResult.mockReset();
});

describe("runGenerateImageBlocking", () => {
  it("calls execute with the bundle, pipe code, and trimmed prompt; returns narrowed output", async () => {
    execute.mockResolvedValueOnce(BLOCKING_RESPONSE);
    const result = await runGenerateImageBlocking("  a red bicycle  ");
    expect(execute).toHaveBeenCalledWith({
      pipe_code: "generate_image",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: { image_prompt: "a red bicycle" },
    });
    expect(result).toEqual({ ok: true, output: PARSED });
  });

  it("returns a bad_request error on empty input without calling the SDK", async () => {
    const result = await runGenerateImageBlocking("   ");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "bad_request", title: "Prompt required" }),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies a missing image URL as bad_image_output", async () => {
    execute.mockResolvedValueOnce({ pipeline_run_id: "run-1", main_stuff: { caption: "no url" } });
    const result = await runGenerateImageBlocking("a red bicycle");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("bad_image_output");
  });

  it("classifies SDK errors into a structured PipelineError", async () => {
    execute.mockRejectedValueOnce(
      new ApiUnreachableError("unreachable", "http://localhost:8081", "ECONNREFUSED"),
    );
    const result = await runGenerateImageBlocking("a red bicycle");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });
});

describe("startGenerateImageRun", () => {
  it("calls start with the bundle, pipe code, and trimmed prompt; returns the run id", async () => {
    start.mockResolvedValueOnce({ pipeline_run_id: "run-1" });
    const result = await startGenerateImageRun("  a red bicycle  ");
    expect(start).toHaveBeenCalledWith({
      pipe_code: "generate_image",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: { image_prompt: "a red bicycle" },
    });
    expect(result).toEqual({ ok: true, runId: "run-1" });
  });

  it("returns a bad_request error on empty input without calling start", async () => {
    const result = await startGenerateImageRun("   ");
    expect(result.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("pollGenerateImageRun", () => {
  it("narrows the completed durable result (main_stuff with non-web url + web public_url)", async () => {
    getRunStatus.mockResolvedValueOnce({ status: "COMPLETED", degraded: false });
    getRunResult.mockResolvedValueOnce({
      state: "completed",
      pipeline_run_id: "run-1",
      result: {
        pipeline_run_id: "run-1",
        main_stuff: {
          url: "pipelex-storage://user/results/run/assets/x.png",
          public_url: "https://s3.us-west-2.amazonaws.com/bucket/x.png?X-Amz-Signature=abc",
          mime_type: "image/png",
        },
      },
    });
    const result = await pollGenerateImageRun("run-1");
    expect(result.ok).toBe(true);
    if (!result.ok || result.state !== "completed") return;
    expect(result.output.publicUrl).toContain("https://s3");
  });
});
