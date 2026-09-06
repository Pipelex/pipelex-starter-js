"use client";

import { useState } from "react";
import { humanizeFieldName } from "@pipelex/mthds-form/react";
import {
  pollExtractEntitiesRun,
  runExtractEntitiesBlocking,
  startExtractEntitiesRun,
} from "@/actions/runExtractEntitiesPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/extract-entities/contracts";
import { DESIGN } from "@/generated/extract-entities/design";
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

// Everything this component knows about its method, committed by `npm run
// codegen`: what it takes, what it produces, and how its page looks. The form
// from the input-form descriptor, the result view from the output-form
// descriptor paired with the payload schema, the page from the layout a model
// designed — and `null` there is the ordinary state, not a gap.
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "extract_entities", "extract_entities");
const RESULT_FIELD = requireResultField(
  OUTPUT_FORM,
  CONTRACT,
  "extract_entities",
  "extract_entities",
);
const RESULT_NAME = "extracted_entities";
/** Prefixes the DOM ids the designed page's escape hatches mint. */
const ID_PREFIX = "extract-entities";

const SAMPLE_TEXT =
  "Apple announced new products in Cupertino on March 5th, 2026, with Tim Cook presenting alongside Jony Ive.";

export function EntityForm() {
  const { fields, values, setValues, ready, toData, design, store } = useRunInputs(
    CONTRACT,
    DESCRIPTOR,
    { text: SAMPLE_TEXT },
    DESIGN,
  );
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [view, setView] = useState<InputView>("designed");
  const [renderError, setRenderError] = useState<string | null>(null);
  // `useRun` presents one state machine and dispatches to the blocking or
  // durable Server Actions by `mode`. The form never branches on mode itself.
  const { state, run } = useRun({
    mode,
    blocking: runExtractEntitiesBlocking,
    start: startExtractEntitiesRun,
    poll: pollExtractEntitiesRun,
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
            <RunResult field={RESULT_FIELD} value={state.output} name={RESULT_NAME} />
            <CostReport usage={state.usage} />
          </>
        )}
      </>
    );

  return (
    <div className="space-y-6">
      {/* App chrome, above whichever view is on screen — the two toggles are
          this app's, not the layout's, and the designed page has no place for
          them in its grammar. */}
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
              {running ? "Extracting…" : "Extract entities"}
            </button>
          </form>
          <DesignFallbackNote fallback={fallback} />
          {outcome}
        </>
      )}
    </div>
  );
}
