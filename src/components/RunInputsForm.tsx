"use client";

import { useState } from "react";
import { isFilled, type RunField } from "@pipelex/mthds-form";
import {
  FieldPresentationProvider,
  FieldRenderer,
  OptionalToggle,
  type FieldEnv,
} from "@pipelex/mthds-form/react";

interface RunInputsFormProps {
  /** The method's input descriptors, from `useRunInputs`. */
  fields: RunField[];
  values: Record<string, unknown>;
  onValuesChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  disabled?: boolean;
  /**
   * Ambient state the kernel threads down to every control. A file input asks
   * its host to upload via `env.onDropFile`; see `PdfForm`.
   */
  env?: FieldEnv;
}

/**
 * The one kernel composition in this app: `RunField` descriptors rendered
 * through `FieldRenderer`, which dispatches each to its control.
 *
 * There is no per-method branching anywhere — a text input, a PDF dropzone and
 * a date picker all arrive the same way, from the contract `npm run codegen`
 * committed beside the method. `presentation="app"` is the kernel's own seam for
 * a use-facing surface: humanized labels, no concept pills (`native.Text` is
 * implementation detail to somebody filling in a form).
 */
export function RunInputsForm({
  fields,
  values,
  onValuesChange,
  disabled = false,
  env,
}: RunInputsFormProps) {
  const [showOptional, setShowOptional] = useState(false);

  // Optional inputs that are still empty stay folded away, so the form opens at
  // its simplest shape. Required — or already filled — inputs always show.
  const isFoldable = (field: RunField) => !field.required && !isFilled(values[field.name]);
  const foldableCount = fields.filter(isFoldable).length;
  const visibleFields = showOptional ? fields : fields.filter((field) => !isFoldable(field));

  return (
    <FieldPresentationProvider presentation="app">
      <div className="space-y-6">
        {visibleFields.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) => onValuesChange((current) => ({ ...current, [field.name]: value }))}
            // The id is a dotted path: label linkage and upload tracking key on it.
            id={field.name}
            env={{ ...env, disabled }}
          />
        ))}

        {foldableCount > 0 && (
          <OptionalToggle
            count={foldableCount}
            expanded={showOptional}
            onToggle={() => setShowOptional((expanded) => !expanded)}
            noun="input"
          />
        )}
      </div>
    </FieldPresentationProvider>
  );
}
