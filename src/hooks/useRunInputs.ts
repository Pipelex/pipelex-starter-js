"use client";

import { useCallback, useMemo, useState } from "react";
import {
  computeReadiness,
  fieldsForContract,
  rjsfDataFromRunValues,
  type PipeIOContract,
  type RunField,
} from "@pipelex/mthds-form";

export interface RunInputsState {
  /** The method's inputs as kernel descriptors — hand these to `<RunInputsForm>`. */
  fields: RunField[];
  values: Record<string, unknown>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  /** Every gating input has a value — what the Run button should gate on. */
  ready: boolean;
  /** The schema-shaped data dict to hand the Server Action, built on demand. */
  toData: () => Record<string, unknown>;
}

/**
 * Form-value state derived from a method's IO contract.
 *
 * Every field, its control, its label and its readiness rule come from the
 * contract `npm run codegen` committed — swap the method, re-run codegen, and
 * the form follows. Nothing here knows what `extract_entities` is.
 *
 * The companion to `useRun`: this hook owns what goes *in*, `useRun` owns the
 * run itself and what comes *out*.
 */
export function useRunInputs(
  contract: PipeIOContract,
  initialValues?: Record<string, unknown>,
): RunInputsState {
  const fields = useMemo(() => fieldsForContract(contract), [contract]);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues ?? {});

  // Optional and plural inputs never gate — the kernel's readiness scan knows
  // that, so this is one line rather than a per-form `!text.trim()`.
  const ready = computeReadiness(fields, values).missing.length === 0;

  // Built on submit, not per keystroke: the wire shape only matters at Run.
  const toData = useCallback(() => rjsfDataFromRunValues(values, fields), [values, fields]);

  return { fields, values, setValues, ready, toData };
}
