"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createStateStore, type StateModel, type StateStore } from "@json-render/core";
import {
  computeReadiness,
  fieldsForContract,
  rjsfDataFromRunValues,
  type PipeInputFormDescriptor,
  type PipeIOContract,
  type RunField,
} from "@pipelex/mthds-form";
import { INPUTS_ROOT, seedInputs } from "@pipelex/mthds-form/generative";
import { acceptDesign, type DesignVerdict, type MethodDesign } from "@/lib/design";

export interface RunInputsState {
  /** The method's inputs as kernel descriptors — hand these to `<RunInputsForm>`. */
  fields: RunField[];
  values: Record<string, unknown>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  /** Every gating input has a value — what the Run button should gate on. */
  ready: boolean;
  /** The schema-shaped data dict to hand the Server Action, built on demand. */
  toData: () => Record<string, unknown>;
  /** Whether this method's committed design is renderable, and why not when it is not. */
  design: DesignVerdict;
  /**
   * The state tree a designed page binds to — `null` when the plain form is
   * rendering. Hand it to `<DesignedPage store={…}>`; everything else on this
   * object already reads it.
   */
  store: StateStore | null;
}

/** Stable references, so a render with no values never invalidates a snapshot. */
const NO_INPUTS: Record<string, unknown> = {};
const NO_STATE: StateModel = {};
const NO_UNSUBSCRIBE = () => {};

/**
 * Form-value state derived from a method's wire input-form descriptor and its
 * IO contract — both committed by `npm run codegen`.
 *
 * Every field, its control, its label and its readiness rule come from the
 * descriptor (the contract is co-walked for the scalar wrapper key and nested
 * list bounds, the two facts the wire deliberately omits) — swap the method,
 * re-run codegen, and the form follows. Nothing here knows what
 * `extract_entities` is.
 *
 * The companion to `useRun`: this hook owns what goes *in*, `useRun` owns the
 * run itself and what comes *out*.
 *
 * ## The one store, when a design is accepted
 *
 * `design` is the method's committed page, projected by the same `npm run
 * codegen` that wrote the contract, and `null` for a method nobody has designed
 * one for. When it passes the kernel's fallback rule (`acceptDesign`), this hook
 * creates ONE json-render store and every value below reads it: `values` is its
 * `/inputs` subtree, `setValues` writes through it, and `ready` and `toData` are
 * computed from the snapshot exactly as they are computed from React state.
 *
 * That single source is the point. `GenerativePage` binds every control it
 * renders to `/inputs/<name>`, which *is* the values record the kernel's
 * readiness and wire deflation already consume — so the designed page and the
 * plain form are two renderings of one tree, nothing is copied when a reader
 * flips between them, and the inputs a run receives cannot depend on which view
 * was on screen. With no design the hook keeps its React state and the plain
 * path is byte-for-byte what it was before designs existed.
 */
export function useRunInputs(
  contract: PipeIOContract,
  descriptor: PipeInputFormDescriptor,
  initialValues?: Record<string, unknown>,
  design?: MethodDesign | null,
): RunInputsState {
  const fields = useMemo(() => fieldsForContract(contract, descriptor), [contract, descriptor]);
  const verdict = useMemo(() => acceptDesign(design ?? null, fields), [design, fields]);

  // Both are created once, lazily, and for the same reason: `initialValues` is
  // written as an object literal at the call site, so reading it on any render
  // but the first would reseed the form under whoever is typing into it. The
  // store's own seed is the method's authored defaults (`seedInputs`) under the
  // example's sample values — never a placeholder for an unfilled field, which
  // readiness would count as filled.
  const [store] = useState<StateStore | null>(() =>
    verdict.ok
      ? createStateStore({ inputs: { ...seedInputs(fields), ...(initialValues ?? {}) } })
      : null,
  );
  const [reactValues, setReactValues] = useState<Record<string, unknown>>(
    () => initialValues ?? {},
  );

  const snapshot = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => (store ? store.subscribe(onChange) : NO_UNSUBSCRIBE),
      [store],
    ),
    useCallback(() => store?.getSnapshot() ?? NO_STATE, [store]),
    useCallback(() => (store?.getServerSnapshot ?? store?.getSnapshot)?.() ?? NO_STATE, [store]),
  );

  const values = store
    ? ((snapshot.inputs as Record<string, unknown> | undefined) ?? NO_INPUTS)
    : reactValues;

  const setValues = useCallback<React.Dispatch<React.SetStateAction<Record<string, unknown>>>>(
    (update) => {
      if (!store) {
        setReactValues(update);
        return;
      }
      // Read through the store rather than closing over the rendered `values`:
      // the file seam writes twice in a tick (clear, then the encoded value),
      // and the second write must see the first.
      const current = (store.getSnapshot().inputs as Record<string, unknown> | undefined) ?? {};
      // json-render compares by reference, so a mutated-in-place record would be
      // written and never notice anyone. Every caller returns a fresh object.
      store.set(INPUTS_ROOT, typeof update === "function" ? update(current) : update);
    },
    [store],
  );

  // Optional and variable-plural inputs never gate, and a whitespace-only
  // string counts as unfilled — the kernel's readiness scan knows all of that,
  // so this is one line rather than a per-form `!text.trim()`.
  const ready = computeReadiness(fields, values).missing.length === 0;

  // Built on submit, not per keystroke: the wire shape only matters at Run.
  const toData = useCallback(() => rjsfDataFromRunValues(values, fields), [values, fields]);

  return { fields, values, setValues, ready, toData, design: verdict, store };
}
