"use client";

import { useState } from "react";
import {
  pollTextStatsRun,
  runTextStatsBlocking,
  startTextStatsRun,
} from "@/actions/runTextStatsPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/text-stats/contracts";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import { requireContract, requireInputForm } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { ErrorDisplay } from "./ErrorDisplay";
import { JsonResult } from "./JsonResult";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunStatus } from "./RunStatus";

// Scaffolded by `make add-method` — yours to edit from here on.
//
// The form is derived from the method's own wire descriptor and contract,
// committed by `npm run codegen` beside the generated output types. There are no
// hand-written fields to keep in step: change what the method takes, regenerate,
// and the form follows.
const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "text_stats", "analyze_text");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "text_stats", "analyze_text");

export function TextStatsForm() {
  const { fields, values, setValues, ready, toData } = useRunInputs(CONTRACT, DESCRIPTOR);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  // `useRun` presents one state machine and dispatches to the blocking or
  // durable Server Actions by `mode`. The form never branches on mode itself.
  const { state, run } = useRun({
    mode,
    blocking: runTextStatsBlocking,
    start: startTextStatsRun,
    poll: pollTextStatsRun,
  });

  const running = state.phase === "running";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The action gates the same contract server-side, applying the kernel's
    // rules in full — that is the trust boundary; `ready` below is only UX.
    run(toData());
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <RunInputsForm
          fields={fields}
          values={values}
          onValuesChange={setValues}
          disabled={running}
        />
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        <button
          type="submit"
          disabled={running || !ready}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : "Run text stats"}
        </button>
      </form>

      {running && (
        <RunStatus status={state.status} elapsedMs={state.elapsedMs} health={state.health} />
      )}
      {state.phase === "error" && <ErrorDisplay error={state.error} />}
      {state.phase === "done" && (
        <>
          {/* The honest view for a shape nobody designed a component for. Replace
              <JsonResult> with one of your own once you know the output —
              `EntityResult` and `PdfSummaryResult` are what that looks like. The
              value is already typed by the narrower. */}
          <JsonResult value={state.output} label="Text stats output" />
          <CostReport usage={state.usage} />
        </>
      )}
    </div>
  );
}
