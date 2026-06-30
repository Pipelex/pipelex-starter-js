interface RunStatusProps {
  /** Durable coarse run status (e.g. `RUNNING`), or null in blocking mode. */
  status: string | null;
  /** Wall-clock elapsed since the run started, in ms. */
  elapsedMs: number;
  /** True when the hosted run store is degraded (status is last-known). */
  degraded: boolean;
}

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
export function RunStatus({ status, elapsedMs, degraded }: RunStatusProps) {
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
          <span className="font-normal text-blue-700">{seconds}s</span>
        </p>
        {degraded && (
          <p className="text-xs text-blue-700">
            Status is degraded (the run store is catching up) — still polling.
          </p>
        )}
      </div>
    </div>
  );
}
