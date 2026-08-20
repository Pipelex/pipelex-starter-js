// Import the SDK error classes from the `@pipelex/sdk` barrel. This module is
// bundled into the client (client components import `classifyTransportError`
// and the `PipelineError` type from here), so it must carry no Node built-ins.
// The barrel is client-safe: `PipelexApiClient` is fetch-based and nothing in
// the graph pulls `node:fs`/`node:path`, so a client bundler handles it without
// breaking `make build`. Only `pipelexClient.ts` (server-only) constructs the
// client itself.
import {
  ApiResponseError,
  ApiUnreachableError,
  ClientAuthenticationError,
  InputPreparationError,
  PipelineExecuteTimeoutError,
  RejectedAssetError,
  RunFailedError,
  RunLifecycleUnavailableError,
  RunStillRunningError,
  RunTimeoutError,
  UnsupportedUploadCapabilityError,
  UploadAuthenticationError,
} from "@pipelex/sdk";
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
  // Dual-mode run-lifecycle kinds. `execute_timeout` / `run_still_running`
  // come from the **blocking** path (the hosted gateway's ~30s cap); the rest
  // from the **durable** path (start + poll). All are produced by
  // `classifyPipelineError` from the matching SDK error class, except
  // `run_timeout`, which is also built inline by the client poll ceiling
  // (`buildClientTimeoutError`).
  | "execute_timeout"
  | "run_still_running"
  | "run_failed"
  | "run_timeout"
  | "lifecycle_unavailable"
  // Input-preparation / upload failure from the SDK's `prepareInputs` — the PDF
  // path uploads the file to Pipelex storage before the run, and that upload can
  // fail in a few distinct, actionable ways. Classified from `InputPreparationError`
  // and its subclasses into one kind with subclass-tailored copy.
  | "upload_failed"
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
  /**
   * The verbatim message the Pipelex API returned, when our `message` is a
   * *re-framing* of it (e.g. a runtime-vocabulary error we restate in the
   * starter's own terms). Rendered as its own block next to our interpretation
   * so the template demonstrates raw-API-response vs. handled-error UX side by
   * side. Omitted when our `message` already is the server's text (no value in
   * showing it twice).
   */
  apiMessage?: string;
  hint?: ErrorHint;
  /** Raw technical info for the collapsible "Technical details" section. */
  details: string;
}

export interface ClassifyEnv {
  apiUrl: string | undefined;
  hasApiKey: boolean;
}

export interface ClassifyOptions {
  /**
   * Set by the blocking path (`executeBlockingRun`). Behind the hosted gateway a
   * synchronous `execute` that overruns the ~30s cap comes back as a 502/504
   * "the runner did not complete the request" — a *response*, so the SDK raises
   * `ApiResponseError`, not its own `PipelineExecuteTimeoutError` (the SDK's
   * client-side timeout is longer than the gateway's). Only on the blocking path
   * is that gateway error the cap; on the durable poll path a 502/504 is a
   * transient server hiccup, so this flag scopes the mapping correctly.
   */
  blocking?: boolean;
}

export function classifyPipelineError(
  err: unknown,
  env: ClassifyEnv,
  opts?: ClassifyOptions,
): PipelineError {
  if (err instanceof ApiUnreachableError) return classifyUnreachable(err, env);
  if (err instanceof ApiResponseError) {
    if (opts?.blocking && (err.status === 502 || err.status === 504)) {
      return classifyBlockingGatewayTimeout(err);
    }
    return classifyResponse(err, env);
  }
  if (err instanceof ClientAuthenticationError) return classifyClientAuth(err, env);
  // Run-lifecycle errors (both extend the protocol's PipelineRequestError, but
  // are distinct concrete classes, so order among them is irrelevant).
  if (err instanceof PipelineExecuteTimeoutError) return classifyExecuteTimeout(err);
  if (err instanceof RunStillRunningError) return classifyRunStillRunning(err);
  if (err instanceof RunFailedError) return classifyRunFailed(err);
  if (err instanceof RunTimeoutError) return classifyRunTimeout(err);
  if (err instanceof RunLifecycleUnavailableError) return classifyLifecycleUnavailable(err, env);
  if (err instanceof InputPreparationError) return classifyInputPreparationError(err, env);
  if (err instanceof BadImageOutputError) return classifyBadImageOutput(err);
  if (err instanceof BadPipelineOutputError) return classifyBadOutput(err);
  if (isFsNotFound(err)) return classifyBundleMissing(err);
  return classifyUnknown(err);
}

function classifyUnreachable(err: ApiUnreachableError, env: ClassifyEnv): PipelineError {
  const url = err.apiUrl || env.apiUrl || "(unknown)";
  const codeSuffix = err.code ? ` (${err.code})` : "";
  const baseDetails = `${err.name}: ${err.message}${err.cause instanceof Error ? `\nCaused by: ${err.cause.message}` : ""}`;

  // Split on whether PIPELEX_BASE_URL was explicitly set (`env.apiUrl` is that
  // variable, undefined when unset). With an override in play, the URL is the
  // first suspect; without one, telling the user to check a variable they never
  // set would only confuse — the default hosted URL didn't answer, so point at
  // the network first.
  if (env.apiUrl !== undefined) {
    return {
      kind: "api_unreachable",
      title: "Pipelex API not reachable",
      message: `Tried to reach ${url}${codeSuffix}, but the request did not get a response. PIPELEX_BASE_URL is set, so start there: make sure it targets a Pipelex API environment.`,
      hint: {
        summary:
          "Verify PIPELEX_BASE_URL in .env.local targets a Pipelex API environment, or remove the override to fall back to the default:",
        code: "PIPELEX_BASE_URL=https://api.pipelex.com",
        codeLanguage: "env",
      },
      details: baseDetails,
    };
  }

  return {
    kind: "api_unreachable",
    title: "Pipelex API not reachable",
    message: `Tried to reach the Pipelex API at its default URL, ${url}${codeSuffix}, but the request did not get a response. Check your network connection.`,
    hint: {
      summary: "Check your network connection, then retry. The URL the app is using is:",
      code: `PIPELEX_BASE_URL=${url}`,
      codeLanguage: "env",
    },
    details: baseDetails,
  };
}

function classifyResponse(err: ApiResponseError, env: ClassifyEnv): PipelineError {
  // `/start` reached a backend that *has* the route but whose orchestrator is
  // blocking-only (the in-process `direct` mode), so it refused the durable
  // start with a 400. Surface it in durable-execution terms — see
  // `classifyStartRequiresAsync` — instead of letting the raw runtime-vocabulary
  // server message fall through as a generic `bad_request`.
  if (err.errorType === START_REQUIRES_ASYNC_ORCHESTRATION) {
    return classifyStartRequiresAsync(err);
  }

  const detailsLines = [
    `${err.name}: HTTP ${err.status} ${err.statusText}`.trim(),
    // Always surface which endpoint was hit — URLs change often in dev, and a
    // 4xx/5xx otherwise gives no hint about *which* backend rejected the call.
    err.apiUrl ? `API URL: ${err.apiUrl}` : null,
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
          summary:
            "The Pipelex hosted API always has its providers configured, so this indicates the API at PIPELEX_BASE_URL isn't it (or a non-production environment is mid-configuration) — verify the URL.",
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
          summary:
            "The Pipelex hosted API always has an inference backend, so this indicates the API at PIPELEX_BASE_URL isn't it (or a non-production environment is mid-configuration) — verify the URL.",
          docs: { label: "Pipelex inference setup docs", href: "https://docs.pipelex.com/" },
        },
        details,
      };
    case "PipeValidationError":
    case "PipeFactoryError":
    case "MthdsParserError":
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
      "The @pipelex/sdk SDK needs PIPELEX_BASE_URL to know where to send pipeline requests, but it isn't set.",
    hint: {
      summary: "Copy .env.example to .env.local and fill it in:",
      code: "cp .env.example .env.local",
      codeLanguage: "bash",
    },
    details: `${err.name}: ${err.message}`,
  };
}

function classifyExecuteTimeout(err: PipelineExecuteTimeoutError): PipelineError {
  const seconds = Math.round(err.elapsedMs / 1000);
  return {
    kind: "execute_timeout",
    title: "Pipeline exceeded the ~30s blocking limit",
    message: `The blocking request ran for ~${seconds}s before timing out at the hosted gateway's ~30s synchronous limit. The pipeline isn't broken — it's just too long to await synchronously behind the hosted gateway.`,
    hint: {
      summary:
        "Switch this example to Durable mode. It starts the run and polls for the result, so long pipelines survive the cap.",
    },
    details: `${err.name}: ${err.message}`,
  };
}

/**
 * The blocking cap as the hosted gateway actually surfaces it: a synchronous
 * `execute` that overruns ~30s returns a 502/504 ("the runner did not complete
 * the request") rather than dropping the connection — so the SDK raises
 * `ApiResponseError`, not `PipelineExecuteTimeoutError`. Same user meaning as
 * `classifyExecuteTimeout` (kind `execute_timeout`): blocking is too long here,
 * switch to Durable. Only reached on the blocking path (see `ClassifyOptions`).
 */
function classifyBlockingGatewayTimeout(err: ApiResponseError): PipelineError {
  const detailsLines = [
    `${err.name}: HTTP ${err.status} ${err.statusText}`.trim(),
    err.serverMessage ? `server message: ${err.serverMessage}` : null,
  ].filter(Boolean) as string[];
  return {
    kind: "execute_timeout",
    title: "Pipeline exceeded the ~30s blocking limit",
    message: `The hosted gateway returned HTTP ${err.status} because the blocking request didn't finish in time — synchronous runs are cut off at ~30s here. The pipeline isn't broken; it's just too long to await synchronously.`,
    hint: {
      summary:
        "Switch this example to Durable mode. It starts the run and polls for the result, so long pipelines survive the cap.",
    },
    details: detailsLines.join("\n"),
  };
}

function classifyRunStillRunning(err: RunStillRunningError): PipelineError {
  const retry = err.retryAfterSeconds != null ? `\nRetry-After: ${err.retryAfterSeconds}s` : "";
  const location = err.location ? `\nLocation: ${err.location}` : "";
  return {
    kind: "run_still_running",
    title: "The run is still going",
    message: `The blocking request was accepted, but the run hasn't finished — the server returned run id ${err.runId} instead of a result. Behind the hosted gateway, a long run can't be awaited synchronously.`,
    hint: {
      summary: "Switch this example to Durable mode to start the run and poll it to completion.",
    },
    details: `${err.name}: ${err.message}${retry}${location}`,
  };
}

function classifyRunFailed(err: RunFailedError): PipelineError {
  return {
    kind: "run_failed",
    title: "The pipeline run failed",
    message:
      err.message ||
      `The run finished in a non-successful state (${err.status}). Check the technical details below.`,
    details: `${err.name}: run ${err.runId} ended ${err.status}\n${err.message}`,
  };
}

function classifyRunTimeout(err: RunTimeoutError): PipelineError {
  const seconds = Math.round(err.timeoutMs / 1000);
  return {
    kind: "run_timeout",
    title: "Stopped waiting for the run",
    message: `The run for ${err.runId} didn't finish within ~${seconds}s, so the app stopped polling for its result. The run keeps executing on the server — it wasn't cancelled.`,
    hint: {
      summary:
        "Re-run, or allow more time for very long pipelines. The run continues server-side and can be resumed by its id.",
    },
    details: `${err.name}: ${err.message}`,
  };
}

/**
 * The Pipelex API `error_type` for a `/start` refused because the deployment's
 * orchestrator can't run asynchronously (blocking-only `direct` mode). A
 * contract value on the problem body, surfaced by the SDK as `err.errorType`.
 */
const START_REQUIRES_ASYNC_ORCHESTRATION = "StartRequiresAsyncOrchestration";

/**
 * `/start` hit a backend whose orchestrator is blocking-only (the in-process
 * `direct` mode), so the durable start is refused with a 400. Same consumer
 * meaning as the run-lifecycle routes missing outright
 * (`classifyLifecycleUnavailable`, a 404): the configured URL doesn't provide
 * durable execution, which the hosted Pipelex API always does — so the fix is
 * the URL. The server says it in runtime terms ("orchestration mode", "fire-and-forget");
 * we re-frame it as *durable execution* (the word the starter uses) and route
 * it to the `lifecycle_unavailable` kind so the UI doesn't show the raw
 * runtime message as a generic bad request. The root cause differs from the
 * 404 case (the route exists; the orchestrator just can't go async), so the
 * copy is tailored rather than shared.
 */
function classifyStartRequiresAsync(err: ApiResponseError): PipelineError {
  const url = err.apiUrl || "(unknown)";
  return {
    kind: "lifecycle_unavailable",
    title: "Durable runs aren't available on this API",
    message: `${url} refused the durable start because it can only run pipelines synchronously — something the Pipelex hosted API never does, so this URL isn't it. Check PIPELEX_BASE_URL.`,
    // Show the runtime's own wording verbatim alongside our re-framing.
    apiMessage: err.serverMessage,
    hint: {
      summary: "Point PIPELEX_BASE_URL at the hosted Pipelex API:",
      code: "PIPELEX_BASE_URL=https://api.pipelex.com",
      codeLanguage: "env",
    },
    details: [
      `${err.name}: HTTP ${err.status} ${err.statusText}`.trim(),
      err.apiUrl ? `API URL: ${err.apiUrl}` : null,
      `error_type: ${err.errorType}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function classifyLifecycleUnavailable(
  err: RunLifecycleUnavailableError,
  env: ClassifyEnv,
): PipelineError {
  const url = err.apiUrl || env.apiUrl || "(unknown)";
  return {
    kind: "lifecycle_unavailable",
    title: "Durable runs aren't available on this API",
    message: `${url} doesn't serve the durable run lifecycle (start + poll), so it isn't the Pipelex hosted API — check PIPELEX_BASE_URL.`,
    hint: {
      summary: "Point PIPELEX_BASE_URL at the hosted Pipelex API:",
      code: "PIPELEX_BASE_URL=https://api.pipelex.com",
      codeLanguage: "env",
    },
    details: `${err.name}: ${err.message}`,
  };
}

/**
 * Classify an SDK input-preparation failure (`prepareInputs` / `uploadFile`) into
 * a single `upload_failed` kind with subclass-tailored copy — the PDF path
 * uploads the file to Pipelex storage before the run, and that upload can fail in
 * a few distinct, actionable ways. Mirrors `classifyServerError`'s switch: branch
 * on the concrete subclass, then fall back to the base `InputPreparationError` so
 * any future subclass is still classified (never `unknown`).
 */
function classifyInputPreparationError(
  err: InputPreparationError,
  env: ClassifyEnv,
): PipelineError {
  const details = `${err.name}: ${err.message}`;

  // No upload route (404) — the configured URL doesn't provide the upload
  // capability, which the hosted Pipelex API always does. Steer to the URL.
  if (err instanceof UnsupportedUploadCapabilityError) {
    const url = env.apiUrl || "(unknown)";
    return {
      kind: "upload_failed",
      title: "File upload isn't available on this API",
      message: `Preparing the PDF means uploading it to Pipelex storage first, but ${url} has no upload route, so it isn't the Pipelex hosted API — check PIPELEX_BASE_URL.`,
      hint: {
        summary: "Point PIPELEX_BASE_URL at the hosted Pipelex API, which supports upload:",
        code: "PIPELEX_BASE_URL=https://api.pipelex.com",
        codeLanguage: "env",
      },
      details,
    };
  }

  // Server refused the asset (413) — past the service-defined size cap.
  if (err instanceof RejectedAssetError) {
    return {
      kind: "upload_failed",
      title: "The PDF was rejected by the server",
      message: `Pipelex storage refused the upload (HTTP ${err.status}) — the file is likely past the service's size limit. Try a smaller PDF.`,
      apiMessage: causeServerMessage(err),
      details: `${details}\nfilename: ${err.filename}`,
    };
  }

  // Upload not authorized (401/403) — same fix as run auth, framed for upload.
  if (err instanceof UploadAuthenticationError) {
    return {
      kind: "upload_failed",
      title: "File upload was not authorized",
      message: `Pipelex storage rejected the upload (HTTP ${err.status}) — the PIPELEX_API_KEY is missing or not valid for uploads on this API.`,
      hint: {
        summary: "Check the API key in .env.local and restart the dev server:",
        code: "PIPELEX_API_KEY=your-key-here",
        codeLanguage: "env",
      },
      details,
    };
  }

  // InvalidLocalSourceError, UploadTransportError, a malformed data URL (the base
  // InputPreparationError), or any future subclass — a generic upload failure.
  return {
    kind: "upload_failed",
    title: "Preparing the PDF for upload failed",
    message:
      "The starter couldn't upload the PDF to Pipelex storage before running the pipeline. The technical details below should help track it down.",
    details,
  };
}

/** The verbatim server message from a preparation error's wrapped API response, if any. */
function causeServerMessage(err: { cause?: unknown }): string | undefined {
  return err.cause instanceof ApiResponseError ? err.cause.serverMessage : undefined;
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
        "The pipeline generated an image, but the API returned a URL a browser can't load. The Pipelex hosted API returns signed web URLs, so check that PIPELEX_BASE_URL targets it.",
      hint: {
        summary: "Point PIPELEX_BASE_URL at the hosted Pipelex API:",
        code: "PIPELEX_BASE_URL=https://api.pipelex.com",
        codeLanguage: "env",
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
    message: `Could not read the .mthds bundle from disk (${e.code ?? "fs error"}). The starter ships with methods/extract-entities/main.mthds — make sure it's still there.`,
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

/**
 * Build a `run_timeout` PipelineError for the client-side durable poll ceiling.
 *
 * Distinct from the `RunTimeoutError` branch in `classifyPipelineError`: that
 * one classifies an SDK error thrown server-side; this one is built inline on
 * the client when `useRun` stops its own poll loop after `maxDurationMs`. There
 * is no thrown error to classify — the client just stopped waiting. The run
 * keeps executing server-side and can be re-polled by its id.
 */
export function buildClientTimeoutError(elapsedMs: number): PipelineError {
  const seconds = Math.round(elapsedMs / 1000);
  return {
    kind: "run_timeout",
    title: "Stopped waiting for the run",
    message: `The run didn't finish within ~${seconds}s, so the app stopped polling for its result. The run keeps executing on the server — it wasn't cancelled.`,
    hint: {
      summary:
        "Re-run to start fresh. Very long pipelines may need a higher poll ceiling (the maxDurationMs passed to useRun).",
    },
    details: `Client poll ceiling reached after ~${seconds}s.`,
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
