import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError } from "@pipelex/sdk";

const execute = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadGenerateImageBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute }),
}));

import { runGenerateImagePipeline } from "./runGenerateImagePipeline";

beforeEach(() => {
  execute.mockReset();
});

describe("runGenerateImagePipeline", () => {
  it("calls the SDK with the bundle, pipe code, and trimmed prompt on success", async () => {
    execute.mockResolvedValue({
      pipeline_run_id: "run-1",
      pipe_output: {
        pipeline_run_id: "run-1",
        working_memory: {
          root: {
            image: {
              concept: "native.Image",
              content: { url: "https://cdn.pipelex.com/x.png", mime_type: "image/png" },
            },
          },
          aliases: {},
        },
      },
    });

    const result = await runGenerateImagePipeline("  a red bicycle  ");

    expect(execute).toHaveBeenCalledWith({
      pipe_code: "generate_image",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: { image_prompt: "a red bicycle" },
    });
    expect(result).toEqual({
      ok: true,
      image: {
        url: "https://cdn.pipelex.com/x.png",
        publicUrl: null,
        mimeType: "image/png",
        caption: null,
      },
    });
  });

  it("returns a bad_request error on empty input without calling the SDK", async () => {
    const result = await runGenerateImagePipeline("   ");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "bad_request", title: "Prompt required" }),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies SDK errors into a structured PipelineError", async () => {
    execute.mockRejectedValue(
      new ApiUnreachableError("unreachable", "http://localhost:8081", "ECONNREFUSED"),
    );
    const result = await runGenerateImagePipeline("a red bicycle");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });

  it("classifies a missing image URL as bad_image_output", async () => {
    execute.mockResolvedValue({
      pipeline_run_id: "run-1",
      pipe_output: {
        pipeline_run_id: "run-1",
        working_memory: { root: { image: { content: { caption: "no url" } } }, aliases: {} },
      },
    });
    const result = await runGenerateImagePipeline("a red bicycle");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("bad_image_output");
  });
});
