import { describe, it, expect } from "vitest";
import type { PipeIOContracts } from "@pipelex/mthds-form";
import { gateRunInputs, requireContract } from "./runInputs";
import { PIPE_IO_CONTRACTS } from "@/generated/extract-entities/contracts";
import { PIPE_IO_CONTRACTS as PDF_CONTRACTS } from "@/generated/summarize-pdf/contracts";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");
/** A file-shaped input, to cover the `{url}` envelope alongside `{text}`. */
const PDF_CONTRACT = requireContract(PDF_CONTRACTS, "summarize_pdf", "summarize_pdf");

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

  it("rejects a required input that arrived present but empty", () => {
    // The schema is satisfied here — ajv's `required` only asserts the key is
    // present, and the contracts carry no `minLength`. This is the payload the
    // kernel itself produces from an untouched form (`rjsfDataFromRunValues`),
    // so an empty string reaching a paid run is the natural failure, not a
    // contrived one. The browser refuses it via readiness; so must this side.
    const result = gateRunInputs(CONTRACT, { text: { text: "" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("bad_request");
    expect(result.error.title).toBe("Input required");
    expect(result.error.details).toContain("text");
  });

  it("still accepts a filled input, so the emptiness check is not over-eager", () => {
    const result = gateRunInputs(CONTRACT, { text: { text: "Ada met Charles" } });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty file input, where the byte check cannot catch it", () => {
    // The file-shaped equivalent, and the costlier one: `checkDocumentBytes`
    // no-ops on anything that is not a `data:` URL, so an empty `url` would
    // sail past it into `prepareInputs` and start a run.
    const result = gateRunInputs(PDF_CONTRACT, { document: { url: "" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.title).toBe("Input required");
    expect(result.error.details).toContain("document");
  });

  it("accepts a file input that carries a URL but no bytes", () => {
    // The kernel's "paste a URL instead" path — filled, so the gate passes it
    // and resolving it is `prepareInputs`' job.
    const result = gateRunInputs(PDF_CONTRACT, { document: { url: "https://example.com/a.pdf" } });
    expect(result.ok).toBe(true);
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
    // Assert the rendered wording, not merely that *something* was rendered:
    // `invalidInputsError` falls back to a fixed sentence when the lines come
    // back empty, so `not.toBe("")` would hold even if the translator produced
    // nothing. This is the only test that exercises `VALIDATION_MESSAGES`.
    expect(result.error.details).toContain("must be string");
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
