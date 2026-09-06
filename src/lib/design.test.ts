import { describe, expect, it } from "vitest";
import { PROMPT_HASH } from "@pipelex/mthds-form/generative";
import type { RunField } from "@pipelex/mthds-form";
import { acceptDesign, describeFallback } from "./design";
import { DEMO_FIELDS, DEMO_JSONL, demoDesign } from "./design.fixture";

// The fallback rule is the product's safety, and every arm of it is a branch a
// reader will eventually meet in their own app. One test per cause, so a cause
// that stops firing — or one that starts firing on a design that is fine — is a
// failure here rather than a page that quietly stopped being rendered.
describe("acceptDesign", () => {
  it("accepts a layout written against this kernel's catalog that fits the method", () => {
    const verdict = acceptDesign(demoDesign(), DEMO_FIELDS);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.spec.root).toBe("page");
  });

  it("falls back with `none` when no design has been produced", () => {
    const verdict = acceptDesign(null, DEMO_FIELDS);
    expect(verdict).toEqual({ ok: false, fallback: { cause: "none" } });
  });

  it("falls back on a prompt hash the installed kernel no longer ships", () => {
    const verdict = acceptDesign(demoDesign({ promptHash: "000000000000" }), DEMO_FIELDS);
    expect(verdict).toEqual({
      ok: false,
      fallback: { cause: "prompt_hash", produced: "000000000000", installed: PROMPT_HASH },
    });
  });

  it("checks the prompt hash before it compiles anything", () => {
    // Cheapest first, and it is the condition a package bump moves: a design
    // produced for an older catalog must be refused before the current
    // vocabulary is asked to make sense of it.
    const verdict = acceptDesign(
      demoDesign({ promptHash: "000000000000", jsonl: "not json at all" }),
      DEMO_FIELDS,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.fallback.cause).toBe("prompt_hash");
  });

  it("falls back on a layout the catalog refuses", () => {
    const jsonl = DEMO_JSONL.replace('"type":"Hero"', '"type":"NoSuchComponent"');
    const verdict = acceptDesign(demoDesign({ jsonl }), DEMO_FIELDS);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.fallback.cause).toBe("invalid");
      if (verdict.fallback.cause === "invalid") {
        expect(verdict.fallback.problems).toContain("NoSuchComponent");
      }
    }
  });

  it("falls back on unparseable text, which compiles to an empty spec", () => {
    // `specFromJsonl` skips a line it cannot apply rather than throwing, so a
    // layout of noise arrives as a spec with no root — and it is the validator,
    // not a crash, that refuses it. Pinned because the two gates are exported
    // separately and neither may assume the other ran first.
    const verdict = acceptDesign(demoDesign({ jsonl: "not json\nnor this" }), DEMO_FIELDS);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.fallback.cause).toBe("invalid");
  });

  it("falls back on a layout that no longer fits the method", () => {
    // The staleness half: the method renamed its input, and the delegated path
    // now resolves to nothing while the required input is offered nowhere.
    const renamed: RunField[] = [{ ...DEMO_FIELDS[0], name: "body" } as RunField];
    const verdict = acceptDesign(demoDesign(), renamed);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.fallback.cause).toBe("unfit");
      if (verdict.fallback.cause === "unfit") {
        expect(verdict.fallback.problems.join(" ")).toContain("/inputs/text");
      }
    }
  });
});

describe("describeFallback", () => {
  it("says nothing about a method that simply has no design", () => {
    expect(describeFallback({ cause: "none" })).toBeNull();
  });

  it("names the gesture that repairs a moved prompt hash", () => {
    const line = describeFallback({
      cause: "prompt_hash",
      produced: "aaaaaaaaaaaa",
      installed: "bbbbbbbbbbbb",
    });
    expect(line).toContain("aaaaaaaaaaaa");
    expect(line).toContain("bbbbbbbbbbbb");
    expect(line).toContain("npm run design");
  });

  it("reports a render error, the one cause acceptDesign cannot see", () => {
    expect(describeFallback({ cause: "render_error", message: "boom" })).toContain("boom");
  });
});
