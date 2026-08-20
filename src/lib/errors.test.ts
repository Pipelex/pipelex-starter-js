import { describe, it, expect } from "vitest";
import {
  ApiResponseError,
  ApiUnreachableError,
  ClientAuthenticationError,
  InputPreparationError,
  InvalidLocalSourceError,
  PipelineExecuteTimeoutError,
  RejectedAssetError,
  RunFailedError,
  RunLifecycleUnavailableError,
  RunStillRunningError,
  RunTimeoutError,
  UnsupportedUploadCapabilityError,
  UploadAuthenticationError,
  UploadTransportError,
} from "@pipelex/sdk";
import { BadImageOutputError, BadPipelineOutputError } from "@/types/pipelineError";
import {
  buildClientTimeoutError,
  classifyPipelineError,
  classifyTransportError,
  type ClassifyEnv,
} from "./errors";

// An explicitly-set PIPELEX_BASE_URL override pointing somewhere that isn't
// the hosted API (a neutral fixture URL — nothing here documents a runnable
// setup), and the no-override default where the SDK falls back to the hosted
// URL on its own.
const OVERRIDE_ENV: ClassifyEnv = { apiUrl: "https://api.unreachable.example", hasApiKey: true };
const DEFAULT_ENV: ClassifyEnv = { apiUrl: undefined, hasApiKey: true };
const CLOUD_ENV: ClassifyEnv = { apiUrl: "https://api.pipelex.com", hasApiKey: true };

describe("classifyPipelineError — ApiUnreachableError", () => {
  it("steers to PIPELEX_BASE_URL when an override is set", () => {
    const err = new ApiUnreachableError(
      "Could not reach Pipelex API at https://api.unreachable.example (ECONNREFUSED)",
      "https://api.unreachable.example",
      "ECONNREFUSED",
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("api_unreachable");
    expect(result.title).toBe("Pipelex API not reachable");
    expect(result.message).toContain("ECONNREFUSED");
    expect(result.message).toContain("https://api.unreachable.example");
    expect(result.message).toMatch(/PIPELEX_BASE_URL/);
    expect(result.hint?.summary).toMatch(/PIPELEX_BASE_URL/);
    expect(result.hint?.code).toBe("PIPELEX_BASE_URL=https://api.pipelex.com");
    expect(result.hint?.codeLanguage).toBe("env");
  });

  it("steers to the network when no override is set (default hosted URL)", () => {
    const err = new ApiUnreachableError(
      "Could not reach Pipelex API at https://api.pipelex.com (ENOTFOUND)",
      "https://api.pipelex.com",
      "ENOTFOUND",
    );
    const result = classifyPipelineError(err, DEFAULT_ENV);
    expect(result.kind).toBe("api_unreachable");
    expect(result.message).toContain("https://api.pipelex.com");
    expect(result.message).toContain("ENOTFOUND");
    expect(result.message).toMatch(/default URL/);
    expect(result.message).toMatch(/network/i);
    // No override to check — the copy must not tell the user to verify a
    // variable they never set.
    expect(result.message).not.toMatch(/PIPELEX_BASE_URL is set/);
    expect(result.hint?.summary).toMatch(/network/i);
    expect(result.hint?.code).toContain("https://api.pipelex.com");
  });

  it("handles missing error code", () => {
    const err = new ApiUnreachableError(
      "Could not reach Pipelex API at https://api.unreachable.example (network error)",
      "https://api.unreachable.example",
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("api_unreachable");
    expect(result.message).not.toContain("undefined");
  });
});

describe("classifyPipelineError — ApiResponseError 401/403", () => {
  it("returns auth_missing when no key is set", () => {
    const err = new ApiResponseError(
      "API POST /endpoint failed (401): Invalid authentication token",
      "https://api.pipelex.com",
      401,
      "Unauthorized",
      JSON.stringify({ detail: "Invalid authentication token" }),
      undefined,
      "Invalid authentication token",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, {
      apiUrl: "https://api.pipelex.com",
      hasApiKey: false,
    });
    expect(result.kind).toBe("auth_missing");
    expect(result.title).toContain("missing");
    expect(result.hint?.code).toContain("PIPELEX_API_KEY");
  });

  it("returns auth_invalid when a key is present", () => {
    const err = new ApiResponseError(
      "API POST /endpoint failed (401): Invalid authentication token",
      "https://api.pipelex.com",
      401,
      "Unauthorized",
      JSON.stringify({ detail: "Invalid authentication token" }),
      undefined,
      "Invalid authentication token",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, {
      apiUrl: "https://api.pipelex.com",
      hasApiKey: true,
    });
    expect(result.kind).toBe("auth_invalid");
    expect(result.title).toContain("rejected");
  });

  it("treats 403 like 401", () => {
    const err = new ApiResponseError(
      "forbidden",
      "x",
      403,
      "Forbidden",
      "",
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, { apiUrl: "x", hasApiKey: true });
    expect(result.kind).toBe("auth_invalid");
  });
});

describe("classifyPipelineError — ApiResponseError 5xx with errorType", () => {
  it("special-cases CredentialsError", () => {
    const err = new ApiResponseError(
      "...",
      "https://api.unreachable.example",
      500,
      "Internal Server Error",
      "",
      "CredentialsError",
      "Missing OPENAI_API_KEY",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("server_error");
    expect(result.title).toContain("LLM credentials");
    expect(result.message).toContain("Missing OPENAI_API_KEY");
    // The hosted API never lacks provider credentials — the hint steers to the URL.
    expect(result.hint?.summary).toMatch(/PIPELEX_BASE_URL/);
    expect(result.hint?.docs?.href).toContain("docs.pipelex.com");
  });

  it("special-cases PipeOperatorModelAvailabilityError", () => {
    const err = new ApiResponseError(
      "...",
      "x",
      500,
      "",
      "",
      "PipeOperatorModelAvailabilityError",
      "no backend",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("server_error");
    expect(result.title).toContain("inference backend");
    expect(result.hint?.summary).toMatch(/PIPELEX_BASE_URL/);
  });

  it("special-cases bundle/pipe definition errors", () => {
    for (const errorType of [
      "PipeValidationError",
      "PipeFactoryError",
      "MthdsParserError",
      "MthdsDecodeError",
    ]) {
      const err = new ApiResponseError(
        "...",
        "x",
        500,
        "",
        "",
        errorType,
        `${errorType} message`,
        undefined,
        undefined,
      );
      const result = classifyPipelineError(err, OVERRIDE_ENV);
      expect(result.kind).toBe("server_error");
      expect(result.title).toContain("pipeline definition");
    }
  });

  it("falls through to generic server error for unknown errorType", () => {
    const err = new ApiResponseError(
      "...",
      "x",
      500,
      "",
      "",
      "MysteryError",
      "boom",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("server_error");
    expect(result.title).toContain("HTTP 500");
    expect(result.message).toContain("boom");
  });

  it("includes the endpoint URL, errorType, and serverMessage in details", () => {
    const err = new ApiResponseError(
      "...",
      "https://api.unreachable.example",
      500,
      "Internal Server Error",
      '{"detail":{"error_type":"X","message":"y"}}',
      "X",
      "y",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.details).toContain("API URL: https://api.unreachable.example");
    expect(result.details).toContain("error_type: X");
    expect(result.details).toContain("server message: y");
  });
});

describe("classifyPipelineError — ApiResponseError 4xx (non-auth)", () => {
  it("returns bad_request for 422", () => {
    const err = new ApiResponseError(
      "...",
      "x",
      422,
      "Unprocessable Entity",
      "",
      undefined,
      "missing field 'foo'",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("bad_request");
    expect(result.title).toContain("HTTP 422");
    expect(result.message).toBe("missing field 'foo'");
  });

  it("reframes a 400 StartRequiresAsyncOrchestration as a durable-execution error, keeping the API's own message", () => {
    const apiMsg =
      "Orchestration mode 'direct' cannot honor fire-and-forget delivery: /start requires an async-capable orchestration, and this deployment has none. Use /execute (synchronous) instead.";
    const err = new ApiResponseError(
      "...",
      "https://api.unreachable.example",
      400,
      "Bad Request",
      "",
      "StartRequiresAsyncOrchestration",
      apiMsg,
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    // Re-framed into the starter's vocabulary (durable execution), not a generic bad_request.
    expect(result.kind).toBe("lifecycle_unavailable");
    expect(result.title).toContain("Durable");
    expect(result.message).toContain("https://api.unreachable.example");
    expect(result.message).toMatch(/durable start/i);
    // The remedy is the URL, not a mode switch.
    expect(result.message).toMatch(/PIPELEX_BASE_URL/);
    // The API's verbatim message is preserved separately for the template to show.
    expect(result.apiMessage).toBe(apiMsg);
    expect(result.hint?.code).toContain("PIPELEX_BASE_URL");
    expect(result.details).toContain("error_type: StartRequiresAsyncOrchestration");
  });
});

describe("classifyPipelineError — ClientAuthenticationError", () => {
  it("returns config_missing", () => {
    const err = new ClientAuthenticationError("API base URL is required for API execution");
    const result = classifyPipelineError(err, { apiUrl: undefined, hasApiKey: false });
    expect(result.kind).toBe("config_missing");
    expect(result.hint?.code).toBe("cp .env.example .env.local");
  });
});

describe("classifyPipelineError — BadPipelineOutputError", () => {
  it("returns bad_response", () => {
    const err = new BadPipelineOutputError("missing field");
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("bad_response");
    expect(result.title).toContain("output");
    expect(result.details).toContain("BadPipelineOutputError");
    expect(result.details).toContain("missing field");
  });
});

describe("classifyPipelineError — BadImageOutputError", () => {
  it("returns bad_image_output", () => {
    const err = new BadImageOutputError("no image url");
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("bad_image_output");
    expect(result.title).toMatch(/image/i);
    expect(result.details).toContain("BadImageOutputError");
    expect(result.details).toContain("no image url");
  });

  it("steers to the hosted API when the image URL isn't web-accessible", () => {
    const err = new BadImageOutputError(
      'The pipeline returned an image at "file:///tmp/storage/abc.png", but a browser cannot load a file: URL.',
      { nonWebUrl: "file:///tmp/storage/abc.png" },
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("bad_image_output");
    expect(result.title).toMatch(/web-accessible/i);
    expect(result.message).toMatch(/PIPELEX_BASE_URL/);
    expect(result.hint?.code).toContain("PIPELEX_BASE_URL=https://api.pipelex.com");
    expect(result.details).toContain("file:///tmp/storage/abc.png");
  });
});

describe("classifyPipelineError — fs ENOENT", () => {
  it("returns bundle_load_failed", () => {
    const err = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("bundle_load_failed");
    expect(result.title).toContain("bundle");
    expect(result.message).toContain("ENOENT");
  });
});

describe("classifyPipelineError — unknown fallback", () => {
  it("returns unknown for plain Error", () => {
    const err = new Error("???");
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("unknown");
    expect(result.details).toContain("???");
  });

  it("returns unknown for non-Error throws", () => {
    const result = classifyPipelineError("a string was thrown", OVERRIDE_ENV);
    expect(result.kind).toBe("unknown");
    expect(result.details).toContain("a string was thrown");
  });
});

describe("classifyPipelineError — run-lifecycle errors", () => {
  it("classifies PipelineExecuteTimeoutError into execute_timeout pointing at Durable mode", () => {
    const result = classifyPipelineError(new PipelineExecuteTimeoutError(31_000), OVERRIDE_ENV);
    expect(result.kind).toBe("execute_timeout");
    expect(result.title).toMatch(/30s/);
    expect(result.hint?.summary).toMatch(/Durable/i);
  });

  it("maps a blocking-path 502/504 gateway response to execute_timeout", () => {
    for (const status of [502, 504]) {
      const err = new ApiResponseError(
        `API POST /v1/execute failed (${status})`,
        "https://api.pipelex.com",
        status,
        status === 502 ? "Bad Gateway" : "Gateway Timeout",
        "",
        undefined,
        "The runner did not complete the request (/execute).",
        undefined,
        undefined,
      );
      const result = classifyPipelineError(err, CLOUD_ENV, { blocking: true });
      expect(result.kind).toBe("execute_timeout");
      expect(result.message).toMatch(/30s/);
      expect(result.hint?.summary).toMatch(/Durable/i);
      expect(result.details).toContain("The runner did not complete the request");
    }
  });

  it("leaves a durable-path (non-blocking) 502 as a generic server_error", () => {
    const err = new ApiResponseError(
      "API GET /v1/runs/run-1/status failed (502)",
      "https://api.pipelex.com",
      502,
      "Bad Gateway",
      "",
      undefined,
      "Bad Gateway",
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, CLOUD_ENV);
    expect(result.kind).toBe("server_error");
  });

  it("classifies RunStillRunningError into run_still_running", () => {
    const result = classifyPipelineError(
      new RunStillRunningError("still running", "run-1", 5, "/v1/runs/run-1"),
      OVERRIDE_ENV,
    );
    expect(result.kind).toBe("run_still_running");
    expect(result.message).toContain("run-1");
    expect(result.details).toContain("Retry-After: 5s");
    expect(result.details).toContain("/v1/runs/run-1");
  });

  it("classifies RunFailedError into run_failed with the failure message", () => {
    const result = classifyPipelineError(
      new RunFailedError("boom", "run-1", "FAILED"),
      OVERRIDE_ENV,
    );
    expect(result.kind).toBe("run_failed");
    expect(result.message).toContain("boom");
    expect(result.details).toContain("run run-1 ended FAILED");
  });

  it("classifies RunTimeoutError into run_timeout", () => {
    const result = classifyPipelineError(
      new RunTimeoutError("timed out", "run-1", 1_200_000),
      OVERRIDE_ENV,
    );
    expect(result.kind).toBe("run_timeout");
    expect(result.message).toContain("run-1");
  });

  it("classifies RunLifecycleUnavailableError into lifecycle_unavailable pointing at the hosted API", () => {
    const result = classifyPipelineError(
      new RunLifecycleUnavailableError("no run store", "https://api.unreachable.example"),
      OVERRIDE_ENV,
    );
    expect(result.kind).toBe("lifecycle_unavailable");
    expect(result.message).toContain("https://api.unreachable.example");
    expect(result.message).toMatch(/PIPELEX_BASE_URL/);
    expect(result.hint?.summary).toMatch(/hosted Pipelex API/);
    expect(result.hint?.code).toContain("PIPELEX_BASE_URL");
  });
});

describe("classifyPipelineError — input-preparation (upload) errors", () => {
  it("classifies UnsupportedUploadCapabilityError into upload_failed pointing at the hosted API", () => {
    const err = new UnsupportedUploadCapabilityError("no /v1/upload route");
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.kind).toBe("upload_failed");
    expect(result.title).toMatch(/isn't available/i);
    expect(result.message).toContain("https://api.unreachable.example");
    expect(result.message).toMatch(/PIPELEX_BASE_URL/);
    expect(result.hint?.code).toContain("PIPELEX_BASE_URL");
  });

  it("classifies RejectedAssetError into upload_failed, surfacing the server's verbatim message", () => {
    const cause = new ApiResponseError(
      "...",
      "https://api.pipelex.com",
      413,
      "Payload Too Large",
      "",
      undefined,
      "asset exceeds the 50 MiB service limit",
      undefined,
      undefined,
    );
    const err = new RejectedAssetError("rejected big.pdf", "big.pdf", 413, { cause });
    const result = classifyPipelineError(err, CLOUD_ENV);
    expect(result.kind).toBe("upload_failed");
    expect(result.title).toMatch(/rejected/i);
    expect(result.message).toContain("413");
    expect(result.apiMessage).toBe("asset exceeds the 50 MiB service limit");
    expect(result.details).toContain("big.pdf");
  });

  it("classifies UploadAuthenticationError into upload_failed with the API-key hint", () => {
    const err = new UploadAuthenticationError("upload not authorized", 401);
    const result = classifyPipelineError(err, CLOUD_ENV);
    expect(result.kind).toBe("upload_failed");
    expect(result.title).toMatch(/not authorized/i);
    expect(result.hint?.code).toContain("PIPELEX_API_KEY");
  });

  it("classifies InvalidLocalSourceError and UploadTransportError as generic upload_failed", () => {
    for (const err of [
      new InvalidLocalSourceError("cannot read path", "/tmp/x.pdf"),
      new UploadTransportError("network fault"),
    ]) {
      const result = classifyPipelineError(err, CLOUD_ENV);
      expect(result.kind).toBe("upload_failed");
      expect(result.title).toMatch(/Preparing the PDF/i);
    }
  });

  it("falls back to generic upload_failed for the base InputPreparationError (e.g. a malformed data URL)", () => {
    const err = new InputPreparationError("Malformed data URL payload (invalid base64)");
    const result = classifyPipelineError(err, CLOUD_ENV);
    expect(result.kind).toBe("upload_failed");
    expect(result.details).toContain("Malformed data URL");
  });
});

describe("buildClientTimeoutError", () => {
  it("builds a run_timeout error from the client poll ceiling", () => {
    const result = buildClientTimeoutError(150_000);
    expect(result.kind).toBe("run_timeout");
    expect(result.title).toMatch(/Stopped waiting/i);
    expect(result.message).toContain("150s");
  });
});

describe("classifyTransportError", () => {
  it("returns transport_error for fetch-style TypeError rejections", () => {
    const err = new TypeError("Failed to fetch");
    const result = classifyTransportError(err);
    expect(result.kind).toBe("transport_error");
    expect(result.title).toMatch(/server/i);
    expect(result.details).toContain("TypeError");
    expect(result.details).toContain("Failed to fetch");
    expect(result.hint?.summary).toMatch(/[Rr]eload/);
  });

  it("includes the original Error name and message in details", () => {
    const err = Object.assign(new Error("connection reset"), { name: "AbortError" });
    const result = classifyTransportError(err);
    expect(result.details).toBe("AbortError: connection reset");
  });

  it("handles non-Error throws", () => {
    const result = classifyTransportError("disconnected");
    expect(result.kind).toBe("transport_error");
    expect(result.details).toContain("disconnected");
    expect(result.details).toContain("Unknown");
  });
});

describe("classifyPipelineError — details truncation", () => {
  it("truncates very long response bodies", () => {
    const huge = "x".repeat(5000);
    const err = new ApiResponseError(
      "...",
      "x",
      500,
      "",
      huge,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const result = classifyPipelineError(err, OVERRIDE_ENV);
    expect(result.details).toContain("truncated");
    expect(result.details.length).toBeLessThan(huge.length + 200);
  });
});
