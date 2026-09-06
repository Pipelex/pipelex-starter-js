"use client";

import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";

/** Which rendering of the same inputs is on screen. */
export type InputView = "designed" | "plain";

const OPTIONS: readonly SegmentedOption<InputView>[] = [
  { value: "designed", label: "Designed" },
  { value: "plain", label: "Plain form" },
];

interface ViewToggleProps {
  value: InputView;
  onChange: (view: InputView) => void;
  disabled?: boolean;
}

/**
 * The switch between a method's designed page and the kernel's plain form.
 *
 * It is the demonstration, not a preference: both views are bound to the same
 * store, so flipping copies nothing and the two cannot disagree about what a
 * run would receive. A reader can put the page a model laid out beside the form
 * the kernel derives from the same descriptor and judge one against the other,
 * which is exactly how the layouts upstream were judged.
 *
 * Rendered only on a tab whose design was accepted — a tab that fell back has
 * one view and says why underneath it instead.
 */
export function ViewToggle({ value, onChange, disabled }: ViewToggleProps) {
  return (
    <SegmentedControl
      label="Input view"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
