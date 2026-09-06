import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { specFromJsonl } from "@pipelex/mthds-form/generative";
import { DESIGN } from "@/generated/extract-entities/design";
import { EntityForm } from "./EntityForm";
import {
  pollExtractEntitiesRun,
  runExtractEntitiesBlocking,
  startExtractEntitiesRun,
} from "@/actions/runExtractEntitiesPipeline";

vi.mock("@/actions/runExtractEntitiesPipeline", () => ({
  runExtractEntitiesBlocking: vi.fn(),
  startExtractEntitiesRun: vi.fn(),
  pollExtractEntitiesRun: vi.fn(),
}));

const blocking = vi.mocked(runExtractEntitiesBlocking);
const start = vi.mocked(startExtractEntitiesRun);
const poll = vi.mocked(pollExtractEntitiesRun);

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

// Reached through the submit button rather than the input's label: the labels
// are the kernel's humanized contract names now, so a bundle rename would
// otherwise break every test in this file rather than just the one asserting it.
function submitForm() {
  const form = screen.getByRole("button", { name: /extract entities/i }).closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

const ENTITIES = { people: ["Tim Cook"], orgs: ["Apple"], dates: ["2026-03-05"] };
const USAGE = {
  calls: [
    {
      modelName: "gpt-4o",
      modelType: "llm",
      pipeCode: "extract_entities",
      tokensByCategory: { input: 1200, output: 340 },
      costUsd: 0.0042,
    },
  ],
  totalCostUsd: 0.0042,
  hasCost: true,
  state: "records" as const,
  assemblyError: null,
};

/**
 * Switch to the kernel's plain form.
 *
 * This method carries a committed design now, so the tab opens on the page a
 * model laid out — and every label, button name and section title on that page
 * is the model's, re-written whenever the design is re-produced. The toggle is
 * app chrome and its name is this repo's, so one click here is what keeps the
 * assertions below about the run path rather than about somebody's copy. The
 * designed view has its own tests, which read what the committed layout
 * actually says rather than assuming any of it.
 */
function showPlainForm() {
  fireEvent.click(screen.getByRole("radio", { name: "Plain form" }));
}

describe("EntityForm", () => {
  it("renders the input the method's contract declares, seeded with the sample", () => {
    render(<EntityForm />);
    showPlainForm();
    // The bundle's `text` input → "Text" through the kernel's `app`
    // presentation. Nothing in this component names the input: the label, the
    // control and the readiness rule all come from the generated contract.
    expect(screen.getByLabelText("Text")).toHaveDisplayValue(/Tim Cook/);
  });

  it("gates Run on the contract's required inputs, not a hand-written check", () => {
    render(<EntityForm />);
    showPlainForm();
    const runButton = screen.getByRole("button", { name: /extract entities/i });
    expect(runButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "" } });
    expect(runButton).toBeDisabled();
  });

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
      .mockResolvedValueOnce({ ok: true, state: "completed", output: ENTITIES, usage: USAGE });

    render(<EntityForm />);

    showPlainForm();
    submitForm();

    await flush(); // start + first poll (running)
    expect(screen.getByRole("status")).toBeInTheDocument();

    await flush(2000); // scheduled second poll → completed
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
    // The cost report is wired in beside the result.
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(1);
    expect(blocking).not.toHaveBeenCalled();
    // The seam this whole branch turns on: the action receives the
    // *schema-shaped* dict the contract declares, not the raw run-values the
    // form holds. `run(values)` in place of `run(toData())` sends
    // `{text: "…"}`, every real run is rejected by the gate as `bad_request`,
    // and without this assertion the suite stays green all the way to ship.
    expect(start).toHaveBeenCalledWith({ text: { text: expect.stringContaining("Tim Cook") } });
  });

  it("blocking mode: toggling to Blocking calls the blocking action and renders the result", async () => {
    blocking.mockResolvedValueOnce({ ok: true, output: ENTITIES, usage: USAGE });

    render(<EntityForm />);

    showPlainForm();
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(blocking).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
    // Both modes hand over the same shape — the forms are mode-agnostic.
    expect(blocking).toHaveBeenCalledWith({ text: { text: expect.stringContaining("Tim Cook") } });
  });

  it("renders the structured error when a poll returns ok:false", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({
      ok: false,
      transient: false,
      error: { kind: "run_failed", title: "Run failed", message: "boom", details: "d" },
    });

    render(<EntityForm />);

    showPlainForm();
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

    showPlainForm();
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });
});

// The designed view, read from the layout this repo actually committed.
//
// Every label on that page is the model's, so nothing here is spelled out: the
// call to action is found by the label the committed JSONL gives it. A
// re-produced design changes the page and this test follows it — which is the
// only way a test about a produced artifact can be honest.
describe("EntityForm's designed page", () => {
  const spec = specFromJsonl(DESIGN?.jsonl ?? "");
  const cta = Object.values(spec.elements ?? {}).find(
    (element) => (element as { type?: string }).type === "Cta",
  ) as { props?: { label?: string } } | undefined;
  const ctaLabel = cta?.props?.label ?? "";

  it("has a committed design that this kernel renders", () => {
    // If this fails, the tab has quietly fallen back to the plain form and
    // every assertion below would be testing the wrong view.
    expect(DESIGN).not.toBeNull();
    expect(ctaLabel).not.toBe("");
  });

  it("runs the method from the store's inputs when the call to action is pressed", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({ ok: true, state: "completed", output: ENTITIES, usage: USAGE });

    render(<EntityForm />);
    fireEvent.click(screen.getByRole("button", { name: ctaLabel }));

    await flush();

    // The seeded sample, deflated through the same contract the plain form
    // deflates through — one store, one wire, whichever view was on screen.
    expect(start).toHaveBeenCalledWith({ text: { text: expect.stringContaining("Tim Cook") } });
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
  });

  it("shows the same value on the plain form, because both views read one store", () => {
    render(<EntityForm />);
    // Type into the designed page's own control, then flip.
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Ada Lovelace, 1843" } });
    showPlainForm();
    expect(screen.getByLabelText("Text")).toHaveDisplayValue("Ada Lovelace, 1843");
  });
});
