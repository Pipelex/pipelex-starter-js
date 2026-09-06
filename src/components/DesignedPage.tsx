"use client";

import { Component, type ReactNode } from "react";
import type { Spec, StateModel, StateStore } from "@json-render/core";
import type { RunField } from "@pipelex/mthds-form";
import { GenerativePage, ResultSlotProvider, fixtureLabel } from "@pipelex/mthds-form/generative";
import type { FieldEnv } from "@pipelex/mthds-form/react";
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
      <ResultSlotProvider slot={slot}>
        <GenerativePage
          spec={spec}
          store={store}
          scope={{ inputs: fields, env, idPrefix }}
          brand={BRAND}
          // The state the page hands over is the store's, which the form already
          // reads — so the run is started from `toData()` exactly as the plain
          // view starts it, and the two views cannot send different inputs.
          onRun={(_state: StateModel) => onRun()}
        />
      </ResultSlotProvider>
      <p className="mt-4 text-xs text-slate-500">
        This page was designed by {fixtureLabel(design)}, on {design.date}. The form below the
        toggle is the same inputs, rendered by the kernel from the method&apos;s own descriptor.
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
