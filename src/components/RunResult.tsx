"use client";

import type { RunField } from "@pipelex/mthds-form";
import {
  FieldPresentationProvider,
  humanizeFieldName,
  StuffViewer,
} from "@pipelex/mthds-form/react";
import { useMemo } from "react";
import { scrubResultUrls } from "@/lib/resultUrls";

interface RunResultProps {
  /** The method's result descriptor, from `requireResultField`. */
  field: RunField;
  /** The narrowed output — already validated by the method's generated binder. */
  value: unknown;
  /**
   * What this data item is called — the panel's header, the section's accessible
   * name, and the base name of the file the download control writes.
   *
   * App chrome, like the tab label: the descriptor's own name is the engine's
   * `output` for every pipe there has ever been, which is right in the artifact
   * (a pipe's output slot has no authored name) and wrong on screen, where the
   * reader is looking at one data item. Written in the wire's snake_case so
   * `presentation="app"` humanizes it the way it humanizes every field label —
   * `document_summary` reads as "Document summary".
   */
  name: string;
}

/**
 * The one kernel composition on the output side — `<RunInputsForm>`'s twin.
 *
 * The result is rendered from the method's own contract, exactly as the form
 * above it is: `OUTPUT_FORM` says what the output IS (its kind, its nesting,
 * whether it is plural) and the contract's `output.json_schema` says what shape
 * the payload arrives in, and `requireResultField` pairs them into the single
 * `RunField` handed here. Nothing in this component knows what
 * `extract_entities` produces, and nothing inspects the value to decide how to
 * lay it out — swap the method, re-run codegen, and the view follows.
 *
 * `StuffViewer` gives the two views a result actually needs: **Rendered**, the
 * descriptor-driven view for a person, and **JSON**, the verbatim receipt for
 * whoever is debugging the pipe. `presentation="app"` is the same seam
 * `<RunInputsForm>` uses and must stay in step with it: humanized labels and no
 * concept pills, because a result and the form that produced it show the same
 * fields and must read the same way.
 *
 * **The one thing it does re-read is URLs.** `scrubResultUrls` removes any file
 * URL the kernel would act on and this template's policy refuses, because the
 * kernel's own gate accepts every `data:` media type and feeds an unsandboxed
 * `<iframe>`. That is a URL policy, not a shape re-validation: the binder still
 * owns the shape, and a refused reference is reported rather than hidden.
 * `src/lib/resultUrls.ts` carries the rule and the deletion criteria.
 *
 * **Not wired yet, and deliberately:** a `pipelex-storage://` reference resolves
 * nowhere in a browser, and the kernel's seam for exchanging one is a
 * `<ResultEnvProvider resolveUrl>` mounted above this. The hosted runtime
 * returns a signed `public_url` beside the storage URI and the kernel's file
 * arms prefer it, so every file this template produces displays without one —
 * which is why a resolver over the SDK's `resolveStorageUrl` is a follow-up
 * rather than a prerequisite. Add it as one provider high in the tree, not as a
 * prop threaded through here.
 */
export function RunResult({ field, value, name }: RunResultProps) {
  const { value: shown, refused } = useMemo(() => scrubResultUrls(field, value), [field, value]);

  return (
    // A labelled region rather than a bare wrapper: the kernel's header is a
    // styled span, not a heading, so without this the result is a stretch of
    // content a screen reader cannot jump to or name. One per screen — a hidden
    // tab panel is out of the accessibility tree, so the tabs cannot collide.
    <section aria-label={humanizeFieldName(name)}>
      <FieldPresentationProvider presentation="app">
        <StuffViewer field={field} value={shown} name={name} />
      </FieldPresentationProvider>
      {refused.length > 0 && (
        // Said out loud rather than swallowed: the JSON view is billed as the
        // verbatim receipt, so a payload it no longer shows in full has to
        // account for the difference.
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-medium">Some file references were not displayed.</span> This run
          returned a URL at {refused.join(", ")} that the result view refuses to hand a browser —
          only <code>https:</code> URLs and PNG, JPEG or WebP <code>data:</code> URLs are shown.
        </p>
      )}
    </section>
  );
}
