import type { RunHealth } from "@/hooks/useRun";

interface RunStatusProps {
  /** Durable coarse run status (e.g. `RUNNING`), or null in blocking mode. */
  status: string | null;
  /** Wall-clock elapsed since the run started, in ms. */
  elapsedMs: number;
  /** Why we're in a resilient/retrying poll state, or null when polling cleanly. */
  health: RunHealth | null;
}

/**
 * Reassuring, cause-specific note for a non-fatal poll state. Both mean the
 * run is still executing server-side and we're still polling — so neither
 * shouts "degraded"; each just names what's briefly off and points forward.
 */
const HEALTH_NOTES: Record<RunHealth, string> = {
  reconnecting: "Reconnecting to the run tracker — your run is still going.",
  retrying: "Network hiccup — retrying. Your run is still going.",
};

/**
 * Friendly labels for the hosted `RunStatus` values. `COMPLETED` maps to
 * "Finalizing" because we only ever show it during the brief mid-write race
 * (status flipped terminal but the result artifacts aren't written yet).
 */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued",
  STARTED: "Starting",
  RUNNING: "Running",
  COMPLETED: "Finalizing",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  TERMINATED: "Terminated",
  TIMED_OUT: "Timed out",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Running";
}

/**
 * Shared live-status card for both modes. In durable mode `status` is a
 * friendly label ("Queued"/"Running" + elapsed); in blocking mode `status` is
 * null, so it shows just the spinner + elapsed. `role="status"` +
 * `aria-live="polite"` announces progress to assistive tech without stealing
 * focus.
 */
export function RunStatus({ status, elapsedMs, health }: RunStatusProps) {
  const seconds = (elapsedMs / 1000).toFixed(1);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"
      />
      <div className="space-y-0.5">
        <p className="font-medium">
          {status ? `${statusLabel(status)}… ` : "Running… "}
          {/* aria-hidden: ticks every 250ms — announcing it would drown the live region. */}
          <span aria-hidden="true" className="font-normal text-blue-700">
            {seconds}s
          </span>
        </p>
        {health && <p className="text-xs text-blue-700">{HEALTH_NOTES[health]}</p>}
      </div>
    </div>
  );
}
