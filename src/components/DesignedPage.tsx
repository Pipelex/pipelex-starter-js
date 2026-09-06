"use client";

import { Component, type ReactNode } from "react";
import type { Spec, StateModel, StateStore } from "@json-render/core";
import type { RunField } from "@pipelex/mthds-form";
import { GenerativePage, ResultSlotProvider, fixtureLabel } from "@pipelex/mthds-form/generative";
import { FieldPresentationProvider, type FieldEnv } from "@pipelex/mthds-form/react";
import { BRAND } from "@/brand";
import type { MethodDesign } from "@/lib/design";

interface DesignedPageProps {
  /** The provenance, for the credit line under the page. */
  design: MethodDesign;
  /** The compiled layout, from `acceptDesign`. */
  spec: Spec;
  /** The one store `useRunInputs` created — the same tree the plain form reads. */
  store: StateStore;
  /** The method's input descriptors, for the layout's escape hatches to resolve against. */
  fields: RunField[];
  /** Prefix for the DOM ids the escape hatches mint; two pages on one document need two. */
  idPrefix: string;
  /** What the kernel's controls need: upload, disabled, a resolver. */
  env?: FieldEnv;
  /** The call to action. The page hands over its state; the form runs from its own store. */
  onRun: () => void;
  /** What the page paints under its work column — status, error, result, cost. */
  result?: ReactNode;
  /** The heading above that, humanized by the caller like a tab label. */
  resultTitle?: string;
  /** A render failure, so the tab can fall back to the plain form and say why. */
  onRenderError: (message: string) => void;
}

/**
 * A method's page as a model designed it: the committed layout, rendered over
 * the same descriptor the plain form is built from and bound to the same store.
 *
 * This is the whole of what the app writes for a designed view. The page's
 * grammar — an app bar, a hero, a work column beside a rail ending in the one
 * call to action, a footer — is the layout's, and it renders inside the tab
 * panel because that is what the designer produced; pretending otherwise would
 * make it a bespoke view rather than a rendered artifact. What stays the app's
 * is the run: `onRun` is wired to the same Server Action trio the plain form
 * calls, and `result` is the same status/error/result/cost fragment, handed to
 * the page through `ResultSlotProvider` and painted under the work column.
 *
 * **The call to action is not gated on readiness, deliberately.** The catalog
 * has no such prop, so a press with an input missing reaches `gateRunInputs` on
 * the server and the `bad_request` it returns names the input — in the result
 * slot, where the reader is already looking. That is the trust boundary doing
 * its job rather than a second rule written on top of it.
 *
 * **It IS gated on busy, and that gate has to live here.** `Cta` renders a bare
 * `<button onClick={() => emit("press")}>` and reads nothing from `env` — so
 * unlike every control on the page, it stays live while a run is in flight,
 * where the plain form's submit button carries `disabled={running}`. `useRun`'s
 * `run()` does not refuse a re-entry either: it bumps its staleness token, which
 * abandons the previous run's tracking without cancelling the execution the API
 * is already being paid for. A second press would therefore start a second
 * billed run and show only the last one's result. One guard here covers all
 * five examples and every form `make add-method` will ever scaffold, because
 * `env.disabled` is exactly what each of them already computes — `running`, or
 * `running || resolving` where a file is still encoding. The button cannot be
 * made to LOOK disabled from here (the catalog has no prop for it); the live
 * status card in the result slot is what says a run is under way. Giving `Cta`
 * a busy state is filed upstream.
 *
 * The boundary below is the fallback rule's last case. `acceptDesign` proved the
 * layout compiles, validates and fits before this component was rendered at all,
 * so a throw here is something none of those three could have known — and the
 * answer to it is the same as to the other four: the plain form, and one line
 * saying why.
 */
export function DesignedPage({
  design,
  spec,
  store,
  fields,
  idPrefix,
  env,
  onRun,
  result,
  resultTitle,
  onRenderError,
}: DesignedPageProps) {
  const slot = result ? { content: result, title: resultTitle } : null;

  return (
    <RenderBoundary onError={onRenderError}>
      {/* A full-width band, and it is app chrome rather than a liberty taken
          with the layout. What a designer produces is a PRODUCT page — an app
          bar, a hero, a two-column workspace with a sticky rail — and this
          template's demo column is 672px wide, which renders that page as if
          it were on a phone: the headline breaks one word per line and the
          rail stacks under the work. So the band spans the window and sets its
          own measure, and the app's column goes back to holding the chrome
          above and below it. The negative margins are computed from this
          element's own box, so nothing here assumes how wide the column is. */}
      <div className="mx-[calc(50%-50vw)] overflow-x-clip px-6">
        <div className="mx-auto max-w-6xl">
          {/* The same seam `<RunInputsForm>` and `<RunResult>` use, and it has to
          stay in step with them: humanized labels and no concept pills. A layout
          hands a file, a date or a structure back to the kernel through
          `MthdsField`, and a control rendered there must read the way the same
          control reads on the plain form — the toggle puts the two side by side,
          so a difference in presentation would look like a difference in the
          method. */}
          <FieldPresentationProvider presentation="app">
            <ResultSlotProvider slot={slot}>
              <GenerativePage
                spec={spec}
                store={store}
                scope={{ inputs: fields, env, idPrefix }}
                brand={BRAND}
                // The state the page hands over is the store's, which the form
                // already reads — so the run is started from `toData()` exactly as
                // the plain view starts it, and the two cannot send different
                // inputs. The busy refusal is the one thing this wrapper adds:
                // see the note above.
                onRun={(_state: StateModel) => {
                  if (env?.disabled) return;
                  onRun();
                }}
              />
            </ResultSlotProvider>
          </FieldPresentationProvider>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        This page was designed by {fixtureLabel(design)}, on {design.date}. Switch to the plain form
        above for the same inputs with no layout — one method, rendered two ways, over one store.
      </p>
    </RenderBoundary>
  );
}

interface RenderBoundaryProps {
  onError: (message: string) => void;
  children: ReactNode;
}

/**
 * The fifth fallback cause, caught where nothing else can see it.
 *
 * json-render wraps each element it renders in a boundary of its own, so a
 * component that throws is dropped from the page rather than taking the app
 * down — which means a page can arrive half-rendered and silent. This catches
 * what escapes that, reports it up as a `render_error` cause, and renders
 * nothing, so the tab falls back to the plain form on the next commit.
 */
class RenderBoundary extends Component<RenderBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
