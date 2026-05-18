import { ApiResponseError, ApiUnreachableError, ClientAuthenticationError } from "mthds";
import { BadImageOutputError, BadPipelineOutputError } from "@/types/pipelineError";

export type PipelineErrorKind =
  | "api_unreachable"
  | "config_missing"
  | "auth_missing"
  | "auth_invalid"
  | "bad_request"
  | "server_error"
  | "bundle_load_failed"
  | "bad_response"
  | "bad_image_output"
  | "transport_error"
  // Pre-flight validation kinds: built inline by a Server Action before the
  // SDK call (see `runSummarizePdfPipeline` / `fileInputErrorToPipelineError`),
  // never produced by `classifyPipelineError` — there is no thrown error to
  // classify. They are still valid kinds so `<ErrorDisplay>` renders them.
  | "file_too_large"
  | "unsupported_file_type"
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
  if (err instanceof BadImageOutputError) return classifyBadImageOutput(err);
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
      "The pipeline ran but its output didn't match the shape this example expects. This usually means the bundle was edited or the LLM produced something unexpected.",
    details: `${err.name}: ${err.message}`,
  };
}

function classifyBadImageOutput(err: BadImageOutputError): PipelineError {
  if (err.nonWebUrl) {
    return {
      kind: "bad_image_output",
      title: "Generated image isn't web-accessible",
      message:
        "The pipeline generated an image, but the Pipelex API returned a URL a browser can't load — typically a file:// path on the API server's disk. This happens when the API uses the local file storage provider.",
      hint: {
        summary:
          "Configure the Pipelex API with an S3 or GCP storage provider so it returns presigned HTTPS URLs, or point PIPELEX_API_URL at the hosted API. Set this in pipelex-api's .pipelex/pipelex.toml:",
        code: '[storage]\nmethod = "s3"  # or "gcp"',
        codeLanguage: "env",
        docs: { label: "Pipelex storage configuration", href: "https://docs.pipelex.com/" },
      },
      details: `${err.name}: ${err.message}`,
    };
  }
  return {
    kind: "bad_image_output",
    title: "Image generation returned no usable image",
    message:
      "The pipeline ran but its output didn't contain an image URL. The image model may have refused the prompt or returned an unexpected shape.",
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

/**
 * Classify a client-side rejection of an awaited Server Action call.
 *
 * Distinct from `classifyPipelineError`: the Server Action's own try/catch
 * already routes every application-level failure into a structured
 * `{ ok: false, error }` result, so a rejected await here is by construction
 * a *transport* failure — the browser couldn't deliver the request, the dev
 * server died mid-call, or the page is running against a stale build whose
 * Server Action IDs no longer resolve. The SDK error classes referenced by
 * `classifyPipelineError` only exist server-side and are stripped to opaque
 * digests when crossing the boundary in production, so they would never
 * `instanceof`-match here. Without this helper, rejections inside
 * `startTransition` bypass `<ErrorDisplay>` and bubble to React's nearest
 * error boundary instead.
 */
export function classifyTransportError(err: unknown): PipelineError {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Unknown";
  return {
    kind: "transport_error",
    title: "Could not reach the server",
    message:
      "The browser couldn't deliver the request to the Next.js server. The dev server may have stopped, the network may have dropped, or this page may be running against a stale build whose Server Action IDs no longer exist on the deployed server.",
    hint: {
      summary:
        "Reload the page. If the problem persists, check your network and confirm the server is reachable.",
    },
    details: `${name}: ${message}`,
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
