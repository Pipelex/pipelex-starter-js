"use client";

import { useState } from "react";
import { pollHelloRun, runHelloBlocking, startHelloRun } from "@/actions/runHelloPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { useRun } from "@/hooks/useRun";
import { EntityResult } from "./EntityResult";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunStatus } from "./RunStatus";

const SAMPLE_TEXT =
  "Apple announced new products in Cupertino on March 5th, 2026, with Tim Cook presenting alongside Jony Ive.";

export function EntityForm() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  // `useRun` presents one state machine and dispatches to the blocking or
  // durable Server Actions by `mode`. The form never branches on mode itself.
  const { state, run } = useRun({
    mode,
    blocking: runHelloBlocking,
    start: startHelloRun,
    poll: pollHelloRun,
  });

  const running = state.phase === "running";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(text); // the action trims + guards empty input
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label htmlFor="input-text" className="block text-sm font-medium text-slate-700">
          Input text
        </label>
        <textarea
          id="input-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-slate-500 focus:outline-none"
          disabled={running}
        />
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        <button
          type="submit"
          disabled={running || !text.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Extracting…" : "Extract entities"}
        </button>
      </form>

      {running && (
        <RunStatus status={state.status} elapsedMs={state.elapsedMs} degraded={state.degraded} />
      )}
      {state.phase === "error" && <ErrorDisplay error={state.error} />}
      {state.phase === "done" && <EntityResult entities={state.output} />}
    </div>
  );
}
