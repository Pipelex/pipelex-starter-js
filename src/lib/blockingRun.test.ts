import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiResponseError, ApiUnreachableError } from "@pipelex/sdk";

const execute = vi.fn();

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute }),
}));

import { executeBlockingRun } from "./blockingRun";
import { parseEntities } from "@/types/extractEntitiesPipeline";
import { parseGeneratedImage } from "@/types/generateImagePipeline";

beforeEach(() => execute.mockReset());

const OPTIONS = {
  pipe_code: "extract_entities",
  mthds_contents: ["BUNDLE"],
  inputs: { text: "x" },
};

describe("executeBlockingRun", () => {
  it("calls execute with the built options, adapts the response to RunResults, and narrows it", async () => {
    // `execute` returns a PipelexExecuteResult whose `.main_stuff` the SDK has already
    // resolved out of the working memory — the blocking path reads it like the durable one.
    execute.mockResolvedValueOnce({
      pipeline_run_id: "run-1",
      main_stuff: { people: ["Ada"], orgs: [], dates: [] },
    });

    const result = await executeBlockingRun(async () => OPTIONS, parseEntities);

    expect(execute).toHaveBeenCalledWith(OPTIONS);
    expect(result).toEqual({ ok: true, output: { people: ["Ada"], orgs: [], dates: [] } });
  });

  it("classifies a thrown SDK error", async () => {
    execute.mockRejectedValueOnce(
      new ApiUnreachableError("unreachable", "http://localhost:8081", "ECONNREFUSED"),
    );
    const result = await executeBlockingRun(async () => OPTIONS, parseEntities);
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
    const result = await executeBlockingRun(async () => OPTIONS, parseEntities);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("execute_timeout");
  });

  it("classifies a narrower throw (image content with no URL) as bad_image_output", async () => {
    execute.mockResolvedValueOnce({
      pipeline_run_id: "run-1",
      main_stuff: { caption: "no url" },
    });
    const result = await executeBlockingRun(async () => OPTIONS, parseGeneratedImage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("bad_image_output");
  });
});
