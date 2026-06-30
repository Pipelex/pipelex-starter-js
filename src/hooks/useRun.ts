"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildClientTimeoutError, classifyTransportError, type PipelineError } from "@/lib/errors";
import type { ExecutionMode } from "@/config";
import type { BlockingOutcome } from "@/lib/blockingRun";
import type { PollOutcome, StartOutcome } from "@/lib/durableRun";

/**
 * The unified run state machine, identical for both execution modes:
 * `idle → running → (done | error)`. In `running`, `status` is the durable
 * coarse run status (null in blocking — there is no per-tick status), and
 * `elapsedMs` is a smooth wall-clock counter.
 */
export type RunState<T> =
  | { phase: "idle" }
  | {
      phase: "running";
      mode: ExecutionMode;
      status: string | null;
      elapsedMs: number;
      degraded: boolean;
    }
  | { phase: "done"; output: T }
  | { phase: "error"; error: PipelineError };

export interface UseRunConfig<TInput, TOutput> {
  /** Which path to drive. Forms own this as state and pass it in. */
  mode: ExecutionMode;
  /** Blocking Server Action — one synchronous `execute`. */
  blocking: (input: TInput) => Promise<BlockingOutcome<TOutput>>;
  /** Durable Server Action — `start`, returns a run id. */
  start: (input: TInput) => Promise<StartOutcome>;
  /** Durable Server Action — poll one tick of a run by id. */
  poll: (runId: string) => Promise<PollOutcome<TOutput>>;
  /** Base durable poll interval (ms). Honors a larger `Retry-After`. Default 2000. */
  intervalMs?: number;
  /** Durable poll ceiling (ms): stop waiting after this. Default 300_000 (5 min). */
  maxDurationMs?: number;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_DURATION_MS = 300_000;
const TICK_MS = 250;

/**
 * Drive a pipeline run in either execution mode behind one state machine, so
 * the forms never branch on `mode`.
 *
 * - **blocking**: a single awaited Server Action; resolve → done, reject →
 *   transport error.
 * - **durable**: `start`, then a self-rescheduling `setTimeout` poll loop (no
 *   overlap) that honors `Retry-After`, enforces a wall-clock ceiling, and
 *   reports live status each tick.
 *
 * Shared concerns: a staleness token invalidates a superseded or unmounted
 * run's late results; an elapsed ticker drives a smooth counter; every awaited
 * boundary is wrapped so a rejected promise becomes a classified transport
 * error rather than escaping to React's error boundary.
 */
export function useRun<TInput, TOutput>(
  cfg: UseRunConfig<TInput, TOutput>,
): { state: RunState<TOutput>; run: (input: TInput) => void; reset: () => void } {
  const [state, setState] = useState<RunState<TOutput>>({ phase: "idle" });

  const tokenRef = useRef(0);
  const startedAtRef = useRef(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest-config ref: forms build the cfg object fresh each render (mode is
  // their state), so read the live callbacks/mode at submit time while keeping
  // `run` a stable identity. Updated in an effect (not during render) so the
  // ref rule stays satisfied — `run` only reads it from event handlers/timers,
  // which fire after commit.
  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
  });

  const clearTimers = useCallback(() => {
    if (tickerRef.current !== null) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startTicker = useCallback(() => {
    if (tickerRef.current !== null) return;
    tickerRef.current = setInterval(() => {
      setState((prev) =>
        prev.phase === "running" ? { ...prev, elapsedMs: Date.now() - startedAtRef.current } : prev,
      );
    }, TICK_MS);
  }, []);

  const reset = useCallback(() => {
    tokenRef.current += 1; // invalidate any in-flight async work
    clearTimers();
    setState({ phase: "idle" });
  }, [clearTimers]);

  const run = useCallback(
    (input: TInput) => {
      const token = ++tokenRef.current;
      const isCurrent = () => tokenRef.current === token;
      clearTimers();
      startedAtRef.current = Date.now();

      const { mode, blocking, start, poll } = cfgRef.current;
      const intervalMs = cfgRef.current.intervalMs ?? DEFAULT_INTERVAL_MS;
      const maxDurationMs = cfgRef.current.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

      setState({ phase: "running", mode, status: null, elapsedMs: 0, degraded: false });
      startTicker();

      const fail = (error: PipelineError) => {
        if (!isCurrent()) return;
        clearTimers();
        setState({ phase: "error", error });
      };
      const succeed = (output: TOutput) => {
        if (!isCurrent()) return;
        clearTimers();
        setState({ phase: "done", output });
      };

      if (mode === "blocking") {
        blocking(input)
          .then((outcome) => {
            if (outcome.ok) succeed(outcome.output);
            else fail(outcome.error);
          })
          .catch((err) => fail(classifyTransportError(err)));
        return;
      }

      // Durable: start, then poll until terminal.
      const pollOnce = async (runId: string) => {
        if (!isCurrent()) return;
        // Ceiling: stop polling after maxDurationMs (the run continues server-side).
        const elapsed = Date.now() - startedAtRef.current;
        if (elapsed >= maxDurationMs) {
          fail(buildClientTimeoutError(elapsed));
          return;
        }

        let outcome: PollOutcome<TOutput>;
        try {
          outcome = await poll(runId);
        } catch (err) {
          fail(classifyTransportError(err));
          return;
        }
        if (!isCurrent()) return;

        if (!outcome.ok) {
          fail(outcome.error);
          return;
        }
        if (outcome.state === "completed") {
          succeed(outcome.output);
          return;
        }

        // running: refresh the live status (the ticker keeps elapsedMs current).
        setState((prev) =>
          prev.phase === "running"
            ? { ...prev, status: outcome.status, degraded: outcome.degraded }
            : prev,
        );
        const delay = Math.max(intervalMs, (outcome.retryAfterSeconds ?? 0) * 1000);
        pollTimerRef.current = setTimeout(() => void pollOnce(runId), delay);
      };

      start(input)
        .then((outcome) => {
          if (!isCurrent()) return;
          if (!outcome.ok) {
            fail(outcome.error);
            return;
          }
          void pollOnce(outcome.runId); // first tick immediately
        })
        .catch((err) => fail(classifyTransportError(err)));
    },
    [clearTimers, startTicker],
  );

  // Unmount: invalidate in-flight work and stop timers so a late result can't
  // setState on an unmounted component and the poll loop ends.
  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      clearTimers();
    };
  }, [clearTimers]);

  return { state, run, reset };
}
