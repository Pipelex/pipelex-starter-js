/**
 * The run-input gate — the server half of the kernel's input rules.
 *
 * The two sides are not the same call, and it is worth being exact about that.
 * The browser runs `computeReadiness` to decide whether Run is live (`useRunInputs`);
 * this module runs the kernel's schema gate, then re-applies the *same* two
 * emptiness predicates readiness is built from (`inputMustBeFilled` + `isFilled`).
 * So the rules are shared — one kernel, no hand-written per-input guards on
 * either side — while this side stays a strict superset: it also validates
 * shapes and builds the wire envelope. That superset property is the invariant
 * to preserve, because a Server Action is a public endpoint and the browser's
 * checks are trivially bypassed. This is the trust boundary; readiness is UX.
 *
 * Pure module — no `process.env`, no Node built-ins — so it is safe to import
 * from either side (same rule as `fileEncoding.ts`).
 */
import {
  apiInputsFromSchemaData,
  buildRunInputsSchema,
  describeValidationError,
  getPipeIOContract,
  inputMustBeFilled,
  isFilled,
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
  const schema = buildRunInputsSchema(contract.inputs);
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
  // start a paid run on an empty input. Re-using the kernel's own two predicates
  // is what keeps that a shared rule rather than a second, drifting one.
  const empty = Object.entries(contract.inputs)
    .filter(([name, input]) => inputMustBeFilled(input) && !isFilled(prepared[name]))
    .map(([name]) => name);
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
