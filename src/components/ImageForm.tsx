"use client";

import { useState } from "react";
import {
  pollGenerateImageRun,
  runGenerateImageBlocking,
  startGenerateImageRun,
} from "@/actions/runGenerateImagePipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { PIPE_IO_CONTRACTS } from "@/generated/generate-image/contracts";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import { requireContract } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { ImageResult } from "./ImageResult";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunStatus } from "./RunStatus";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "generate_image", "generate_image");

const SAMPLE_PROMPT =
  "A friendly robot reading a book under a tree, soft watercolor style, warm afternoon light.";

export function ImageForm() {
  const { fields, values, setValues, ready, toData } = useRunInputs(CONTRACT, {
    image_prompt: SAMPLE_PROMPT,
  });
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          {running ? "Generating…" : "Generate image"}
        </button>
      </form>

      {running && (
        <RunStatus status={state.status} elapsedMs={state.elapsedMs} health={state.health} />
      )}
      {state.phase === "error" && <ErrorDisplay error={state.error} />}
      {state.phase === "done" && (
        <>
          <ImageResult image={state.output} />
          <CostReport usage={state.usage} />
        </>
      )}
    </div>
  );
}
