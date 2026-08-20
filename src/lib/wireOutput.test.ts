import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { RunResults } from "@pipelex/sdk";
import { describeSchemaFailure, dropWireNulls, MAX_WIRE_DEPTH, wireOutput } from "./wireOutput";
import { ImageSchema } from "@/generated/generate-image/types";

describe("dropWireNulls", () => {
  it("drops a null on an .optional() field so it reads as absent", () => {
    expect(dropWireNulls({ url: "https://x", caption: null }, ImageSchema)).toEqual({
      url: "https://x",
    });
  });

  it("keeps every non-null value, including falsy ones", () => {
    const schema = z.object({
      a: z.string(),
      b: z.number(),
      c: z.boolean(),
      d: z.array(z.string()),
    });
    expect(dropWireNulls({ a: "", b: 0, c: false, d: [] }, schema)).toEqual({
      a: "",
      b: 0,
      c: false,
      d: [],
    });
  });

  it("recurses into declared nested objects and through arrays of them", () => {
    const inner = z.object({ inner: z.string().optional(), kept: z.number() });
    const schema = z.object({
      outer: inner,
      list: z.array(z.object({ x: z.string().optional(), y: z.number() })),
    });
    expect(
      dropWireNulls({ outer: { inner: null, kept: 1 }, list: [{ x: null, y: 2 }] }, schema),
    ).toEqual({ outer: { kept: 1 }, list: [{ y: 2 }] });
  });

  it("leaves a null list *item* alone — only object keys are optional on the wire", () => {
    const schema = z.object({ items: z.array(z.number().nullable()) });
    expect(dropWireNulls({ items: [1, null, 3] }, schema)).toEqual({ items: [1, null, 3] });
  });

  it("passes a non-object through untouched, so a bad payload still fails the schema", () => {
    expect(dropWireNulls(null, ImageSchema)).toBeNull();
    expect(dropWireNulls("text", ImageSchema)).toBe("text");
    expect(dropWireNulls(7, ImageSchema)).toBe(7);
  });

  it("is what lets a generated schema accept the runtime's own wire payload", () => {
    // The regression this whole helper exists for: the hosted runtime emits
    // `"caption": null` for an unset optional field, and `.optional()` rejects
    // null. Without the normalization the schema rejects a perfectly good run.
    const wire = { url: "https://x/y.png", caption: null, width: null, height: null };
    expect(ImageSchema.safeParse(wire).success).toBe(false);
    expect(ImageSchema.safeParse(dropWireNulls(wire, ImageSchema)).success).toBe(true);
  });

  // The reason the walk is schema-guided rather than blind. Inside these shapes a
  // `null` is data, and a blind deep strip would delete it before the schema —
  // silently, with a green check.
  it("never strips a null inside a z.record() — the keys there are data", () => {
    const schema = z.object({ meta: z.record(z.string(), z.unknown()) });
    expect(dropWireNulls({ meta: { discount: null, tax: 0 } }, schema)).toEqual({
      meta: { discount: null, tax: 0 },
    });
  });

  it("never strips a null inside an opaque z.unknown() field", () => {
    const schema = z.object({ blob: z.unknown() });
    expect(dropWireNulls({ blob: { a: null, b: 1 } }, schema)).toEqual({ blob: { a: null, b: 1 } });
  });

  it("keeps a null on a .nullable() field, which declares null a legal value", () => {
    const schema = z.object({ note: z.string().nullable() });
    expect(dropWireNulls({ note: null }, schema)).toEqual({ note: null });
  });

  it("keeps a null on a .default() field rather than inventing the default", () => {
    const schema = z.object({ n: z.number().default(3) });
    expect(dropWireNulls({ n: null }, schema)).toEqual({ n: null });
  });

  it("leaves an undeclared key alone — Schema.parse is what strips it", () => {
    const schema = z.object({ url: z.string() });
    expect(dropWireNulls({ url: "https://x", extra: null }, schema)).toEqual({
      url: "https://x",
      extra: null,
    });
  });
});

describe("wireOutput", () => {
  it("reads main_stuff and normalizes it in one step", () => {
    const results: RunResults = {
      pipeline_run_id: "run-1",
      main_stuff: { url: "https://x", caption: null },
    };
    expect(wireOutput(results, ImageSchema)).toEqual({ url: "https://x" });
  });

  it("reads only main_stuff — a matching pipe_output entry must not rescue it", () => {
    const results = {
      pipeline_run_id: "run-1",
      main_stuff: { caption: "no url here" },
      pipe_output: { working_memory: { root: { e: { content: { url: "https://ignored" } } } } },
    } as unknown as RunResults;
    expect(wireOutput(results, ImageSchema)).toEqual({ caption: "no url here" });
  });

  it.each([0, false, ""])("passes a falsy scalar main_stuff through: %s", (main_stuff) => {
    const results = { pipeline_run_id: "run-1", main_stuff } as unknown as RunResults;
    expect(wireOutput(results, ImageSchema)).toBe(main_stuff);
    expect(ImageSchema.safeParse(wireOutput(results, ImageSchema)).success).toBe(false);
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

describe("dropWireNulls recursion depth", () => {
  // A self-referential concept — `z.lazy()` is how a concept reference projects,
  // and the walk resolves it, so the schema stops bounding the descent and the
  // payload starts driving it.
  interface Node {
    label: string;
    caption?: string;
    child?: Node;
  }
  const NodeSchema: z.ZodType<Node> = z.lazy(() =>
    z.object({
      label: z.string(),
      caption: z.string().optional(),
      child: NodeSchema.optional(),
    }),
  );

  /** A chain `depth` levels deep, every level carrying a `null` caption. */
  function chain(depth: number): Record<string, unknown> {
    let node: Record<string, unknown> = { label: "leaf", caption: null };
    for (let i = 0; i < depth; i += 1) {
      node = { label: `n${i}`, caption: null, child: node };
    }
    return node;
  }

  it("strips nulls through a recursive concept, below the cap", () => {
    const result = dropWireNulls(chain(3), NodeSchema) as Record<string, unknown>;
    expect(NodeSchema.safeParse(result).success).toBe(true);
    expect(result).not.toHaveProperty("caption");
  });

  it("returns the value untouched past the cap instead of recursing forever", () => {
    // The generated schema still owns the verdict — this only stops the walk.
    const deep = chain(MAX_WIRE_DEPTH + 10);
    expect(() => dropWireNulls(deep, NodeSchema)).not.toThrow();
  });

  it("survives a pathologically deep payload without overflowing the stack", () => {
    expect(() => dropWireNulls(chain(50_000), NodeSchema)).not.toThrow();
  });
});
