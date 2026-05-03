import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError } from "mthds";

const executePipeline = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadHelloBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ executePipeline }),
}));

import { runHelloPipeline } from "./runHelloPipeline";

beforeEach(() => {
  executePipeline.mockReset();
});

describe("runHelloPipeline", () => {
  it("calls the SDK with the bundle, pipe code, and trimmed input on success", async () => {
    executePipeline.mockResolvedValue({
      pipeline_run_id: "run-1",
      pipe_output: {
        pipeline_run_id: "run-1",
        working_memory: {
          entities: { content: { people: ["Ada"], orgs: ["ACME"], dates: ["1843"] } },
        },
      },
    });

    const result = await runHelloPipeline("  hello world  ");

    expect(executePipeline).toHaveBeenCalledWith({
      pipe_code: "extract_entities",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: { text: "hello world" },
    });
    expect(result).toEqual({
      ok: true,
      entities: { people: ["Ada"], orgs: ["ACME"], dates: ["1843"] },
    });
  });

  it("returns a bad_request error on empty input without calling the SDK", async () => {
    const result = await runHelloPipeline("   ");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: "bad_request",
        title: "Input required",
      }),
    });
    expect(executePipeline).not.toHaveBeenCalled();
  });

  it("classifies SDK errors into a structured PipelineError", async () => {
    executePipeline.mockRejectedValue(
      new ApiUnreachableError(
        "Could not reach Pipelex API at http://localhost:8081 (ECONNREFUSED)",
        "http://localhost:8081",
        "ECONNREFUSED",
      ),
    );

    const result = await runHelloPipeline("some text");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
    expect(result.error.title).toBe("Pipelex API not reachable");
  });

  it("classifies unknown errors with the unknown fallback", async () => {
    executePipeline.mockRejectedValue(new Error("API down"));
    const result = await runHelloPipeline("some text");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unknown");
    expect(result.error.details).toContain("API down");
  });
});
