"use client";

import type { ExecutionMode } from "@/config";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";

const OPTIONS: readonly SegmentedOption<ExecutionMode>[] = [
  { value: "blocking", label: "Blocking" },
  { value: "durable", label: "Durable · live status" },
];

interface ModeToggleProps {
  value: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

/**
 * Per-example execution-mode switch. Each form owns its own mode state and
 * passes it here, so you can compare Blocking vs Durable on the same input.
 * Disabled while a run is in flight.
 *
 * The roles, the roving tabindex and the arrow-key contract live in
 * `<SegmentedControl>`, which `<ViewToggle>` shares.
 */
export function ModeToggle({ value, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="space-y-1.5">
      <SegmentedControl
        label="Execution mode"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <p className="text-xs text-slate-500">
        Durable survives the ~30s hosted timeout and streams live status. Blocking is simpler but
        hits the cap on long pipelines.
      </p>
    </div>
  );
}
