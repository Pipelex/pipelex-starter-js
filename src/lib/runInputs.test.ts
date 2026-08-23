import { describe, it, expect } from "vitest";
import type { PipeIOContracts } from "@pipelex/mthds-form";
import { gateRunInputs, requireContract } from "./runInputs";
import { PIPE_IO_CONTRACTS } from "@/generated/extract-entities/contracts";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");

describe("requireContract", () => {
  it("looks a pipe up by domain and pipe code", () => {
    expect(Object.keys(CONTRACT.inputs)).toEqual(["text"]);
  });

  it("throws naming the available keys when the lookup misses", () => {
    // The kernel returns `undefined` on a miss, which renders as an empty form
    // with a live Run button — a silent failure. Loud is the point here.
    expect(() => requireContract(PIPE_IO_CONTRACTS, "extract_entities", "nope")).toThrow(
      /extract_entities\.nope/,
    );
    expect(() => requireContract(PIPE_IO_CONTRACTS, "extract_entities", "nope")).toThrow(
      /extract_entities\.extract_entities/,
    );
  });
});

describe("gateRunInputs", () => {
  it("turns schema-shaped data into the runtime's {concept, content} envelope", () => {
    const result = gateRunInputs(CONTRACT, { text: { text: "Ada met Charles" } });
    expect(result).toEqual({
      ok: true,
      inputs: { text: { concept: "native.Text", content: { text: "Ada met Charles" } } },
    });
  });

  it("returns a bad_request error naming the input the caller left out", () => {
    const result = gateRunInputs(CONTRACT, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("bad_request");
    expect(result.error.title).toBe("Input required");
    expect(result.error.message).toContain("text");
    expect(result.error.details).toContain("text");
  });

  it("falls back to the kernel's error descriptions when nothing can be named missing", () => {
    // A value of the wrong shape passes the missing-input scan (the key is
    // present) but fails ajv, so the verdict carries `errors` and no
    // `missingInputs`. Without the fallback that rejection would be blank.
    // An object where a string belongs: the kernel's ajv runs `coerceTypes`, so
    // a number would quietly become `"42"` — this is a shape it cannot repair.
    const result = gateRunInputs(CONTRACT, { text: { text: { nested: true } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.title).toBe("Invalid input");
    expect(result.error.details).not.toBe("");
  });

  it("omits an optional input the caller left blank, so the runtime sees a real absence", () => {
    const withOptional: PipeIOContracts = {
      "d.p": {
        inputs: {
          note: { concept_ref: "native.Text", optional: true, ...textSchema() },
        },
        output: { concept_ref: "native.Text", multiplicity: "single" },
      },
    };
    const contract = requireContract(withOptional, "d", "p");
    expect(gateRunInputs(contract, {})).toEqual({ ok: true, inputs: {} });
  });
});

function textSchema() {
  return {
    json_schema: {
      type: "object",
      title: "TextContent",
      properties: { text: { type: "string", title: "Text" } },
      required: ["text"],
    },
  };
}
