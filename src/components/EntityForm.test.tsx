import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EntityForm } from "./EntityForm";
import { pollHelloRun, runHelloBlocking, startHelloRun } from "@/actions/runHelloPipeline";

vi.mock("@/actions/runHelloPipeline", () => ({
  runHelloBlocking: vi.fn(),
  startHelloRun: vi.fn(),
  pollHelloRun: vi.fn(),
}));

const blocking = vi.mocked(runHelloBlocking);
const start = vi.mocked(startHelloRun);
const poll = vi.mocked(pollHelloRun);

beforeEach(() => {
  vi.useFakeTimers();
  blocking.mockReset();
  start.mockReset();
  poll.mockReset();
});
afterEach(() => vi.useRealTimers());

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function submitForm() {
  const form = screen.getByLabelText(/input text/i).closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

const ENTITIES = { people: ["Tim Cook"], orgs: ["Apple"], dates: ["2026-03-05"] };

describe("EntityForm", () => {
  it("durable mode (default): streams live status, then renders the result", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll
      .mockResolvedValueOnce({
        ok: true,
        state: "running",
        status: "RUNNING",
        degraded: false,
        retryAfterSeconds: null,
      })
      .mockResolvedValueOnce({ ok: true, state: "completed", output: ENTITIES });

    render(<EntityForm />);
    submitForm();

    await flush(); // start + first poll (running)
    expect(screen.getByRole("status")).toBeInTheDocument();

    await flush(2000); // scheduled second poll → completed
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(1);
    expect(blocking).not.toHaveBeenCalled();
  });

  it("blocking mode: toggling to Blocking calls the blocking action and renders the result", async () => {
    blocking.mockResolvedValueOnce({ ok: true, output: ENTITIES });

    render(<EntityForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(blocking).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
  });

  it("renders the structured error when a poll returns ok:false", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({
      ok: false,
      transient: false,
      error: { kind: "run_failed", title: "Run failed", message: "boom", details: "d" },
    });

    render(<EntityForm />);
    submitForm();

    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Run failed")).toBeInTheDocument();
  });

  it("surfaces a transport_error when the awaited blocking action rejects", async () => {
    // Regression guard: a rejected await must route through <ErrorDisplay>, not
    // React's error boundary.
    blocking.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<EntityForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });
});
