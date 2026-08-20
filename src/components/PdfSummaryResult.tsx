import type { DocumentSummary } from "@/types/summarizePipeline";

interface PdfSummaryResultProps {
  summary: DocumentSummary;
}

export function PdfSummaryResult({ summary }: PdfSummaryResultProps) {
  return (
    <section
      aria-label="Document summary"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-900">{summary.title}</h3>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
          {summary.doc_type}
        </span>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Key points
        </h4>
        {summary.key_points.length === 0 ? (
          <p className="text-sm italic text-slate-400">None</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-800">
            {summary.key_points.map((point) => (
              <li key={point} className="rounded bg-slate-100 px-2 py-1">
                {point}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
