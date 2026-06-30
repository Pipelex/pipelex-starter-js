"use client";

import type { ExecutionMode } from "@/config";

const OPTIONS: { value: ExecutionMode; label: string }[] = [
  { value: "blocking", label: "Blocking" },
  { value: "durable", label: "Durable · live status" },
];

interface ModeToggleProps {
  value: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

/**
 * Per-example execution-mode switch — a small segmented `radiogroup`. Each form
 * owns its own mode state and passes it here, so you can compare Blocking vs
 * Durable on the same input. Disabled while a run is in flight.
 */
export function ModeToggle({ value, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label="Execution mode"
        className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
      >
        {OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={
                selected
                  ? "rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm disabled:opacity-50"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Durable survives the ~30s hosted timeout and streams live status. Blocking is simpler but
        hits the cap on long pipelines.
      </p>
    </div>
  );
}
