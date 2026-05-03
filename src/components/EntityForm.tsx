"use client";

import { useState, useTransition } from "react";
import { runHelloPipeline } from "@/actions/runHelloPipeline";
import type { ExtractedEntities } from "@/types/helloPipeline";
import { EntityResult } from "./EntityResult";

const SAMPLE_TEXT =
  "Apple announced new products in Cupertino on March 5th, 2026, with Tim Cook presenting alongside Jony Ive.";

export function EntityForm() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [entities, setEntities] = useState<ExtractedEntities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setEntities(null);
    startTransition(async () => {
      try {
        const result = await runHelloPipeline(text);
        setEntities(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
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
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Extracting…" : "Extract entities"}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {entities && <EntityResult entities={entities} />}
    </div>
  );
}
