"use client";

import { useState } from "react";
import { humanizeFieldName } from "@pipelex/mthds-form/react";
import {
  pollTextStatsRun,
  runTextStatsBlocking,
  startTextStatsRun,
} from "@/actions/runTextStatsPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/text-stats/contracts";
import { DESIGN } from "@/generated/text-stats/design";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import type { DesignFallback } from "@/lib/design";
import { requireResultField } from "@/lib/resultField";
import { requireContract, requireInputForm } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { DesignedPage } from "./DesignedPage";
import { DesignFallbackNote } from "./DesignFallbackNote";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunResult } from "./RunResult";
import { RunStatus } from "./RunStatus";
import { ViewToggle, type InputView } from "./ViewToggle";

// Scaffolded by `make add-method` — yours to edit from here on.
//
// The three things this component knows about its method are all committed by
// `npm run codegen`: the form from the input-form descriptor, the result view
// from the output-form descriptor paired with the payload schema, and the page
// from the layout a model designed. There is nothing hand-written to keep in
// step — change what the method takes or produces, regenerate, and all three
// follow.
//
// `DESIGN` is `null` until you take the second gesture, `make design NAME=text-stats`,
// and until then the kernel's plain form renders — which is the fallback rule's
// first case, not a gap.
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "text_stats", "analyze_text");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "text_stats", "analyze_text");
const RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, "text_stats", "analyze_text");
const RESULT_NAME = "text_stats";
/** Prefixes the DOM ids the designed page's escape hatches mint. */
const ID_PREFIX = "text-stats";

export function TextStatsForm() {
  const { fields, values, setValues, ready, toData, design, store } = useRunInputs(
    CONTRACT,
    DESCRIPTOR,
    undefined,
    DESIGN,
  );
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [view, setView] = useState<InputView>("designed");
  const [renderError, setRenderError] = useState<string | null>(null);
  // `useRun` presents one state machine and dispatches to the blocking or
  // durable Server Actions by `mode`. The form never branches on mode itself.
  const { state, run } = useRun({
    mode,
    blocking: runTextStatsBlocking,
    start: startTextStatsRun,
    poll: pollTextStatsRun,
  });

  const running = state.phase === "running";

  // The form kernel's fallback rule, with the render error the boundary reports
  // folded in as its fifth cause. `null` means a designed page is renderable.
  const fallback: DesignFallback | null =
    renderError !== null
      ? { cause: "render_error", message: renderError }
      : design.ok
        ? null
        : design.fallback;
  const designed = fallback === null && design.ok && store !== null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The action gates the same contract server-side, applying the kernel's
    // rules in full — that is the trust boundary; `ready` below is only UX.
    run(toData());
  }

  // Built once and placed in one of two places: under the plain form, or into
  // the designed page's result slot. The same fragment either way, because what
  // a run yields is not a property of how its inputs were laid out.
  const outcome =
    state.phase === "idle" ? null : (
      <>
        {running && (
          <RunStatus status={state.status} elapsedMs={state.elapsedMs} health={state.health} />
        )}
        {state.phase === "error" && <ErrorDisplay error={state.error} />}
        {state.phase === "done" && (
          <>
            {/* The result, rendered from the method's own output contract — the
                scaffold has no design decision to make about a shape it has never
                seen, because there is none left to make. */}
            <RunResult field={RESULT_FIELD} value={state.output} name={RESULT_NAME} />
            <CostReport usage={state.usage} />
          </>
        )}
      </>
    );

  return (
    <div className="space-y-6">
      {/* App chrome, above whichever view is on screen — the two toggles are
          this app's, not the layout's. */}
      <div className="flex flex-wrap items-start gap-4">
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        {design.ok && renderError === null && (
          <ViewToggle value={view} onChange={setView} disabled={running} />
        )}
      </div>

      {designed && view === "designed" ? (
        <DesignedPage
          design={design.design}
          spec={design.spec}
          store={store}
          fields={fields}
          idPrefix={ID_PREFIX}
          env={{ disabled: running }}
          onRun={() => run(toData())}
          result={outcome}
          resultTitle={humanizeFieldName(RESULT_NAME)}
          onRenderError={setRenderError}
        />
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <RunInputsForm
              fields={fields}
              values={values}
              onValuesChange={setValues}
              disabled={running}
            />
            <button
              type="submit"
              disabled={running || !ready}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running…" : "Run text stats"}
            </button>
          </form>
          <DesignFallbackNote fallback={fallback} />
          {outcome}
        </>
      )}
    </div>
  );
}
