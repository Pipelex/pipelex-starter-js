"use client";

import { useState } from "react";
import {
  pollGenerateImageRun,
  runGenerateImageBlocking,
  startGenerateImageRun,
} from "@/actions/runGenerateImagePipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { useRun } from "@/hooks/useRun";
import { ImageResult } from "./ImageResult";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunStatus } from "./RunStatus";

const SAMPLE_PROMPT =
  "A friendly robot reading a book under a tree, soft watercolor style, warm afternoon light.";

export function ImageForm() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
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
    run(prompt); // the action trims + guards empty input
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label htmlFor="image-prompt" className="block text-sm font-medium text-slate-700">
          Image prompt
        </label>
        <textarea
          id="image-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-slate-500 focus:outline-none"
          disabled={running}
        />
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        <button
          type="submit"
          disabled={running || !prompt.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Generating…" : "Generate image"}
        </button>
      </form>

      {running && (
        <RunStatus status={state.status} elapsedMs={state.elapsedMs} degraded={state.degraded} />
      )}
      {state.phase === "error" && <ErrorDisplay error={state.error} />}
      {state.phase === "done" && <ImageResult image={state.output} />}
    </div>
  );
}
