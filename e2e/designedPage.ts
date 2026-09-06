import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * The helpers the two designed tabs need, and the reason they exist.
 *
 * A tab whose method carries a committed design opens on the page a model laid
 * out, and every label on that page is the model's — re-written whenever the
 * design is re-produced. So a spec picks one of two footings, deliberately:
 *
 *  - `showPlainForm` — one click on chrome this repo names, after which the
 *    spec's role-and-name selectors are about the run path rather than about
 *    somebody's copy. That is what the live specs do.
 *  - `ctaLabel` — read the call to action out of the committed layout at spec
 *    time. That is what the designed-page spec does, so a re-produced design
 *    moves the spec with it instead of breaking it.
 */

/** Switch a tab to the kernel's plain form. Harmless on a tab that has no design. */
export async function showPlainForm(page: Page): Promise<void> {
  const toggle = page.getByRole("radio", { name: "Plain form" });
  if ((await toggle.count()) > 0) await toggle.click();
}

/**
 * The call to action's label, from `methods/<name>/design.jsonl` as committed.
 *
 * Read by scanning the patch lines rather than by compiling them with the
 * kernel's `specFromJsonl`, and that is a Playwright constraint rather than a
 * preference: the specs are transpiled to CommonJS, and `@pipelex/mthds-form`
 * declares only an `import` condition for its subpaths, so a `require` of
 * `./generative` fails with "not defined by exports". A layout IS its patch
 * lines — root first, one element per line — so finding the one `Cta` in them
 * needs no compiler.
 */
export function ctaLabel(method: string): string {
  const jsonl = readFileSync(path.join(process.cwd(), "methods", method, "design.jsonl"), "utf-8");
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let patch: { value?: { type?: string; props?: { label?: string } } };
    try {
      patch = JSON.parse(line);
    } catch {
      continue; // A line the compiler would skip is a line this skips.
    }
    if (patch.value?.type === "Cta" && patch.value.props?.label) return patch.value.props.label;
  }
  throw new Error(`methods/${method}/design.jsonl has no call to action`);
}
