import { describe, it, expect } from "vitest";
import {
  computeReadiness,
  fieldsForContract,
  rjsfDataFromRunValues,
  type PipeIOContracts,
} from "@pipelex/mthds-form";
import { gateRunInputs, requireContract, schemaFor } from "./runInputs";
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

describe("schemaFor", () => {
  it("returns the same schema object for a contract, every time", () => {
    // Object *identity*, not deep equality, and that is the whole point: the
    // kernel's ajv singleton caches compiled validators keyed on the schema
    // object and never evicts them, so a fresh-but-equal object per call
    // retains another validator on every request to a public Server Action.
    expect(schemaFor(CONTRACT)).toBe(schemaFor(CONTRACT));
    expect(schemaFor(PDF_CONTRACT)).not.toBe(schemaFor(CONTRACT));
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

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "x"],
    ["an array", []],
  ])("classifies %s as a bad request instead of throwing", (_label, payload) => {
    // A Server Action is a public endpoint and Next does not enforce the
    // declared parameter type. The kernel indexes the payload by variable
    // name without checking it is indexable, so a `null` body used to throw a
    // TypeError that Next stripped to an opaque digest — the one outcome this
    // module promises never happens.
    let result: ReturnType<typeof gateRunInputs> | undefined;
    expect(() => {
      result = gateRunInputs(CONTRACT, payload);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.error.title).toBe("Input required");
    expect(result.error.message).toContain("text");
  });

  it("drops an input the contract does not declare", () => {
    // The gate is the trust boundary, and the PDF action scans exactly what it
    // returns — so a key smuggled past it would reach `prepareInputs`
    // unexamined by `checkFileInputs`. The property holds because the kernel
    // builds the envelope from the *contract's* keys rather than the caller's;
    // nothing here would notice a kernel bump that changed that.
    const result = gateRunInputs(CONTRACT, {
      text: { text: "Ada met Charles" },
      smuggled: { url: "/etc/passwd" },
    });
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

  it("rejects an empty file input, where the byte check cannot catch it", () => {
    // The file-shaped equivalent, and the costlier one. The gate has to catch
    // it: an empty `url` is a well-formed shape, so nothing about the schema
    // objects to it, and a run would start on an input the user never filled.
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

/**
 * The invariant the gate exists to hold, asserted by running *both* sides.
 *
 * `gateRunInputs` is only trustworthy if it refuses everything the Run button
 * refuses; it is only usable if it accepts everything the Run button accepts.
 * Neither direction can be established by reading the two implementations —
 * they call different kernel functions on differently-shaped values — so this
 * table drives the real `computeReadiness` and the real gate over the same
 * inputs and demands the same verdict.
 *
 * The structured case is the one that matters most and the one no method in
 * `methods/` can produce: every committed contract derives to a `prose` or
 * `document` field, and for those `fieldFilled` collapses to `isFilled`, so a
 * gate built on the wrong predicate looks correct against this repo's own
 * methods. It is wrong for the first adopter with an object-shaped concept.
 */
describe("the gate agrees with the Run button", () => {
  const person: PipeIOContracts = {
    "d.p": {
      inputs: {
        person: {
          concept_ref: "d.Person",
          optional: false,
          json_schema: {
            type: "object",
            title: "Person",
            properties: {
              first_name: { type: "string", title: "First name" },
              last_name: { type: "string", title: "Last name" },
            },
            required: ["first_name", "last_name"],
          },
        },
      },
      output: { concept_ref: "native.Text", multiplicity: "single" },
    },
  };

  const allOptional: PipeIOContracts = {
    "d.p": {
      inputs: {
        opts: {
          concept_ref: "d.Options",
          optional: false,
          json_schema: {
            type: "object",
            title: "Options",
            properties: {
              tone: { type: "string", title: "Tone" },
              style: { type: "string", title: "Style" },
            },
          },
        },
      },
      output: { concept_ref: "native.Text", multiplicity: "single" },
    },
  };

  /**
   * A plural input — an `array` json_schema, which is exactly what the kernel's
   * `isPluralInput` keys off. `mustBeFilled` singles those out with an explicit
   * `kind !== "list"` branch: a list never gates, even declared non-optional.
   * No method in `methods/` declares one, so nothing else here reaches that
   * branch.
   */
  const plural: PipeIOContracts = {
    "d.p": {
      inputs: {
        pages: {
          concept_ref: "native.Text",
          optional: false,
          json_schema: {
            type: "array",
            title: "Pages",
            items: {
              type: "object",
              title: "TextContent",
              properties: { text: { type: "string", title: "Text" } },
              required: ["text"],
            },
          },
        },
      },
      output: { concept_ref: "native.Text", multiplicity: "single" },
    },
  };

  const cases: Array<{
    label: string;
    contracts: PipeIOContracts;
    domain: string;
    pipe: string;
    /** Form values as the browser holds them, not the wire shape. */
    values: Record<string, unknown>;
  }> = [
    {
      label: "text untouched",
      contracts: PIPE_IO_CONTRACTS,
      domain: "extract_entities",
      pipe: "extract_entities",
      values: {},
    },
    {
      label: "text filled",
      contracts: PIPE_IO_CONTRACTS,
      domain: "extract_entities",
      pipe: "extract_entities",
      values: { text: "Ada met Charles" },
    },
    {
      label: "document untouched",
      contracts: PDF_CONTRACTS,
      domain: "summarize_pdf",
      pipe: "summarize_pdf",
      values: {},
    },
    {
      label: "document pasted as a URL",
      contracts: PDF_CONTRACTS,
      domain: "summarize_pdf",
      pipe: "summarize_pdf",
      values: { document: { url: "https://example.com/a.pdf" } },
    },
    { label: "struct untouched", contracts: person, domain: "d", pipe: "p", values: {} },
    // Half-filled: `isFilled` says yes (some child), `fieldFilled` says no (a
    // required child is empty). The gate must side with the button.
    {
      label: "struct half-filled",
      contracts: person,
      domain: "d",
      pipe: "p",
      values: { person: { first_name: "Ada", last_name: "" } },
    },
    {
      label: "struct filled",
      contracts: person,
      domain: "d",
      pipe: "p",
      values: { person: { first_name: "Ada", last_name: "Lovelace" } },
    },
    // Nothing required inside, so the button is live on an untouched form; the
    // gate must not then demand it be filled.
    {
      label: "all-optional struct untouched",
      contracts: allOptional,
      domain: "d",
      pipe: "p",
      values: {},
    },
    { label: "plural input untouched", contracts: plural, domain: "d", pipe: "p", values: {} },
    {
      // A bare string array, which is what a `kind: "list"` over a text item
      // holds. The item-shaped `[{text: "first page"}]` looks right and is not:
      // `rjsfDataFromRunValues` drops the content, this case collapses onto the
      // untouched row above, and the filled-plural envelope goes untested.
      label: "plural input with one entry",
      contracts: plural,
      domain: "d",
      pipe: "p",
      values: { pages: ["first page"] },
    },
  ];

  it.each(cases)("$label", ({ contracts, domain, pipe, values }) => {
    const contract = requireContract(contracts, domain, pipe);
    const fields = fieldsForContract(contract);
    const runButtonLive = computeReadiness(fields, values).missing.length === 0;

    // Exactly what the form sends: the hook's `toData()`.
    const gate = gateRunInputs(contract, rjsfDataFromRunValues(values, fields));

    expect(gate.ok).toBe(runButtonLive);
  });

  it("carries a filled list's items into the wire envelope", () => {
    // Agreement alone cannot catch a fixture whose content is silently dropped:
    // both sides say "ready" for an empty list too, so the row above passes
    // either way. Assert the payload the plural case is there to exercise.
    const contract = requireContract(plural, "d", "p");
    const fields = fieldsForContract(contract);
    const gate = gateRunInputs(contract, rjsfDataFromRunValues({ pages: ["first"] }, fields));
    expect(gate).toEqual({
      ok: true,
      inputs: { pages: { concept: "native.Text", content: [{ text: "first" }] } },
    });
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
