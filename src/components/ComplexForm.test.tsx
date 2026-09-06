import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ComplexForm } from "./ComplexForm";
import {
  pollComplexFormRun,
  runComplexFormBlocking,
  startComplexFormRun,
} from "@/actions/runComplexFormPipeline";
import { DESIGN } from "@/generated/complex-form/design";
import { ctaLabelOf, showPlainForm } from "./designedView.fixture";

vi.mock("@/actions/runComplexFormPipeline", () => ({
  runComplexFormBlocking: vi.fn(),
  startComplexFormRun: vi.fn(),
  pollComplexFormRun: vi.fn(),
}));

const blocking = vi.mocked(runComplexFormBlocking);
const start = vi.mocked(startComplexFormRun);
const poll = vi.mocked(pollComplexFormRun);

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
  const form = screen.getByRole("button", { name: /extract brief/i }).closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

const BRIEF = {
  summary: "Apple showed new products in Cupertino.",
  people: ["Tim Cook"],
  orgs: ["Apple"],
  dates: ["2026-03-05"],
};
const USAGE = {
  calls: [
    {
      modelName: "gpt-4o",
      modelType: "llm",
      pipeCode: "extract_brief",
      tokensByCategory: { input: 1200, output: 340 },
      costUsd: 0.0042,
    },
  ],
  totalCostUsd: 0.0042,
  hasCost: true,
  state: "records" as const,
  assemblyError: null,
};

describe("ComplexForm", () => {
  it("opens with only the required input on screen, the optional one folded away", () => {
    render(<ComplexForm />);
    showPlainForm();
    expect(screen.getByLabelText("Text")).toHaveDisplayValue(/Tim Cook/);
    // `focus` is optional and empty, so it starts folded behind the toggle.
    expect(screen.queryByText(/who the extraction is for/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /optional input/i })).toBeInTheDocument();
  });

  it("reveals the optional structured input, which folds its own children in turn", () => {
    render(<ComplexForm />);
    showPlainForm();
    fireEvent.click(screen.getByRole("button", { name: /optional input/i }));

    // The card is on screen, and folds its children behind a toggle of its own
    // — the kernel applies the same rule at every level. Both of this concept's
    // fields are optional (a design choice — see the bundle comment), so both
    // start folded.
    expect(screen.getByText(/how to narrow the extraction/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /optional field/i }));

    // The enum's options come from the concept's `choices`; nothing in this
    // component or its test fixture names them.
    for (const option of ["general", "legal", "technical"]) {
      expect(screen.getByRole("radio", { name: option })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("renders the plural input as a repeater that never gates Run", () => {
    render(<ComplexForm />);
    showPlainForm();
    // `must_include` is plural, so it is always on screen and always ready —
    // the kernel's readiness scan excludes plural and optional inputs.
    expect(screen.getByRole("button", { name: /add item/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /extract brief/i })).toBeEnabled();
  });

  it("gates Run on the contract's required input, not a hand-written check", () => {
    render(<ComplexForm />);
    showPlainForm();
    const runButton = screen.getByRole("button", { name: /extract brief/i });
    expect(runButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "" } });
    expect(runButton).toBeDisabled();
  });

  it("durable mode (default): streams live status, then renders the brief", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll
      .mockResolvedValueOnce({
        ok: true,
        state: "running",
        status: "RUNNING",
        degraded: false,
        retryAfterSeconds: null,
      })
      .mockResolvedValueOnce({ ok: true, state: "completed", output: BRIEF, usage: USAGE });

    render(<ComplexForm />);
    showPlainForm();
    submitForm();

    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();

    await flush(2000);
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
    expect(screen.getByText(/Apple showed new products/)).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(1);
    expect(blocking).not.toHaveBeenCalled();
  });

  it("sends the wire shape the contract declares, including the plural input", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({
      ok: true,
      state: "completed",
      output: BRIEF,
      usage: USAGE,
    });

    render(<ComplexForm />);
    showPlainForm();
    fireEvent.click(screen.getByRole("button", { name: /optional input/i }));
    fireEvent.click(screen.getByRole("button", { name: /optional field/i }));
    fireEvent.click(screen.getByRole("radio", { name: "legal" }));
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    // The kernel derives each control's DOM id from its field path behind a
    // `useId` prefix (so two forms on one page cannot collide), which makes the
    // id unpredictable from here — reach the new row by role instead. It is the
    // last textbox because `must_include` is the descriptor's last field.
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[textboxes.length - 1]!, {
      target: { value: "Cupertino" },
    });
    submitForm();

    await flush();
    // Each kind travels differently, and all three shapes come from the kernel:
    // a Text input is wrapped as `{text}`, a structured input goes as a plain
    // object, a plural one as an array of wrapped items. Asserting the whole
    // envelope is what would catch `run(values)` in place of `run(toData())`.
    //
    // `focus` is matched loosely because this is the *pre-gate* shape: the
    // kernel materializes every declared child, so an untouched `notes` is
    // present as `""` here and is pruned later, inside `gateRunInputs`. Pinning
    // that byte-for-byte would assert a kernel internal, and the pruning itself
    // is covered where it happens, in `src/lib/runInputs.test.ts`.
    expect(start).toHaveBeenCalledWith({
      text: { text: expect.stringContaining("Tim Cook") },
      focus: expect.objectContaining({ audience: "legal" }),
      must_include: [{ text: "Cupertino" }],
    });
  });

  it("renders the structured error when a poll returns ok:false", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({
      ok: false,
      transient: false,
      error: { kind: "run_failed", title: "Run failed", message: "boom", details: "d" },
    });

    render(<ComplexForm />);
    showPlainForm();
    submitForm();

    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Run failed")).toBeInTheDocument();
  });
});

describe("ComplexForm's designed page", () => {
  const ctaLabel = ctaLabelOf(DESIGN);

  it("has a committed design that this kernel renders", () => {
    expect(DESIGN).not.toBeNull();
    expect(ctaLabel).not.toBe("");
  });

  it("runs the method from the store's inputs when the call to action is pressed", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({ ok: true, state: "completed", output: BRIEF, usage: USAGE });

    render(<ComplexForm />);
    fireEvent.click(screen.getByRole("button", { name: ctaLabel }));

    await flush();

    // This method's layout is the one that flattens its optional structure
    // into a chip row and a notes field rather than delegating it, so the wire
    // shape is the thing worth pinning here: the designed view deflates through
    // the same contract the plain form deflates through, down to how an
    // untouched optional struct and an empty plural are rendered.
    expect(start).toHaveBeenCalledWith({
      text: { text: expect.stringContaining("Tim Cook") },
      focus: undefined,
      must_include: [],
    });
  });

  it("refuses a second press while the run it started is still in flight", async () => {
    start.mockResolvedValue({ ok: true, runId: "run-1" });
    poll.mockResolvedValue({
      ok: true,
      state: "running",
      status: "RUNNING",
      degraded: false,
      retryAfterSeconds: null,
    });

    render(<ComplexForm />);
    const cta = screen.getByRole("button", { name: ctaLabel });
    fireEvent.click(cta);
    await flush();
    fireEvent.click(cta);
    fireEvent.click(cta);
    await flush();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("shows the same value on the plain form, because both views read one store", () => {
    render(<ComplexForm />);
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Ada Lovelace, 1843" } });
    showPlainForm();
    expect(screen.getByLabelText("Text")).toHaveDisplayValue("Ada Lovelace, 1843");
  });
});
