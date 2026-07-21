import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRun, type RunState, type UseRunConfig } from "./useRun";

type Out = { value: string };

function makeCfg(overrides: Partial<UseRunConfig<string, Out>>): UseRunConfig<string, Out> {
  return {
    mode: "blocking",
    blocking: vi.fn(),
    start: vi.fn(),
    poll: vi.fn(),
    ...overrides,
  };
}

/** Narrow `state` so tests can read mode-specific fields without casts. */
function asRunning(state: RunState<Out>) {
  if (state.phase !== "running") throw new Error(`expected running, got ${state.phase}`);
  return state;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Advance fake timers + flush microtasks inside act(). */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useRun — blocking", () => {
  it("run → running → done", async () => {
    const blocking = vi.fn().mockResolvedValueOnce({ ok: true, output: { value: "x" } });
    const cfg = makeCfg({ mode: "blocking", blocking });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    expect(result.current.state.phase).toBe("running");

    await flush();
    expect(result.current.state).toEqual({ phase: "done", output: { value: "x" } });
    expect(blocking).toHaveBeenCalledWith("in");
  });

  it("run → {ok:false} → error", async () => {
    const blocking = vi.fn().mockResolvedValueOnce({
      ok: false,
      error: { kind: "bad_request", title: "T", message: "m", details: "d" },
    });
    const cfg = makeCfg({ mode: "blocking", blocking });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush();
    expect(result.current.state).toMatchObject({ phase: "error", error: { kind: "bad_request" } });
  });

  it("a rejected blocking await becomes a transport error (not a thrown boundary)", async () => {
    const blocking = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const cfg = makeCfg({ mode: "blocking", blocking });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush();
    expect(result.current.state).toMatchObject({
      phase: "error",
      error: { kind: "transport_error" },
    });
  });
});

describe("useRun — durable", () => {
  it("start → poll running → poll completed → done", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        state: "running",
        status: "RUNNING",
        degraded: false,
        retryAfterSeconds: null,
      })
      .mockResolvedValueOnce({ ok: true, state: "completed", output: { value: "done" } });
    const cfg = makeCfg({ mode: "durable", start, poll });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // start resolves, first poll (running)
    expect(asRunning(result.current.state).status).toBe("RUNNING");

    await flush(2000); // scheduled second poll fires → completed
    expect(result.current.state).toEqual({ phase: "done", output: { value: "done" } });
    expect(start).toHaveBeenCalledWith("in");
  });

  it("a failed poll → error", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi.fn().mockResolvedValueOnce({
      ok: false,
      transient: false,
      error: { kind: "run_failed", title: "T", message: "m", details: "d" },
    });
    const cfg = makeCfg({ mode: "durable", start, poll });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush();
    expect(result.current.state).toMatchObject({ phase: "error", error: { kind: "run_failed" } });
  });

  it("retries a transient poll failure, then completes", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        transient: true,
        error: { kind: "server_error", title: "T", message: "blip", details: "d" },
      })
      .mockResolvedValueOnce({ ok: true, state: "completed", output: { value: "done" } });
    const cfg = makeCfg({ mode: "durable", start, poll, intervalMs: 1000 });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // start resolves; first poll → transient blip (run keeps going, retrying)
    expect(result.current.state.phase).toBe("running");
    expect(asRunning(result.current.state).health).toBe("retrying");

    await flush(1000); // scheduled retry → completed
    expect(result.current.state).toEqual({ phase: "done", output: { value: "done" } });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("maps a server-reported degraded running poll to health 'reconnecting'", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi.fn().mockResolvedValueOnce({
      ok: true,
      state: "running",
      status: "RUNNING",
      degraded: true, // the server served a last-known status (Temporal unreachable)
      retryAfterSeconds: null,
    });
    const cfg = makeCfg({ mode: "durable", start, poll });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // start resolves; first poll → running but server-degraded
    // A verdict-bearing tick, so it's "reconnecting" (server signal), not "retrying".
    expect(asRunning(result.current.state).health).toBe("reconnecting");
  });

  it("clears health back to null once a clean poll follows a degraded one", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        state: "running",
        status: "RUNNING",
        degraded: true,
        retryAfterSeconds: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        state: "running",
        status: "RUNNING",
        degraded: false,
        retryAfterSeconds: null,
      });
    const cfg = makeCfg({ mode: "durable", start, poll, intervalMs: 1000 });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // first poll → degraded
    expect(asRunning(result.current.state).health).toBe("reconnecting");

    await flush(1000); // second poll → clean
    expect(asRunning(result.current.state).health).toBeNull();
  });

  it("treats a rejected poll await as a transient blip and keeps polling", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, state: "completed", output: { value: "recovered" } });
    const cfg = makeCfg({ mode: "durable", start, poll, intervalMs: 1000 });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // first poll rejects → transient, still running
    expect(result.current.state.phase).toBe("running");

    await flush(1000); // retry → completed
    expect(result.current.state).toEqual({ phase: "done", output: { value: "recovered" } });
  });

  it("gives up after a sustained streak of transient poll failures", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi.fn().mockResolvedValue({
      ok: false,
      transient: true,
      error: { kind: "server_error", title: "T", message: "down", details: "d" },
    });
    // High ceiling so the consecutive-failure budget — not the wall clock — ends it.
    const cfg = makeCfg({ mode: "durable", start, poll, intervalMs: 1000, maxDurationMs: 600_000 });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // first poll → transient #1
    await flush(20_000); // keep ticking until the budget is exhausted
    expect(result.current.state).toMatchObject({
      phase: "error",
      error: { kind: "server_error" },
    });
  });

  it("surfaces lifecycle_unavailable from start as an error — never a silent blocking fallback", async () => {
    const start = vi.fn().mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "lifecycle_unavailable",
        title: "Durable runs aren't available on this API",
        message: "http://localhost:8081 doesn't serve the durable run lifecycle",
        details: "d",
      },
    });
    const blocking = vi.fn();
    const cfg = makeCfg({ mode: "durable", start, blocking });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush();
    expect(blocking).not.toHaveBeenCalled(); // the backend's lack of durable support must be visible
    expect(result.current.state).toMatchObject({
      phase: "error",
      error: { kind: "lifecycle_unavailable" },
    });
  });

  it("a rejected start await becomes a transport error", async () => {
    const start = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const cfg = makeCfg({ mode: "durable", start });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush();
    expect(result.current.state).toMatchObject({
      phase: "error",
      error: { kind: "transport_error" },
    });
  });

  it("discards a late poll result after unmount (staleness)", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    let resolvePoll: (value: unknown) => void = () => {};
    const poll = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const cfg = makeCfg({ mode: "durable", start, poll });
    const { result, unmount } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // start resolves; first poll is pending
    expect(result.current.state.phase).toBe("running");

    unmount();
    // Resolve the pending poll AFTER unmount — the staleness token must discard it.
    await act(async () => {
      resolvePoll({ ok: true, state: "completed", output: { value: "late" } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.phase).toBe("running"); // never advanced to done
  });

  it("honors the ceiling even when Retry-After schedules beyond it", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    // A huge Retry-After must not push the next tick past the ceiling: the
    // delay is capped to the time remaining, so the timeout stays strict.
    const poll = vi.fn().mockResolvedValue({
      ok: true,
      state: "running",
      status: "RUNNING",
      degraded: false,
      retryAfterSeconds: 600,
    });
    const cfg = makeCfg({ mode: "durable", start, poll, intervalMs: 1000, maxDurationMs: 5000 });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // first poll → running, next tick scheduled
    await flush(5000); // reach the ceiling — far before the 600s Retry-After
    expect(result.current.state).toMatchObject({ phase: "error", error: { kind: "run_timeout" } });
  });

  it("stops polling after maxDurationMs and reports a run_timeout", async () => {
    const start = vi.fn().mockResolvedValueOnce({ ok: true, runId: "run-1" });
    const poll = vi.fn().mockResolvedValue({
      ok: true,
      state: "running",
      status: "RUNNING",
      degraded: false,
      retryAfterSeconds: null,
    });
    const cfg = makeCfg({ mode: "durable", start, poll, intervalMs: 1000, maxDurationMs: 5000 });
    const { result } = renderHook(() => useRun(cfg));

    act(() => result.current.run("in"));
    await flush(); // first poll
    await flush(10_000); // keep polling until the ceiling trips
    expect(result.current.state).toMatchObject({ phase: "error", error: { kind: "run_timeout" } });
  });
});
