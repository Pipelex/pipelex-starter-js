import { ApiResponseError, ApiUnreachableError, ClientAuthenticationError } from "mthds";
import { BadPipelineOutputError } from "@/types/helloPipeline";

export type PipelineErrorKind =
  | "api_unreachable"
  | "config_missing"
  | "auth_missing"
  | "auth_invalid"
  | "bad_request"
  | "server_error"
  | "bundle_load_failed"
  | "bad_response"
  | "unknown";

export interface ErrorHint {
  summary: string;
  /** Optional inline code/command snippet rendered in a `<pre>` block. */
  code?: string;
  codeLanguage?: "bash" | "env" | "json";
  docs?: { label: string; href: string };
}

export interface PipelineError {
  kind: PipelineErrorKind;
  /** Headline, e.g. "Pipelex API not reachable". */
  title: string;
  /** 1–2 sentences explaining what happened in plain language. */
  message: string;
  hint?: ErrorHint;
  /** Raw technical info for the collapsible "Technical details" section. */
  details: string;
}

export interface ClassifyEnv {
  apiUrl: string | undefined;
  hasApiKey: boolean;
}

export function classifyPipelineError(err: unknown, env: ClassifyEnv): PipelineError {
  if (err instanceof ApiUnreachableError) return classifyUnreachable(err, env);
  if (err instanceof ApiResponseError) return classifyResponse(err, env);
  if (err instanceof ClientAuthenticationError) return classifyClientAuth(err, env);
  if (err instanceof BadPipelineOutputError) return classifyBadOutput(err);
  if (isFsNotFound(err)) return classifyBundleMissing(err);
  return classifyUnknown(err);
}

function classifyUnreachable(err: ApiUnreachableError, env: ClassifyEnv): PipelineError {
  const url = err.apiUrl || env.apiUrl || "(unknown)";
  const isLocal = isLocalhostUrl(url);
  const codeSuffix = err.code ? ` (${err.code})` : "";
  const baseDetails = `${err.name}: ${err.message}${err.cause instanceof Error ? `\nCaused by: ${err.cause.message}` : ""}`;

  if (isLocal) {
    return {
      kind: "api_unreachable",
      title: "Pipelex API not reachable",
      message: `Tried to reach the local API at ${url}${codeSuffix}, but nothing answered. The starter expects pipelex-api to be running on the same host.`,
      hint: {
        summary: "Start the local Pipelex API in a sibling repo, then retry:",
        code: "cd ../pipelex-api && make run",
        codeLanguage: "bash",
      },
      details: baseDetails,
    };
  }

  return {
    kind: "api_unreachable",
    title: "Pipelex API not reachable",
    message: `Tried to reach ${url}${codeSuffix}, but the request did not get a response. Check the URL and your network connection.`,
    hint: {
      summary: "Verify PIPELEX_API_URL in .env.local points to a reachable API.",
      code: `PIPELEX_API_URL=${url}`,
      codeLanguage: "env",
    },
    details: baseDetails,
  };
}

function classifyResponse(err: ApiResponseError, env: ClassifyEnv): PipelineError {
  const detailsLines = [
    `${err.name}: HTTP ${err.status} ${err.statusText}`.trim(),
    err.errorType ? `error_type: ${err.errorType}` : null,
    err.serverMessage ? `server message: ${err.serverMessage}` : null,
    err.responseBody ? `body: ${truncate(err.responseBody, 2000)}` : null,
  ].filter(Boolean) as string[];
  const details = detailsLines.join("\n");

  if (err.status === 401 || err.status === 403) {
    if (!env.hasApiKey) {
      return {
        kind: "auth_missing",
        title: "Pipelex API key missing",
        message: `${err.apiUrl} rejected the request because no PIPELEX_API_KEY was sent.`,
        hint: {
          summary: "Add your API key to .env.local and restart the dev server:",
          code: "PIPELEX_API_KEY=your-key-here",
          codeLanguage: "env",
        },
        details,
      };
    }
    return {
      kind: "auth_invalid",
      title: "Pipelex API key rejected",
      message: `${err.apiUrl} returned ${err.status} for the credentials you provided. The PIPELEX_API_KEY in .env.local is not valid for this API.`,
      hint: {
        summary: "Double-check the key and the API URL it's intended for.",
        code: "PIPELEX_API_KEY=your-key-here",
        codeLanguage: "env",
      },
      details,
    };
  }

  if (err.status >= 500) {
    return classifyServerError(err, details);
  }

  return {
    kind: "bad_request",
    title: `Pipelex API rejected the request (HTTP ${err.status})`,
    message:
      err.serverMessage ?? "The API returned a client error. Inspect the request and try again.",
    details,
  };
}

function classifyServerError(err: ApiResponseError, details: string): PipelineError {
  const baseTitle = `Pipelex API server error (HTTP ${err.status})`;
  switch (err.errorType) {
    case "CredentialsError":
      return {
        kind: "server_error",
        title: "Pipelex server is missing LLM credentials",
        message:
          err.serverMessage ??
          "The Pipelex backend tried to call an LLM provider but no API key was configured for it.",
        hint: {
          summary: "Set the missing provider key in pipelex-api's .env, then restart the API.",
          docs: { label: "Pipelex inference setup docs", href: "https://docs.pipelex.com/" },
        },
        details,
      };
    case "PipeOperatorModelAvailabilityError":
      return {
        kind: "server_error",
        title: "No inference backend configured on the server",
        message:
          err.serverMessage ??
          "The Pipelex backend has no LLM inference backend wired up to handle this pipe.",
        hint: {
          summary: "Configure an inference backend in pipelex-api (Pipelex Gateway or BYO key).",
          docs: { label: "Pipelex inference setup docs", href: "https://docs.pipelex.com/" },
        },
        details,
      };
    case "PipeValidationError":
    case "PipeFactoryError":
    case "PipelexInterpreterError":
    case "MthdsDecodeError":
      return {
        kind: "server_error",
        title: "The pipeline definition has a problem",
        message:
          err.serverMessage ??
          "The Pipelex server rejected the bundle or pipe definition. The bundle shipped with the starter may be out of sync with the server's version of the spec.",
        details,
      };
    default:
      return {
        kind: "server_error",
        title: baseTitle,
        message:
          err.serverMessage ??
          `The API returned an unexpected error${err.errorType ? ` (${err.errorType})` : ""}.`,
        details,
      };
  }
}

function classifyClientAuth(err: ClientAuthenticationError, env: ClassifyEnv): PipelineError {
  void env;
  return {
    kind: "config_missing",
    title: "Pipelex API URL not configured",
    message:
      "The mthds SDK needs PIPELEX_API_URL to know where to send pipeline requests, but it isn't set.",
    hint: {
      summary: "Copy .env.example to .env.local and fill it in:",
      code: "cp .env.example .env.local",
      codeLanguage: "bash",
    },
    details: `${err.name}: ${err.message}`,
  };
}

function classifyBadOutput(err: BadPipelineOutputError): PipelineError {
  return {
    kind: "bad_response",
    title: "Pipeline output didn't match the expected shape",
    message:
      "The pipeline ran but its output didn't contain ExtractedEntities. This usually means the bundle was edited or the LLM produced something unexpected.",
    details: `${err.name}: ${err.message}`,
  };
}

function classifyBundleMissing(err: unknown): PipelineError {
  const e = err as NodeJS.ErrnoException;
  return {
    kind: "bundle_load_failed",
    title: "Pipeline bundle not found",
    message: `Could not read the .mthds bundle from disk (${e.code ?? "fs error"}). The starter ships with extract_entities.mthds — make sure it's still there.`,
    details: `${e.name}: ${e.message}`,
  };
}

function classifyUnknown(err: unknown): PipelineError {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Unknown";
  return {
    kind: "unknown",
    title: "Something went wrong",
    message:
      "The starter caught an unexpected error. The technical details below should help track it down.",
    details: `${name}: ${message}`,
  };
}

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
  } catch {
    return false;
  }
}

function isFsNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (truncated)`;
}
