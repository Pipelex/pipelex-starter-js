import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RunField } from "@pipelex/mthds-form";
import { RunInputsForm } from "./RunInputsForm";

/**
 * Fields as `useRunInputs` derives them from a contract. Written inline rather
 * than taken from a generated contract on purpose: no method in `methods/` has
 * an optional input, so the case this file exists for is unreachable from the
 * committed artifacts — and it is the case adopters inherit.
 */
function textField(name: string, required: boolean): RunField {
  return {
    name,
    kind: "text",
    required,
    concept: "native.Text",
    json_schema: { type: "object", properties: { text: { type: "string" } } },
  } as unknown as RunField;
}

const FIELDS = [textField("subject", true), textField("note", false)];

/** Render with controlled values, the way the forms do. */
function Harness({ initial }: { initial: Record<string, unknown> }) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  return (
    <RunInputsForm fields={FIELDS} values={values} onValuesChange={setValues} disabled={false} />
  );
}

describe("RunInputsForm", () => {
  it("opens with an empty optional input folded away, behind a toggle", () => {
    render(<Harness initial={{}} />);
    expect(screen.getByRole("textbox", { name: /subject/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /note/i })).not.toBeInTheDocument();
    // Folded, never stranded: anything hidden puts the toggle on screen.
    expect(screen.getByRole("button", { name: /optional/i })).toBeInTheDocument();
  });

  it("shows a seeded optional input, and keeps it mounted when it is cleared", () => {
    render(<Harness initial={{ note: { text: "seeded" } }} />);
    const note = screen.getByRole("textbox", { name: /note/i });
    note.focus();

    // The regression this guards: foldability recomputed from the live value
    // makes clearing the last character move the field into the folded set,
    // unmounting the control mid-edit and dropping focus to <body>. Decided
    // once at mount, the field stays put — so it is still the same DOM node,
    // and the caret is still in it.
    fireEvent.change(note, { target: { value: "" } });

    expect(screen.getByRole("textbox", { name: /note/i })).toBe(note);
    expect(document.activeElement).toBe(note);
  });
});
