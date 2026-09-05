import type { ExtractionBrief } from "@/types/complexFormPipeline";

interface ComplexFormResultProps {
  brief: ExtractionBrief;
}

export function ComplexFormResult({ brief }: ComplexFormResultProps) {
  return (
    <section
      aria-label="Extraction brief"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <p className="text-sm leading-relaxed text-slate-800">{brief.summary}</p>
      <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <BriefList label="People" items={brief.people} />
        <BriefList label="Organizations" items={brief.orgs} />
        <BriefList label="Dates" items={brief.dates} />
      </div>
    </section>
  );
}

interface BriefListProps {
  label: string;
  items: string[];
}

function BriefList({ label, items }: BriefListProps) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</h3>
      {items.length === 0 ? (
        <p className="text-sm italic text-slate-400">None</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-800">
          {items.map((item) => (
            <li key={item} className="rounded bg-slate-100 px-2 py-1">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
