"use client";

import { useState } from "react";
import { humanizeFieldName } from "@pipelex/mthds-form/react";
import {
  pollComplexFormRun,
  runComplexFormBlocking,
  startComplexFormRun,
} from "@/actions/runComplexFormPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/complex-form/contracts";
import { DESIGN } from "@/generated/complex-form/design";
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

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "complex_form", "extract_brief");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "complex_form", "extract_brief");
const RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, "complex_form", "extract_brief");
const RESULT_NAME = "extraction_brief";
/** Prefixes the DOM ids the designed page's escape hatches mint. */
const ID_PREFIX = "complex-form";

const SAMPLE_TEXT =
  "Apple announced new products in Cupertino on March 5th, 2026, with Tim Cook presenting alongside Jony Ive.";

/**
 * The same composition as `EntityForm` — `useRunInputs` + `<RunInputsForm>` or
 * `<DesignedPage>` + `useRun` — over a method that declares more than one plain
 * text input.
 *
 * That is the entire point of this example, and it is best appreciated by
 * diffing it against `EntityForm.tsx`: this file is not longer, and it names no
 * input. The optional structured input (a nested card with an enum child and
 * its own optional-folding), the plural input (a repeater), the fold-away of
 * empty optionals and the readiness rule that ignores both all arrive from the
 * contract `npm run codegen` committed beside the bundle.
 */
export function ComplexForm() {
  const { fields, values, setValues, ready, toData, design, store } = useRunInputs(
    CONTRACT,
    DESCRIPTOR,
    { text: SAMPLE_TEXT },
    DESIGN,
  );
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [view, setView] = useState<InputView>("designed");
  const [renderError, setRenderError] = useState<string | null>(null);
  const { state, run } = useRun({
    mode,
    blocking: runComplexFormBlocking,
    start: startComplexFormRun,
    poll: pollComplexFormRun,
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
    run(toData());
  }

  // Built once and placed in one of two places: under the plain form, or into
  // the designed page's result slot.
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
      {/* App chrome, above whichever view is on screen. */}
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
              {running ? "Extracting…" : "Extract brief"}
            </button>
          </form>
          <DesignFallbackNote fallback={fallback} />
          {outcome}
        </>
      )}
    </div>
  );
}
