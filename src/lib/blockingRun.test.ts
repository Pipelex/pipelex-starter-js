import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiResponseError, ApiUnreachableError, type RunResults } from "@pipelex/sdk";

const execute = vi.fn();

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute }),
}));

import { executeBlockingRun } from "./blockingRun";
import { BadImageOutputError, BadPipelineOutputError } from "@/types/pipelineError";

beforeEach(() => execute.mockReset());

const OPTIONS = {
  pipe_code: "extract_entities",
  mthds_contents: ["BUNDLE"],
  inputs: { text: "x" },
};

// Inline fixture narrowers, so the shared-helper tests import no removable
// example's adapter (the examples stay deletable without touching this file).
// They honor the real `parseXxx` contract: read `main_stuff`, throw a tagged
// error on shape mismatch.
type FixtureOutput = { items: string[] };

function parseFixture(results: RunResults): FixtureOutput {
  const stuff = results.main_stuff;
  if (typeof stuff !== "object" || stuff === null || !("items" in stuff)) {
    throw new BadPipelineOutputError("fixture output is missing `items`");
  }
  return stuff as FixtureOutput;
}

function parseImageFixture(results: RunResults): { url: string } {
  const stuff = results.main_stuff;
  if (typeof stuff !== "object" || stuff === null || !("url" in stuff)) {
    throw new BadImageOutputError("fixture image output has no url");
  }
  return stuff as { url: string };
}

describe("executeBlockingRun", () => {
  it("calls execute with the built options, adapts the response to RunResults, and narrows it", async () => {
    // `execute` returns a PipelexExecuteResult whose `.main_stuff` the SDK has already
    // resolved out of the working memory — the blocking path reads it like the durable one.
    execute.mockResolvedValueOnce({
      pipeline_run_id: "run-1",
      main_stuff: { items: ["Ada"] },
    });

    const result = await executeBlockingRun(async () => OPTIONS, parseFixture);

    expect(execute).toHaveBeenCalledWith(OPTIONS);
    // No `pipe_output` on the response → the usage pair is absent → "unavailable".
    expect(result).toEqual({
      ok: true,
      output: { items: ["Ada"] },
      usage: {
        calls: [],
        totalCostUsd: null,
        hasCost: false,
        state: "unavailable",
        assemblyError: null,
      },
    });
  });

  it("lifts tokens_usages off the execute response's pipe_output into the usage report", async () => {
    // On the blocking path the usage pair rides the extension-open `pipe_output`;
    // the adapter lifts it onto RunResults so `buildUsageReport` reads it like durable.
    execute.mockResolvedValueOnce({
      pipeline_run_id: "run-1",
      main_stuff: { items: ["Ada"] },
      pipe_output: {
        pipeline_run_id: "run-1",
        working_memory: { root: {}, aliases: {} },
        tokens_usages: [
          {
            inference_model_name: "gpt-4o",
            pipe_code: "extract_entities",
            nb_tokens_by_category: { input: 10, output: 5 },
            cost: 0.001,
          },
        ],
        usage_assembly_error: null,
      },
    });

    const result = await executeBlockingRun(async () => OPTIONS, parseFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage.state).toBe("records");
    expect(result.usage.totalCostUsd).toBeCloseTo(0.001);
    expect(result.usage.calls[0].modelName).toBe("gpt-4o");
  });

  it("classifies a thrown SDK error", async () => {
    execute.mockRejectedValueOnce(
      new ApiUnreachableError("unreachable", "http://localhost:8081", "ECONNREFUSED"),
    );
    const result = await executeBlockingRun(async () => OPTIONS, parseFixture);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });

  it("maps the gateway's 502 cap response to execute_timeout (the real blocking cap)", async () => {
    execute.mockRejectedValueOnce(
      new ApiResponseError(
        "API POST /v1/execute failed (502)",
        "https://api.pipelex.com",
        502,
        "Bad Gateway",
        "",
        undefined,
        "The runner did not complete the request (/execute).",
        undefined,
        undefined,
      ),
    );
    const result = await executeBlockingRun(async () => OPTIONS, parseFixture);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("execute_timeout");
  });

  it("classifies a narrower throw (image content with no URL) as bad_image_output", async () => {
    execute.mockResolvedValueOnce({
      pipeline_run_id: "run-1",
      main_stuff: { caption: "no url" },
    });
    const result = await executeBlockingRun(async () => OPTIONS, parseImageFixture);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("bad_image_output");
  });
});
