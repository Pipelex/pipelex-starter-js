import type { Spec } from "@json-render/core";
import type { RunField } from "@pipelex/mthds-form";
import {
  PROMPT_HASH,
  catalog,
  formatProblems,
  layoutProblems,
  specFromJsonl,
  validateAgainstCatalog,
  type Producer,
} from "@pipelex/mthds-form/generative";

/**
 * The third committed artifact about a method: the page a model designed for it.
 *
 * `methods/<name>/design.jsonl` is the layout — json-render patch lines, one per
 * line, exactly as the designer method emitted them — and `design.json` is its
 * provenance. `npm run codegen` projects the pair into
 * `src/generated/<name>/design.ts` as `DESIGN`, which is `null` for a method
 * nobody has designed a page for yet. That projection is why a form can import
 * its design unconditionally, at module level, beside `CONTRACT`, `DESCRIPTOR`
 * and `RESULT_FIELD`.
 *
 * What a design is allowed to say is the form kernel's first rule, one level
 * out: **a layout names a path, and almost nothing more.** It never restates a
 * field's kind, its bounds or its choices — the descriptor still owns all of
 * that, derived from the method as it always was. So a design cannot go out of
 * date about those, and the two questions this file asks are the ones that
 * remain: was it written in the vocabulary this kernel renders, and does it
 * still fit this method.
 *
 * The **almost** is worth knowing, because it is the one place the rule is
 * softer than it sounds. A layout carries its own labels, and the catalog
 * offers the model a `checks` prop — so a produced layout usually binds
 * `required` to the input a run cannot go without, and four of the five
 * committed here do. Nothing compares that against the descriptor, in this file
 * or in the gate, so a method whose input became optional would keep a page
 * that still insists on it. What covers it is the third question `npm run
 * design:check` asks and this file cannot: the record signs the hash of every
 * source the method is generated from, so any edit to a `.mthds` reddens the
 * gate and asks for the page again. Narrowing what the catalog offers belongs
 * to `@pipelex/mthds-form`; a layout is never edited here to close the gap.
 */

/** The provenance the projection carries into the app, plus the layout itself. */
export interface MethodDesign {
  /** `<domain>.<pipe_code>` — the pipe this page was designed for. */
  pipeRef: string;
  /** What made the page. Named after what produced it, never after a role. */
  producer: Producer;
  /** The model id the producer ran with. */
  model: string;
  /** The creative seed handed over with the brief, verbatim, when one was. */
  seed?: string;
  /** The first twelve hex digits of the SHA-256 of the catalog prompt it was produced against. */
  promptHash: string;
  /** The day it was produced, `YYYY-MM-DD`. */
  date: string;
  /** The patch lines, exactly as emitted. */
  jsonl: string;
}

/**
 * `methods/<name>/design.json` — the provenance on disk.
 *
 * It carries two facts the projection deliberately does not: the SHA-256 of
 * every source the method is generated from, which is what makes "edited the
 * method, forgot to re-design" a red `design:check` rather than a page that
 * quietly stopped fitting, and the SHA-256 of the JSONL beside it, which is what
 * makes a hand-edited layout one too. Neither is any of the app's business at
 * runtime, where `acceptDesign` re-asks the questions that matter directly.
 */
export interface DesignRecord extends Omit<MethodDesign, "jsonl"> {
  /** Repo-relative path → SHA-256 — the same map `sources.json` records. */
  sources: Record<string, string>;
  /** SHA-256 of `design.jsonl`. */
  jsonlSha256: string;
}

/** Why the plain form is rendering instead of a designed page. */
export type DesignFallback =
  /** No design was ever produced for this method. Not a failure — the first case. */
  | { cause: "none" }
  /** Produced against a catalog prompt this kernel no longer ships. */
  | { cause: "prompt_hash"; produced: string; installed: string }
  /** Not written in the vocabulary this kernel renders. */
  | { cause: "invalid"; problems: string }
  /** No longer fits the method: a path it names is gone, or a required input is not offered. */
  | { cause: "unfit"; problems: string[] }
  /** The page threw while rendering. Reported by `DesignedPage`'s boundary, not by `acceptDesign`. */
  | { cause: "render_error"; message: string };

export type DesignVerdict =
  | { ok: true; spec: Spec; design: MethodDesign }
  | { ok: false; fallback: DesignFallback };

/**
 * The runtime gate — the form kernel's own fallback rule, applied in order.
 *
 * `npm run design:check` already proved all of this offline, in CI, on every
 * committed design. This runs anyway, and that is deliberate: the fallback is
 * the product's safety, and a template that only ever exercised the happy path
 * would be teaching the wrong thing to every reader who copies it.
 *
 * The order is cheapest first. The prompt hash is a string comparison against a
 * constant the kernel pins, and it is the condition a package bump moves — so a
 * design produced for an older catalog is refused before anything tries to
 * compile it in a vocabulary that has since changed.
 */
export function acceptDesign(
  design: MethodDesign | null,
  fields: readonly RunField[],
): DesignVerdict {
  if (!design) return { ok: false, fallback: { cause: "none" } };

  if (design.promptHash !== PROMPT_HASH) {
    return {
      ok: false,
      fallback: { cause: "prompt_hash", produced: design.promptHash, installed: PROMPT_HASH },
    };
  }

  let spec: Spec;
  try {
    spec = specFromJsonl(design.jsonl);
  } catch (error) {
    // `specFromJsonl` skips a line it cannot apply rather than throwing, so this
    // is the belt for a shape nobody has met yet — never the normal path.
    return {
      ok: false,
      fallback: {
        cause: "invalid",
        problems: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const verdict = validateAgainstCatalog(spec, catalog);
  if (!verdict.ok) {
    return {
      ok: false,
      fallback: { cause: "invalid", problems: formatProblems(verdict.problems) },
    };
  }

  // `layoutProblems` rather than `layoutFits`, for the same reason the validator
  // answers with problems: a fallback the reader cannot account for is one they
  // will assume is a bug in the template.
  const problems = layoutProblems({ inputs: fields }, spec);
  if (problems.length > 0) return { ok: false, fallback: { cause: "unfit", problems } };

  return { ok: true, spec, design };
}

/**
 * The one line a tab prints under its plain form when a design was refused —
 * the same shape `<RunResult>` uses to say which URL it would not display.
 *
 * `none` returns `null`: a method with no design is the fallback rule's first
 * case and its ordinary state, not something to apologise for on screen.
 */
export function describeFallback(fallback: DesignFallback): string | null {
  switch (fallback.cause) {
    case "none":
      return null;
    case "prompt_hash":
      return (
        `This method's designed page was produced against catalog prompt ${fallback.produced}, ` +
        `and @pipelex/mthds-form now ships ${fallback.installed}. ` +
        "Re-run `npm run design` to produce one against the current catalog."
      );
    case "invalid":
      return `This method's designed page is not valid against the form kernel's catalog: ${fallback.problems}`;
    case "unfit":
      return (
        "This method's designed page no longer fits the method: " +
        `${fallback.problems.join("; ")}. Re-run \`npm run design\` after a method edit.`
      );
    case "render_error":
      return `This method's designed page failed to render: ${fallback.message}`;
    default:
      return fallback satisfies never;
  }
}
