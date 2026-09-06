import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { INPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/extract-entities/contracts";
import { useRunInputs } from "@/hooks/useRunInputs";
import { demoDesign } from "@/lib/design.fixture";
import { requireContract, requireInputForm } from "@/lib/runInputs";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "extract_entities", "extract_entities");

// The committed fixture binds `/inputs/text`, which is exactly the one input
// `extract_entities` declares — so it is a design that genuinely fits this
// method, not a stand-in that happens to validate.
describe("useRunInputs with an accepted design", () => {
  it("creates one store, and reads its /inputs subtree as the form's values", () => {
    const { result } = renderHook(() =>
      useRunInputs(CONTRACT, DESCRIPTOR, { text: "seeded" }, demoDesign()),
    );
    expect(result.current.design.ok).toBe(true);
    expect(result.current.store).not.toBeNull();
    expect(result.current.values).toEqual({ text: "seeded" });
    expect(result.current.store?.get("/inputs/text")).toBe("seeded");
  });

  it("writes through the store, so the designed page and the plain form cannot disagree", () => {
    const { result } = renderHook(() => useRunInputs(CONTRACT, DESCRIPTOR, {}, demoDesign()));

    act(() => result.current.setValues((current) => ({ ...current, text: "typed" })));

    // The one tree: what the plain form's setter wrote is what the page's own
    // controls are bound to, and what the run is built from.
    expect(result.current.store?.get("/inputs/text")).toBe("typed");
    expect(result.current.values).toEqual({ text: "typed" });
    expect(result.current.ready).toBe(true);
    // The wire shape, not the values: `native.Text` wraps its scalar under the
    // content key the contract names, and that is the kernel's deflation.
    expect(result.current.toData()).toEqual({ text: { text: "typed" } });
  });

  it("sees a write the page made directly into the store", () => {
    const { result } = renderHook(() => useRunInputs(CONTRACT, DESCRIPTOR, {}, demoDesign()));

    act(() => result.current.store?.set("/inputs", { text: "from the page" }));

    expect(result.current.values).toEqual({ text: "from the page" });
    expect(result.current.toData()).toEqual({ text: { text: "from the page" } });
  });

  it("gates readiness on the store, so an empty tree is not runnable", () => {
    const { result } = renderHook(() => useRunInputs(CONTRACT, DESCRIPTOR, {}, demoDesign()));
    expect(result.current.ready).toBe(false);
  });
});

describe("useRunInputs with no renderable design", () => {
  it("keeps React state and reports the cause, for a method nobody has designed", () => {
    const { result } = renderHook(() => useRunInputs(CONTRACT, DESCRIPTOR, { text: "seeded" }));
    expect(result.current.store).toBeNull();
    expect(result.current.design).toEqual({ ok: false, fallback: { cause: "none" } });
    expect(result.current.values).toEqual({ text: "seeded" });

    act(() => result.current.setValues({ text: "typed" }));
    expect(result.current.values).toEqual({ text: "typed" });
    // The wire shape, not the values: `native.Text` wraps its scalar under the
    // content key the contract names, and that is the kernel's deflation.
    expect(result.current.toData()).toEqual({ text: { text: "typed" } });
  });

  it("keeps React state when the design is refused, not a half-wired store", () => {
    const { result } = renderHook(() =>
      useRunInputs(CONTRACT, DESCRIPTOR, {}, demoDesign({ promptHash: "000000000000" })),
    );
    expect(result.current.store).toBeNull();
    expect(result.current.design.ok).toBe(false);

    act(() => result.current.setValues({ text: "typed" }));
    expect(result.current.values).toEqual({ text: "typed" });
  });
});
