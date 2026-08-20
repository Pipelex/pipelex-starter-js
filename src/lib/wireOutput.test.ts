import { describe, it, expect } from "vitest";
import type { RunResults } from "@pipelex/sdk";
import { describeSchemaFailure, dropWireNulls, wireOutput } from "./wireOutput";
import { ImageSchema } from "@/generated/generate-image/types";

describe("dropWireNulls", () => {
  it("drops null-valued keys so an .optional() field reads as absent", () => {
    expect(dropWireNulls({ url: "https://x", caption: null })).toEqual({ url: "https://x" });
  });

  it("keeps every non-null value, including falsy ones", () => {
    expect(dropWireNulls({ a: "", b: 0, c: false, d: [] })).toEqual({
      a: "",
      b: 0,
      c: false,
      d: [],
    });
  });

  it("recurses into nested objects and through arrays of objects", () => {
    expect(dropWireNulls({ outer: { inner: null, kept: 1 }, list: [{ x: null, y: 2 }] })).toEqual({
      outer: { kept: 1 },
      list: [{ y: 2 }],
    });
  });

  it("leaves a null list *item* alone — only object keys are optional on the wire", () => {
    expect(dropWireNulls({ items: [1, null, 3] })).toEqual({ items: [1, null, 3] });
  });

  it("passes a non-object through untouched, so a bad payload still fails the schema", () => {
    expect(dropWireNulls(null)).toBeNull();
    expect(dropWireNulls("text")).toBe("text");
    expect(dropWireNulls(7)).toBe(7);
  });

  it("is what lets a generated schema accept the runtime's own wire payload", () => {
    // The regression this whole helper exists for: the hosted runtime emits
    // `"caption": null` for an unset optional field, and `.optional()` rejects
    // null. Without the normalization the schema rejects a perfectly good run.
    const wire = { url: "https://x/y.png", caption: null, width: null, height: null };
    expect(ImageSchema.safeParse(wire).success).toBe(false);
    expect(ImageSchema.safeParse(dropWireNulls(wire)).success).toBe(true);
  });
});

describe("wireOutput", () => {
  it("reads main_stuff and normalizes it in one step", () => {
    const results: RunResults = {
      pipeline_run_id: "run-1",
      main_stuff: { url: "https://x", caption: null },
    };
    expect(wireOutput(results)).toEqual({ url: "https://x" });
  });
});

describe("describeSchemaFailure", () => {
  it("renders a ZodError field-by-field rather than as a JSON issue dump", () => {
    const result = ImageSchema.safeParse({ public_url: 12 });
    const message = describeSchemaFailure(result.error, "Image");
    expect(message).toContain("did not match Image");
    expect(message).toContain("public_url");
    expect(message).not.toContain('"code":');
  });

  it("passes a non-Zod error's message through unchanged", () => {
    expect(describeSchemaFailure(new Error("socket hang up"), "Image")).toBe("socket hang up");
    expect(describeSchemaFailure("plain string", "Image")).toBe("plain string");
  });
});
