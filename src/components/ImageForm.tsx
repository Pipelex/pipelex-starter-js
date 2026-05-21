"use client";

import { useState, useTransition } from "react";
import { runGenerateImagePipeline } from "@/actions/runGenerateImagePipeline";
import type { GeneratedImage } from "@/types/generateImagePipeline";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import { ImageResult } from "./ImageResult";
import { ErrorDisplay } from "./ErrorDisplay";

const SAMPLE_PROMPT =
  "A friendly robot reading a book under a tree, soft watercolor style, warm afternoon light.";

export function ImageForm() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<PipelineError | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImage(null);
    startTransition(async () => {
      try {
        const result = await runGenerateImagePipeline(prompt);
        if (result.ok) {
          setImage(result.image);
        } else {
          setError(result.error);
        }
      } catch (err) {
        // A rejection here is a transport-layer failure — the action's own
        // try/catch turns application errors into `{ ok: false }`. See the
        // matching comment in EntityForm.
        setError(classifyTransportError(err));
      }
    });
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
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !prompt.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate image"}
        </button>
      </form>

      {error && <ErrorDisplay error={error} />}

      {image && <ImageResult image={image} />}
    </div>
  );
}
