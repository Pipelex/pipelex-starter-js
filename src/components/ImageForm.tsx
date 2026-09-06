"use client";

import { useState } from "react";
import { humanizeFieldName } from "@pipelex/mthds-form/react";
import {
  pollGenerateImageRun,
  runGenerateImageBlocking,
  startGenerateImageRun,
} from "@/actions/runGenerateImagePipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/generate-image/contracts";
import { DESIGN } from "@/generated/generate-image/design";
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

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "generate_image", "generate_image");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "generate_image", "generate_image");
const RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, "generate_image", "generate_image");
const RESULT_NAME = "generated_image";
/** Prefixes the DOM ids the designed page's escape hatches mint. */
const ID_PREFIX = "generate-image";

const SAMPLE_PROMPT =
  "A friendly robot reading a book under a tree, soft watercolor style, warm afternoon light.";

export function ImageForm() {
  const { fields, values, setValues, ready, toData, design, store } = useRunInputs(
    CONTRACT,
    DESCRIPTOR,
    { image_prompt: SAMPLE_PROMPT },
    DESIGN,
  );
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [view, setView] = useState<InputView>("designed");
  const [renderError, setRenderError] = useState<string | null>(null);
  // Headline demo: in durable mode this streams status then returns the image;
  // in blocking mode image generation overruns the ~30s cap and surfaces the
  // classified `execute_timeout` error.
  const { state, run } = useRun({
    mode,
    blocking: runGenerateImageBlocking,
    start: startGenerateImageRun,
    poll: pollGenerateImageRun,
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
              {running ? "Generating…" : "Generate image"}
            </button>
          </form>
          <DesignFallbackNote fallback={fallback} />
          {outcome}
        </>
      )}
    </div>
  );
}
