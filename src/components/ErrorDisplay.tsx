import type { PipelineError } from "@/lib/errors";

interface ErrorDisplayProps {
  error: PipelineError;
}

export function ErrorDisplay({ error }: ErrorDisplayProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900"
    >
      <div>
        <h2 className="text-base font-semibold">{error.title}</h2>
        <p className="mt-1 text-red-800">{error.message}</p>
      </div>

      {error.apiMessage && (
        <figure className="rounded-md border border-red-200 bg-white/70 p-3">
          <figcaption className="text-xs font-medium uppercase tracking-wide text-red-700">
            What the Pipelex API returned
          </figcaption>
          <blockquote className="mt-1 border-l-2 border-red-300 pl-3 italic text-red-800">
            {error.apiMessage}
          </blockquote>
        </figure>
      )}

      {error.hint && (
        <div className="rounded-md border border-red-200 bg-white p-3">
          <p className="font-medium text-slate-800">{error.hint.summary}</p>
          {error.hint.code && (
            <pre
              className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"
              data-language={error.hint.codeLanguage}
            >
              <code>{error.hint.code}</code>
            </pre>
          )}
          {error.hint.docs && (
            <a
              href={error.hint.docs.href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-xs font-medium text-blue-700 underline"
            >
              {error.hint.docs.label} →
            </a>
          )}
        </div>
      )}

      <details className="text-xs text-red-700">
        <summary className="cursor-pointer select-none font-medium">Technical details</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono">
          {error.details}
        </pre>
      </details>
    </div>
  );
}
