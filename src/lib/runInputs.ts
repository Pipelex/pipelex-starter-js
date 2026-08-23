/**
 * The run-input gate — the server half of the kernel's input rules.
 *
 * The two sides are not the same call, and it is worth being exact about that.
 * The browser runs `computeReadiness` to decide whether Run is live
 * (`useRunInputs`); this module runs the kernel's schema gate, then re-applies
 * the emptiness rule by calling `computeReadiness`'s own two functions —
 * `mustBeFilled` and `fieldFilled` — over the same derived fields. So the rules
 * are shared by construction, not by resemblance, while this side stays a
 * strict superset: it also validates shapes and builds the wire envelope.
 *
 * That superset property is the invariant to preserve, because a Server Action
 * is a public endpoint and the browser's checks are trivially bypassed. This is
 * the trust boundary; readiness is UX. `runInputs.test.ts` asserts it by
 * running both sides over one table rather than by describing them, which is
 * the only form of that claim worth trusting — the near-miss pair
 * `inputMustBeFilled` + `isFilled` matches on every field kind this repo's
 * methods produce and diverges on a structured concept.
 *
 * Pure module — no `process.env`, no Node built-ins — so it is safe to import
 * from either side (same rule as `fileEncoding.ts`).
 */
import {
  apiInputsFromSchemaData,
  buildRunInputsSchema,
  describeValidationError,
  fieldFilled,
  fieldsForContract,
  getPipeIOContract,
  mustBeFilled,
  prepareRunInputs,
  validateRunInputs,
  type PipeIOContract,
  type PipeIOContracts,
  type Translate,
  type ValidationMessageKey,
} from "@pipelex/mthds-form";
import type { PipelineError } from "@/lib/errors";

/**
 * Look one pipe's contract up in a generated `PIPE_IO_CONTRACTS`, or throw.
 *
 * `getPipeIOContract` returns `undefined` on a miss, and an undefined contract
 * renders as an empty form with a live Run button — a silent failure that looks
 * like a styling bug. A typo in the domain or the pipe code is a build-time
 * mistake (the generated artifact and the code disagree), so failing loudly at
 * module load is the right volume. Note the argument order: **contracts, then
 * domain, then pipe code**.
 */
export function requireContract(
  contracts: PipeIOContracts,
  domain: string,
  pipeCode: string,
): PipeIOContract {
  const contract = getPipeIOContract(contracts, domain, pipeCode);
  if (!contract) {
    throw new Error(
      `No IO contract for "${domain}.${pipeCode}" in the generated contracts ` +
        `(found: ${Object.keys(contracts).join(", ") || "none"}). ` +
        `Check the domain and pipe code against methods/<name>/main.mthds, then run \`npm run codegen\`.`,
    );
  }
  return contract;
}

export type GateOutcome =
  | { ok: true; inputs: Record<string, unknown> }
  | { ok: false; error: PipelineError };

/**
 * One schema object per contract, for the lifetime of the process.
 *
 * `buildRunInputsSchema` is a pure function of the contract, so rebuilding it is
 * *semantically* free — but the kernel validates through a module-level ajv
 * singleton whose compiled-schema cache is keyed on **schema object identity**
 * and is never evicted (`ajv`'s `Map`-based `_cache`; the kernel never calls
 * `removeSchema`). A fresh object per call therefore misses every time and
 * retains another compiled validator. On a publicly callable Server Action that
 * is unbounded growth driven by the cheapest request there is — an empty body,
 * rejected in a fraction of a millisecond, costing no model spend.
 *
 * Weakly keyed so this map itself never pins a contract that goes out of scope;
 * in the app the contracts are module-level constants, so it holds exactly one
 * entry per method. Note that a schema which has been through `gateRunInputs`
 * is pinned for the process lifetime anyway, by ajv's own strong cache — the
 * point here is not that the schema is collectable, it is that the number of
 * them is bounded by the number of distinct contracts rather than by traffic.
 */
const SCHEMA_CACHE = new WeakMap<PipeIOContract, ReturnType<typeof buildRunInputsSchema>>();

export function schemaFor(contract: PipeIOContract) {
  const cached = SCHEMA_CACHE.get(contract);
  if (cached) return cached;
  const schema = buildRunInputsSchema(contract.inputs);
  SCHEMA_CACHE.set(contract, schema);
  return schema;
}

/**
 * The kernel's gate: combine the per-input schemas, repair the data, validate
 * it, reject required inputs that arrived empty, and build the
 * `{ concept, content }` map the run expects.
 *
 * Returns a classified error rather than throwing — a Server Action must never
 * throw across the server→client boundary, because Next.js strips the message
 * to an opaque digest in production builds.
 */
export function gateRunInputs(
  contract: PipeIOContract,
  data: Record<string, unknown>,
): GateOutcome {
  const schema = schemaFor(contract);
  const prepared = prepareRunInputs(data, schema);
  const verdict = validateRunInputs(prepared, contract.inputs, schema);

  if (!verdict.isValid) {
    return {
      ok: false,
      error: invalidInputsError(verdict.missingInputs, verdict.errors, prepared),
    };
  }

  // The schema alone is not enough: ajv's `required` asserts only that the key
  // is *present*, and no generated contract carries a `minLength`. So a required
  // input that arrived empty — `{document: {url: ""}}`, `{text: {text: ""}}` —
  // satisfies the schema. That is not a contrived payload but the natural one:
  // `rjsfDataFromRunValues({}, fields)` emits exactly `{document: {url: ""}}`
  // when nothing is selected. The browser already refuses it (`computeReadiness`
  // keeps Run disabled), so without this the trust boundary would be *weaker*
  // than the button in front of it — a direct call to this public endpoint could
  // start a paid run on an empty input.
  //
  // This runs `computeReadiness`'s *own* two functions over the same derived
  // fields, which is the only way to be sure the two sides cannot disagree.
  // Picking a pair that merely looks equivalent is not enough, and that is not
  // hypothetical: the obvious choice, `inputMustBeFilled` + `isFilled`, agrees
  // for every leaf kind and diverges on a structured concept in *both*
  // directions — `isFilled` on an object is `some(child filled)` where
  // `fieldFilled` is `every(required child filled)`. That accepts a
  // half-filled struct the browser refuses (a paid run past a disabled button)
  // and rejects an all-optional struct the browser accepts. No contract in
  // `methods/` derives to a structured input today, so nothing here would have
  // caught it — but this file is one adopters copy verbatim.
  const empty = fieldsForContract(contract)
    .filter(mustBeFilled)
    .filter((field) => !fieldFilled(field, prepared[field.name]))
    .map((field) => field.name);
  if (empty.length) {
    return { ok: false, error: invalidInputsError(empty, [], prepared) };
  }

  return { ok: true, inputs: apiInputsFromSchemaData(prepared, contract.inputs) };
}

/**
 * The invalid verdict as a `bad_request` error the UI can render.
 *
 * `missingInputs` names the variables the user left empty, which is what almost
 * every failure is. The scan can come up empty on a genuinely malformed value
 * (a wrong shape, a nested mismatch), so `errors` is the fallback — never leave
 * a rejection undiagnosable.
 */
function invalidInputsError(
  missingInputs: string[],
  errors: ReturnType<typeof validateRunInputs>["errors"],
  prepared: Record<string, unknown>,
): PipelineError {
  const lines = missingInputs.length
    ? missingInputs.map((name) => `Missing required input: ${name}`)
    : errors.map((error) => describeValidationError(error, translate, prepared));

  return {
    kind: "bad_request",
    title: missingInputs.length ? "Input required" : "Invalid input",
    message: missingInputs.length
      ? `Fill in ${formatList(missingInputs)} before running this method.`
      : "The inputs did not match what this method declares.",
    details: lines.join("\n") || "The run inputs failed validation.",
  };
}

/** `["a"]` → `"a"`, `["a","b"]` → `"a and b"`, `["a","b","c"]` → `"a, b and c"`. */
function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "the required inputs";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The kernel renders validation messages through an injected translator so it
 * stays i18n-agnostic. This app has no i18n, so it supplies the English wording
 * directly — typed on the kernel's key union, so a kernel release that adds a
 * key fails the build here instead of rendering `undefined`.
 */
const VALIDATION_MESSAGES: Record<ValidationMessageKey, (v: Record<string, string>) => string> = {
  "inputPanel.aDateField": () => "a date field",
  "inputPanel.pickValidDate": (v) => `${v.label}: “${v.value}” is not a valid date.`,
  "inputPanel.pickValidDateEmpty": (v) => `${v.label}: pick a valid date.`,
  "inputPanel.dateCarriesTime": (v) =>
    `${v.label}: “${v.value}” carries a time — use ${v.day} here and put the time in the matching time field.`,
  "inputPanel.invalidValue": () => "Invalid value.",
  "inputPanel.invalidValueWithData": (v) => `${v.stack} (received “${v.value}”)`,
};

const translate: Translate = (key, values) => VALIDATION_MESSAGES[key](values ?? {});
