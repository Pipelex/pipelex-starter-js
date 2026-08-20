import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiUnreachableError } from "@pipelex/sdk";

const execute = vi.fn();
const start = vi.fn();
const getRunStatus = vi.fn();
const getRunResult = vi.fn();

vi.mock("@/lib/loadBundle", () => ({
  loadExtractEntitiesBundle: vi.fn().mockResolvedValue("DUMMY_BUNDLE_TOML"),
}));

vi.mock("@/lib/pipelexClient", () => ({
  getPipelexClient: () => ({ execute, start, getRunStatus, getRunResult }),
}));

import {
  pollExtractEntitiesRun,
  runExtractEntitiesBlocking,
  startExtractEntitiesRun,
} from "./runExtractEntitiesPipeline";

beforeEach(() => {
  execute.mockReset();
  start.mockReset();
  getRunStatus.mockReset();
  getRunResult.mockReset();
});

const ENTITIES = { people: ["Ada"], orgs: ["ACME"], dates: ["1843"] };

// Blocking execute returns a PipelexExecuteResult with the resolved `main_stuff`.
const BLOCKING_RESPONSE = { pipeline_run_id: "run-1", main_stuff: ENTITIES };
// Durable completed result returns the same bare `main_stuff` content.
const COMPLETED_RESULT = { pipeline_run_id: "run-1", main_stuff: ENTITIES };

describe("runExtractEntitiesBlocking", () => {
  it("calls execute with the bundle, pipe code, and trimmed input; returns narrowed output", async () => {
    execute.mockResolvedValueOnce(BLOCKING_RESPONSE);
    const result = await runExtractEntitiesBlocking("  entity text  ");
    expect(execute).toHaveBeenCalledWith({
      pipe_code: "extract_entities",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: { text: "entity text" },
    });
    // `toMatchObject`: these tests assert delegation + narrowed output; the `usage`
    // sibling now on the outcome is covered in the helper/model tests.
    expect(result).toMatchObject({ ok: true, output: ENTITIES });
  });

  it("returns a bad_request error on empty input without calling the SDK", async () => {
    const result = await runExtractEntitiesBlocking("   ");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "bad_request", title: "Input required" }),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies SDK errors into a structured PipelineError", async () => {
    execute.mockRejectedValueOnce(
      new ApiUnreachableError("unreachable", "https://api.unreachable.example", "ECONNREFUSED"),
    );
    const result = await runExtractEntitiesBlocking("some text");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api_unreachable");
  });
});

describe("startExtractEntitiesRun", () => {
  it("calls start with the bundle, pipe code, and trimmed input; returns the run id", async () => {
    start.mockResolvedValueOnce({ pipeline_run_id: "run-1" });
    const result = await startExtractEntitiesRun("  entity text  ");
    expect(start).toHaveBeenCalledWith({
      pipe_code: "extract_entities",
      mthds_contents: ["DUMMY_BUNDLE_TOML"],
      inputs: { text: "entity text" },
    });
    expect(result).toEqual({ ok: true, runId: "run-1" });
  });

  it("returns a bad_request error on empty input without calling start", async () => {
    const result = await startExtractEntitiesRun("   ");
    expect(result.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("pollExtractEntitiesRun", () => {
  it("narrows the completed durable result (main_stuff)", async () => {
    getRunStatus.mockResolvedValueOnce({ status: "COMPLETED", degraded: false });
    getRunResult.mockResolvedValueOnce({
      state: "completed",
      pipeline_run_id: "run-1",
      result: COMPLETED_RESULT,
    });
    const result = await pollExtractEntitiesRun("run-1");
    expect(getRunStatus).toHaveBeenCalledWith("run-1");
    expect(result).toMatchObject({ ok: true, state: "completed", output: ENTITIES });
  });

  it("reports running while the status is non-terminal", async () => {
    getRunStatus.mockResolvedValueOnce({
      status: "RUNNING",
      degraded: false,
      retry_after_seconds: null,
    });
    const result = await pollExtractEntitiesRun("run-1");
    expect(result).toMatchObject({ ok: true, state: "running", status: "RUNNING" });
    expect(getRunResult).not.toHaveBeenCalled();
  });
});
