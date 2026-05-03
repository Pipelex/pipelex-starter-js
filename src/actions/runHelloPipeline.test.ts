import { describe, it, expect, vi, beforeEach } from "vitest";

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
  it("calls the SDK with the bundle, pipe code, and trimmed input", async () => {
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
    expect(result).toEqual({ people: ["Ada"], orgs: ["ACME"], dates: ["1843"] });
  });

  it("throws on empty input without calling the SDK", async () => {
    await expect(runHelloPipeline("   ")).rejects.toThrow("Input text is required");
    expect(executePipeline).not.toHaveBeenCalled();
  });

  it("propagates SDK errors", async () => {
    executePipeline.mockRejectedValue(new Error("API down"));
    await expect(runHelloPipeline("some text")).rejects.toThrow("API down");
  });
});
