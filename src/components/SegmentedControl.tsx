"use client";

import { useRef } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** The group's accessible name — "Execution mode", "Input view". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * The app's small segmented switch: a `radiogroup` of two or three options.
 *
 * It exists so the ARIA radio-group keyboard contract is written once — a roving
 * tabindex (only the selected option is in the tab order) and arrow keys that
 * move selection and focus together, wrapping around the group. Two toggles now
 * sit side by side above every example (`<ModeToggle>` and `<ViewToggle>`), and
 * a second hand-rolled copy of that contract is a second chance to get it
 * subtly wrong.
 *
 * App chrome, deliberately: nothing here is derived from a method's contract.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    let offset: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") offset = 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") offset = -1;
    else return;
    event.preventDefault();
    const next = (index + offset + options.length) % options.length;
    onChange(options[next].value);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
    >
      {options.map((opt, index) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={
              selected
                ? "rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900 shadow-xs disabled:opacity-50"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
