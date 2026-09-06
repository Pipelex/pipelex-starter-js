import { describe, expect, it } from "vitest";
import { brandManifestSchema } from "@pipelex/mthds-form/generative";
import { BRAND } from "./brand";

describe("BRAND", () => {
  // The manifest is hand-written data a reader is invited to edit, and the
  // kernel parses it at render time — where a typo costs an app bar and a
  // console line nobody is watching. Parsed here instead, so it costs a check.
  it("parses against the form kernel's own schema", () => {
    expect(() => brandManifestSchema.parse(BRAND)).not.toThrow();
  });
});
