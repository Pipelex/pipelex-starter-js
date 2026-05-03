import { EntityForm } from "@/components/EntityForm";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Pipelex Starter</h1>
        <p className="mt-2 text-sm text-slate-600">
          A minimal Next.js app that calls the Pipelex API via the{" "}
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">mthds</code> SDK to run the{" "}
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">extract_entities</code>{" "}
          pipeline.
        </p>
      </header>
      <EntityForm />
    </main>
  );
}
