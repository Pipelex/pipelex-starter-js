import { describe, it, expect } from "vitest";
import { ApiResponseError, ApiUnreachableError, ClientAuthenticationError } from "mthds";
import { BadPipelineOutputError } from "@/types/helloPipeline";
import { classifyPipelineError, classifyTransportError, type ClassifyEnv } from "./errors";

const LOCAL_ENV: ClassifyEnv = { apiUrl: "http://localhost:8081", hasApiKey: true };
const CLOUD_ENV: ClassifyEnv = { apiUrl: "https://api.pipelex.com", hasApiKey: true };

describe("classifyPipelineError — ApiUnreachableError", () => {
  it("uses the localhost branch when apiUrl is local", () => {
    const err = new ApiUnreachableError(
      "Could not reach Pipelex API at http://localhost:8081 (ECONNREFUSED)",
      "http://localhost:8081",
      "ECONNREFUSED",
    );
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("api_unreachable");
    expect(result.title).toBe("Pipelex API not reachable");
    expect(result.message).toContain("ECONNREFUSED");
    expect(result.message).toContain("http://localhost:8081");
    expect(result.hint?.code).toBe("cd ../pipelex-api && make run");
    expect(result.hint?.codeLanguage).toBe("bash");
  });

  it("uses the cloud branch when apiUrl is not local", () => {
    const err = new ApiUnreachableError(
      "Could not reach Pipelex API at https://api.pipelex.com (ENOTFOUND)",
      "https://api.pipelex.com",
      "ENOTFOUND",
    );
    const result = classifyPipelineError(err, CLOUD_ENV);
    expect(result.kind).toBe("api_unreachable");
    expect(result.message).toContain("https://api.pipelex.com");
    expect(result.hint?.summary).toMatch(/PIPELEX_API_URL/);
    expect(result.hint?.code).toContain("https://api.pipelex.com");
  });

  it("handles missing error code", () => {
    const err = new ApiUnreachableError(
      "Could not reach Pipelex API at http://localhost:8081 (network error)",
      "http://localhost:8081",
      undefined,
    );
    const result = classifyPipelineError(err, LOCAL_ENV);
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
    );
    const result = classifyPipelineError(err, {
      apiUrl: "https://api.pipelex.com",
      hasApiKey: true,
    });
    expect(result.kind).toBe("auth_invalid");
    expect(result.title).toContain("rejected");
  });

  it("treats 403 like 401", () => {
    const err = new ApiResponseError("forbidden", "x", 403, "Forbidden", "", undefined, undefined);
    const result = classifyPipelineError(err, { apiUrl: "x", hasApiKey: true });
    expect(result.kind).toBe("auth_invalid");
  });
});

describe("classifyPipelineError — ApiResponseError 5xx with errorType", () => {
  it("special-cases CredentialsError", () => {
    const err = new ApiResponseError(
      "...",
      "http://localhost:8081",
      500,
      "Internal Server Error",
      "",
      "CredentialsError",
      "Missing OPENAI_API_KEY",
    );
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("server_error");
    expect(result.title).toContain("LLM credentials");
    expect(result.message).toContain("Missing OPENAI_API_KEY");
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
    );
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("server_error");
    expect(result.title).toContain("inference backend");
  });

  it("special-cases bundle/pipe definition errors", () => {
    for (const errorType of [
      "PipeValidationError",
      "PipeFactoryError",
      "PipelexInterpreterError",
      "MthdsDecodeError",
    ]) {
      const err = new ApiResponseError("...", "x", 500, "", "", errorType, `${errorType} message`);
      const result = classifyPipelineError(err, LOCAL_ENV);
      expect(result.kind).toBe("server_error");
      expect(result.title).toContain("pipeline definition");
    }
  });

  it("falls through to generic server error for unknown errorType", () => {
    const err = new ApiResponseError("...", "x", 500, "", "", "MysteryError", "boom");
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("server_error");
    expect(result.title).toContain("HTTP 500");
    expect(result.message).toContain("boom");
  });

  it("includes errorType and serverMessage in details", () => {
    const err = new ApiResponseError(
      "...",
      "x",
      500,
      "Internal Server Error",
      '{"detail":{"error_type":"X","message":"y"}}',
      "X",
      "y",
    );
    const result = classifyPipelineError(err, LOCAL_ENV);
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
    );
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("bad_request");
    expect(result.title).toContain("HTTP 422");
    expect(result.message).toBe("missing field 'foo'");
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
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("bad_response");
    expect(result.title).toContain("output");
    expect(result.details).toContain("BadPipelineOutputError");
    expect(result.details).toContain("missing field");
  });
});

describe("classifyPipelineError — fs ENOENT", () => {
  it("returns bundle_load_failed", () => {
    const err = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("bundle_load_failed");
    expect(result.title).toContain("bundle");
    expect(result.message).toContain("ENOENT");
  });
});

describe("classifyPipelineError — unknown fallback", () => {
  it("returns unknown for plain Error", () => {
    const err = new Error("???");
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.kind).toBe("unknown");
    expect(result.details).toContain("???");
  });

  it("returns unknown for non-Error throws", () => {
    const result = classifyPipelineError("a string was thrown", LOCAL_ENV);
    expect(result.kind).toBe("unknown");
    expect(result.details).toContain("a string was thrown");
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
    const err = new ApiResponseError("...", "x", 500, "", huge, undefined, undefined);
    const result = classifyPipelineError(err, LOCAL_ENV);
    expect(result.details).toContain("truncated");
    expect(result.details.length).toBeLessThan(huge.length + 200);
  });
});
