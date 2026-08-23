"use client";

import { useState } from "react";
import { ComplexForm } from "./ComplexForm";
import { EntityForm } from "./EntityForm";
import { PdfForm } from "./PdfForm";
import { ImageForm } from "./ImageForm";

type TabId = "text" | "pdf" | "image" | "complex";

const TABS: { id: TabId; label: string }[] = [
  { id: "text", label: "Text entities" },
  { id: "pdf", label: "PDF summary" },
  { id: "image", label: "Image generation" },
  { id: "complex", label: "Complex inputs" },
];

/**
 * Tab switcher for the example pipelines. Every panel stays mounted (toggled
 * with `hidden`) so an in-flight pipeline isn't aborted when the user switches
 * tabs to look at another example.
 */
export function ExampleTabs() {
  const [active, setActive] = useState<TabId>("text");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Pipelex examples"
        className="flex gap-1 border-b border-slate-200"
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={
                selected
                  ? "border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900"
                  : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="panel-text" aria-labelledby="tab-text" hidden={active !== "text"}>
        <EntityForm />
      </div>
      <div role="tabpanel" id="panel-pdf" aria-labelledby="tab-pdf" hidden={active !== "pdf"}>
        <PdfForm />
      </div>
      <div role="tabpanel" id="panel-image" aria-labelledby="tab-image" hidden={active !== "image"}>
        <ImageForm />
      </div>
      <div
        role="tabpanel"
        id="panel-complex"
        aria-labelledby="tab-complex"
        hidden={active !== "complex"}
      >
        <ComplexForm />
      </div>
    </div>
  );
}
