import { fireEvent, screen } from "@testing-library/react";
import { specFromJsonl } from "@pipelex/mthds-form/generative";
import type { MethodDesign } from "@/lib/design";

/**
 * Test handles for a tab that opens on its designed page.
 *
 * Every method in this template carries a committed design, so every tab opens
 * on the page a model laid out rather than on the kernel's plain form. That is
 * the product behaviour and the tests follow it — but a form test is about the
 * run path, not about somebody's copy, and **every label, button name and
 * section title on a designed page is the model's**, re-written whenever the
 * design is re-produced. So a test that wants to drive the inputs switches to
 * the plain form first, whose names are this repo's own and stable.
 *
 * A test that wants the designed page reaches its call to action through
 * `ctaLabelOf`, which reads the label out of the committed layout rather than
 * spelling it out — the only way an assertion about a produced artifact can be
 * honest.
 */

/**
 * Click the "Plain form" side of the view toggle.
 *
 * It throws when the toggle is not there, and that is the point: the toggle is
 * rendered only when the tab's design was accepted, so a design that quietly
 * stopped fitting fails the suite here instead of leaving every plain-form
 * assertion below passing against the wrong view.
 */
export function showPlainForm(): void {
  fireEvent.click(screen.getByRole("radio", { name: "Plain form" }));
}

/** The label the committed layout gives its call to action. */
export function ctaLabelOf(design: MethodDesign | null): string {
  if (design === null) return "";
  const spec = specFromJsonl(design.jsonl);
  const cta = Object.values(spec.elements ?? {}).find(
    (element) => (element as { type?: string }).type === "Cta",
  ) as { props?: { label?: string } } | undefined;
  return cta?.props?.label ?? "";
}
