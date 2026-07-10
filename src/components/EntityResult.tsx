import type { ExtractedEntities } from "@/types/extractEntitiesPipeline";

interface EntityResultProps {
  entities: ExtractedEntities;
}

export function EntityResult({ entities }: EntityResultProps) {
  return (
    <section
      aria-label="Extracted entities"
      className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-3"
    >
      <EntityList label="People" items={entities.people} />
      <EntityList label="Organizations" items={entities.orgs} />
      <EntityList label="Dates" items={entities.dates} />
    </section>
  );
}

interface EntityListProps {
  label: string;
  items: string[];
}

function EntityList({ label, items }: EntityListProps) {
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
