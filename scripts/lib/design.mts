/**
 * The generative arm's two gestures: produce a method's page, and judge the
 * committed ones offline.
 *
 * A **design** is the third committed artifact about a method, beside the
 * generated types and the IO contracts: `methods/<name>/design.jsonl` is a
 * layout — json-render patch lines a model wrote once, saying which input goes
 * where on the page, in what component, with what copy — and `design.json` is
 * its provenance. `npm run codegen` projects the pair into the generated tree
 * as `design.ts`; `<DesignedPage>` renders it.
 *
 * The two gestures mirror `codegen` and `codegen:check` exactly, and for the
 * same reasons:
 *
 *  - `npm run design` COSTS INFERENCE and needs `PIPELEX_API_KEY`. It renders
 *    the brief from the committed contracts, runs the designer method the form
 *    kernel ships as data, and refuses loudly — writing nothing but a rejected
 *    copy for reading — when the answer does not validate or does not fit.
 *  - `npm run design:check` is free, offline and keyless, and joins `make
 *    check`. It asks the four questions a stored artifact has to keep
 *    answering: is the layout the one the record signed, was the method edited
 *    since, was the layout written against the catalog prompt this kernel
 *    ships, and does it still compile, validate and fit.
 *
 * **A design is never repaired by hand.** A refusal is a fault in the prompt,
 * the method or the producer, and the fix is to re-run — with a seed, if the
 * first run had none. A second refusal is an item against `@pipelex/mthds-form`
 * carrying the problems and the brief, not a patched fixture.
 *
 * Both gestures read `src/generated/<name>/contracts.ts` for the descriptor, so
 * the brief a model is handed is rendered from exactly what the plain form
 * renders — one artifact, two readers, no third description of the method.
 */
import { createRequire } from "node:module";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// `@next/env` is CommonJS, so a native-ESM script must take the default export
// and destructure. Same note as `generate.mts`.
import nextEnv from "@next/env";
import { DEFAULT_API_BASE_URL, PipelexApiClient, type RunResults } from "@pipelex/sdk";
import {
  fieldsForContract,
  getPipeIOContract,
  getPipeInputForm,
  getPipeOutputForm,
  type InputForm,
  type OutputForm,
  type PipeIOContracts,
  type RunField,
} from "@pipelex/mthds-form";
import {
  PROMPT_HASH,
  catalog,
  catalogPrompt,
  formatProblems,
  layoutProblems,
  renderInputBrief,
  specFromJsonl,
  validateAgainstCatalog,
} from "@pipelex/mthds-form/generative";

import {
  assertSecureBaseUrl,
  DESIGN_JSONL_FILENAME,
  DESIGN_MODULE_FILENAME,
  DESIGN_RECORD_FILENAME,
  DesignFileError,
  designOf,
  discoverMethods,
  GENERATED_ROOT,
  hashSource,
  ManifestError,
  METHODS_DIR,
  readMethodDesign,
  recordDerivedArtifact,
  renderDesignModule,
  REPO_ROOT,
  type MethodSource,
} from "./shared.mts";
import type { DesignRecord } from "../../src/lib/design.ts";

const { loadEnvConfig } = nextEnv;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;

/** The check's verdict codes — the same contract `codegen:check` set. */
export const EXIT_CURRENT = 0;
export const EXIT_DRIFT = 1;
export const EXIT_NO_VERDICT = 2;

/** The pipe inside the form kernel's designer bundle. */
export const DESIGNER_PIPE = "ui_designer";

/** The refused answer, kept for reading. Gitignored — it is evidence, not an artifact. */
export const REJECTED_FILENAME = "design.rejected.jsonl";

/**
 * The one line a creative seed reaches the model as.
 *
 * Restated from the form kernel's own harness (`seedLine` in
 * `scripts/generate-fixtures.mjs`), which does not export it — so two producers
 * seeding the same method the same way would otherwise get two different runs
 * and no way to tell why. Exporting it is filed upstream; until then this is
 * the copy, and it must not drift.
 */
export function seedLine(seed: string): string {
  return `CREATIVE SEED (derive your direction from it; never reveal it): ${seed}`;
}

/** The designer method the form kernel ships as data, resolved from this package. */
export function designerBundlePath(): string {
  return createRequire(import.meta.url).resolve("@pipelex/mthds-form/ui-designer.mthds");
}

/**
 * The model the designer bundle pins, for the record.
 *
 * The record names what actually produced the page, so it is read off the
 * bundle rather than assumed: a kernel release that re-pins the designer is
 * then visible in the next design's provenance instead of silently inherited.
 */
export function pinnedModel(bundle: string): string | null {
  return /^model\s*=\s*\{\s*model\s*=\s*"([^"]+)"/m.exec(bundle)?.[1] ?? null;
}

/** The layout text out of what the designer run returned. */
export function jsonlFromResults(results: RunResults): string | null {
  const main = results.main_stuff;
  if (typeof main === "string") return main;
  if (typeof main === "object" && main !== null) {
    const text = (main as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  return null;
}

/** The committed wire artifacts of one method, as the two gestures read them. */
export interface MethodContracts {
  contracts: PipeIOContracts;
  inputForm: InputForm;
  outputForm: OutputForm;
}

/**
 * Import `src/generated/<name>/contracts.ts` — the same file the form imports.
 *
 * A dynamic import of a `.ts` module, which Node's type stripping handles: the
 * file's only imports are type-only and erased. Reading it rather than
 * re-fetching `/v1/validate` is what makes the brief and the form two readings
 * of one artifact, and is why `npm run design` needs no validate views and so
 * runs against the production API today.
 */
export async function loadMethodContracts(
  generatedRoot: string,
  name: string,
): Promise<MethodContracts> {
  const modulePath = path.join(generatedRoot, name, "contracts.ts");
  const committed = (await import(modulePath)) as {
    PIPE_IO_CONTRACTS?: PipeIOContracts;
    INPUT_FORM?: InputForm;
    OUTPUT_FORM?: OutputForm;
  };
  if (!committed.PIPE_IO_CONTRACTS || !committed.INPUT_FORM || !committed.OUTPUT_FORM) {
    throw new Error(
      `${path.relative(REPO_ROOT, modulePath)} does not export the three contract artifacts — ` +
        "run `npm run codegen` first.",
    );
  }
  return {
    contracts: committed.PIPE_IO_CONTRACTS,
    inputForm: committed.INPUT_FORM,
    outputForm: committed.OUTPUT_FORM,
  };
}

/** Every `<domain>.<pipe_code>` the committed contracts carry, sorted. */
export function pipeRefsOf(contracts: PipeIOContracts): string[] {
  return Object.keys(contracts).sort();
}

/**
 * The pipe a design is for.
 *
 * Every method this template ships declares one pipe, so the default is "the
 * only one there is". A method with several is a choice nothing on the wire can
 * make, so it is asked for rather than guessed at — a page designed for the
 * wrong pipe validates perfectly and then fits nothing.
 */
export function resolvePipeRef(contracts: PipeIOContracts, asked?: string): string {
  const refs = pipeRefsOf(contracts);
  if (asked !== undefined) {
    if (!refs.includes(asked)) {
      throw new Error(`no pipe '${asked}' in the committed contracts. Known: ${refs.join(", ")}.`);
    }
    return asked;
  }
  if (refs.length === 1) return refs[0];
  throw new Error(
    `this method declares ${refs.length} pipes (${refs.join(", ")}) — name one with ` +
      "`make design NAME=<method> PIPE=<domain>.<pipe_code>`.",
  );
}

/** `<domain>.<pipe_code>` split for the kernel's lookups. */
function splitPipeRef(pipeRef: string): { domain: string; code: string } {
  const at = pipeRef.indexOf(".");
  if (at <= 0) throw new Error(`'${pipeRef}' is not a <domain>.<pipe_code> reference.`);
  return { domain: pipeRef.slice(0, at), code: pipeRef.slice(at + 1) };
}

/** The input fields of one pipe, exactly as `useRunInputs` derives them. */
export function fieldsOf(artifacts: MethodContracts, pipeRef: string): RunField[] {
  const { domain, code } = splitPipeRef(pipeRef);
  const contract = getPipeIOContract(artifacts.contracts, domain, code);
  const descriptor = getPipeInputForm(artifacts.inputForm, domain, code);
  if (!contract || !descriptor) {
    throw new Error(`${pipeRef}: no contract or input-form descriptor in the committed tree.`);
  }
  return fieldsForContract(contract, descriptor);
}

/**
 * What the brief says this page is for.
 *
 * The wire carries no pipe description, so the honest answer available to both
 * source kinds is what the method PRODUCES — the output concept's own
 * description, off the same committed artifact the result view is rendered
 * from. A method whose output declares none simply gets a brief without one;
 * `renderInputBrief` takes the absence.
 */
export function describePipe(artifacts: MethodContracts, pipeRef: string): string | undefined {
  const { domain, code } = splitPipeRef(pipeRef);
  return getPipeOutputForm(artifacts.outputForm, domain, code)?.field.description ?? undefined;
}

/** `extract-entities` → `Extract entities`: the one product name the brief may hand a page. */
export function humanizeMethodName(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The client surface the producer needs — one durable run, waited out. */
export type DesignClient = Pick<PipelexApiClient, "startAndWaitForResult">;

/** What the producer writes into, and what it talks to. */
export interface DesignDeps {
  methodsDir: string;
  generatedRoot: string;
  client: DesignClient;
  /** The designer bundle's TOML. */
  bundle: string;
  /** `YYYY-MM-DD`, so a test can pin the record. */
  today: string;
}

export interface DesignOptions {
  pipeRef?: string;
  seed?: string;
}

/**
 * Produce one method's page: brief, run, compile, validate, fit, write.
 *
 * Nothing reaches `methods/` until all three checks have passed. A refusal
 * leaves the previous design exactly as it was and drops the rejected text
 * beside the method for reading, because the repair is upstream of this file
 * every time.
 */
export async function designMethod(
  deps: DesignDeps,
  source: MethodSource,
  options: DesignOptions = {},
): Promise<"ok" | "failed"> {
  const methodDir = path.join(deps.methodsDir, source.name);
  const outDir = path.join(deps.generatedRoot, source.name);
  const rejectedPath = path.join(methodDir, REJECTED_FILENAME);

  let jsonl: string;
  let pipeRef: string;
  let model: string;
  try {
    const artifacts = await loadMethodContracts(deps.generatedRoot, source.name);
    pipeRef = resolvePipeRef(artifacts.contracts, options.pipeRef);
    const fields = fieldsOf(artifacts, pipeRef);
    const brief = renderInputBrief(
      {
        pipeRef,
        description: describePipe(artifacts, pipeRef),
        name: humanizeMethodName(source.name),
      },
      fields,
    );
    model = pinnedModel(deps.bundle) ?? "unknown";
    console.log(`  ${source.name}: designing ${pipeRef} with ${model}…`);

    const results = await deps.client.startAndWaitForResult({
      pipe_code: DESIGNER_PIPE,
      mthds_contents: [deps.bundle],
      inputs: {
        catalog_rules: catalogPrompt(),
        brief,
        ...(options.seed === undefined ? {} : { seed: seedLine(options.seed) }),
      },
    });

    const text = jsonlFromResults(results);
    if (text === null) {
      console.error(`\n✗ ${source.name} — the designer run returned no layout text.`);
      return "failed";
    }
    if (text.trim() === "") {
      console.error(
        `\n✗ ${source.name} — the designer run came back EMPTY. On this runtime that is what a\n` +
          "    completion truncated at the model's output cap looks like. Re-run; if it repeats,\n" +
          "    file it against @pipelex/mthds-form with the brief.",
      );
      return "failed";
    }
    jsonl = text;

    const spec = specFromJsonl(jsonl);
    const verdict = validateAgainstCatalog(spec, catalog);
    if (!verdict.ok) {
      await writeFile(rejectedPath, jsonl, "utf-8");
      console.error(
        `\n✗ ${source.name} — the layout does not validate against the kernel's catalog:\n` +
          `${formatProblems(verdict.problems)}\n` +
          `    The refused text is at methods/${source.name}/${REJECTED_FILENAME}. ` +
          "Re-run (with SEED= if this one had none); never repair it by hand.",
      );
      return "failed";
    }
    const problems = layoutProblems({ inputs: fields }, spec);
    if (problems.length > 0) {
      await writeFile(rejectedPath, jsonl, "utf-8");
      console.error(
        `\n✗ ${source.name} — the layout does not fit the method:\n` +
          problems.map((problem) => `    ${problem}`).join("\n") +
          `\n    The refused text is at methods/${source.name}/${REJECTED_FILENAME}. ` +
          "Re-run (with SEED= if this one had none); never repair it by hand.",
      );
      return "failed";
    }
  } catch (error) {
    console.error(`\n✗ ${source.name} — ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }

  const record: DesignRecord = {
    pipeRef,
    producer: "pipelex-method",
    model,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    promptHash: PROMPT_HASH,
    date: deps.today,
    sources: source.sourceHashes,
    jsonlSha256: hashSource(jsonl),
  };

  await writeFile(path.join(methodDir, DESIGN_JSONL_FILENAME), jsonl, "utf-8");
  await writeFile(
    path.join(methodDir, DESIGN_RECORD_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf-8",
  );
  // A rejected copy from an earlier run is evidence about a design that no
  // longer exists; leaving it beside a design that was accepted is misleading.
  await rm(rejectedPath, { force: true });

  const design = designOf({
    record,
    jsonl,
    recordPath: `methods/${source.name}/${DESIGN_RECORD_FILENAME}`,
    jsonlPath: `methods/${source.name}/${DESIGN_JSONL_FILENAME}`,
  });
  const projected = renderDesignModule(design);
  await writeFile(path.join(outDir, DESIGN_MODULE_FILENAME), projected, "utf-8");
  await recordDerivedArtifact(outDir, DESIGN_MODULE_FILENAME, projected);

  console.log(
    `\n✓ ${source.name} → methods/${source.name}/${DESIGN_JSONL_FILENAME}  ` +
      `(${pipeRef}, ${model}${options.seed === undefined ? "" : ", seeded"}, prompt ${PROMPT_HASH})`,
  );
  return "ok";
}

// ── The offline check ───────────────────────────────────────────────────────

/** One method's verdict, and the problems behind it. */
export interface DesignCheckResult {
  code: number;
  /** Lines to print under the method's name. */
  problems: string[];
  /** Nothing to judge — a method nobody has designed a page for. */
  absent: boolean;
}

/**
 * Judge one committed design, offline.
 *
 * Four questions, each of which a green answer to the others cannot imply:
 * whether the layout is the one the record signed (a hand edit), whether the
 * method has been edited since (the same `sources` map the codegen sidecar
 * records), whether the catalog prompt has moved under it (a kernel release),
 * and whether it still compiles, validates and fits. Then a fifth that is about
 * the tree rather than the design: whether the committed projection is the one
 * this record and this layout render to.
 */
export async function checkMethodDesign(
  source: MethodSource,
  methodsDir = METHODS_DIR,
  generatedRoot = GENERATED_ROOT,
): Promise<DesignCheckResult> {
  let files;
  try {
    files = await readMethodDesign(source.name, methodsDir);
  } catch (error) {
    if (error instanceof DesignFileError) {
      return { code: EXIT_NO_VERDICT, problems: [error.message], absent: false };
    }
    throw error;
  }

  const modulePath = path.join(generatedRoot, source.name, DESIGN_MODULE_FILENAME);
  let committedModule: string;
  try {
    committedModule = await readFile(modulePath, "utf-8");
  } catch {
    return {
      code: EXIT_NO_VERDICT,
      problems: [
        `src/generated/${source.name}/${DESIGN_MODULE_FILENAME} is missing — run \`npm run codegen\`.`,
      ],
      absent: files === null,
    };
  }

  if (files === null) {
    // No design is the ordinary state, not a failure — but the tree still has
    // to say so, or a form imports a design for a method that has none.
    const expected = renderDesignModule(null);
    if (committedModule !== expected) {
      return {
        code: EXIT_DRIFT,
        problems: [
          `src/generated/${source.name}/${DESIGN_MODULE_FILENAME} carries a design, and ` +
            `methods/${source.name}/ has none — run \`npm run codegen\`.`,
        ],
        absent: true,
      };
    }
    return { code: EXIT_CURRENT, problems: [], absent: true };
  }

  const problems: string[] = [];
  const { record, jsonl, recordPath, jsonlPath } = files;

  if (hashSource(jsonl) !== record.jsonlSha256) {
    problems.push(`${jsonlPath} — hand-edited since ${recordPath} signed it.`);
  }

  const stale = staleSources(record.sources, source.sourceHashes);
  for (const line of stale) problems.push(`${recordPath} — ${line}`);

  if (record.promptHash !== PROMPT_HASH) {
    problems.push(
      `${recordPath} — produced against catalog prompt ${record.promptHash}, and ` +
        `@pipelex/mthds-form now ships ${PROMPT_HASH}. Re-run \`npm run design\`.`,
    );
  }

  // The three runtime questions, asked with the same functions `acceptDesign`
  // asks them with — so a design this passes is one the app will render, and a
  // fallback in the browser is never news the check could have delivered first.
  try {
    const artifacts = await loadMethodContracts(generatedRoot, source.name);
    const fields = fieldsOf(artifacts, record.pipeRef);
    const spec = specFromJsonl(jsonl);
    const verdict = validateAgainstCatalog(spec, catalog);
    if (!verdict.ok) {
      problems.push(`${jsonlPath} — ${formatProblems(verdict.problems)}`);
    } else {
      for (const problem of layoutProblems({ inputs: fields }, spec)) {
        problems.push(`${jsonlPath} — ${problem}`);
      }
    }
  } catch (error) {
    return {
      code: EXIT_NO_VERDICT,
      problems: [`${source.name} — ${error instanceof Error ? error.message : String(error)}`],
      absent: false,
    };
  }

  if (committedModule !== renderDesignModule(designOf(files))) {
    problems.push(
      `src/generated/${source.name}/${DESIGN_MODULE_FILENAME} is not what this design projects ` +
        "to — run `npm run codegen`.",
    );
  }

  return {
    code: problems.length === 0 ? EXIT_CURRENT : EXIT_DRIFT,
    problems,
    absent: false,
  };
}

/** How the method's sources differ from the ones the record was produced against. */
export function staleSources(
  recorded: Record<string, string>,
  actual: Record<string, string>,
): string[] {
  const lines: string[] = [];
  for (const [file, hash] of Object.entries(actual)) {
    if (!(file in recorded)) lines.push(`${file} was added since this design was produced.`);
    else if (recorded[file] !== hash)
      lines.push(`${file} was edited since this design was produced.`);
  }
  for (const file of Object.keys(recorded)) {
    if (!(file in actual)) lines.push(`${file} is gone since this design was produced.`);
  }
  return lines.length > 0
    ? [...lines, "Re-run `npm run design` so the page is designed for the method as it is now."]
    : [];
}

// ── The two entry points ────────────────────────────────────────────────────

/** The methods one gesture works on: all of them, or the one `NAME=` named. */
async function selectMethods(
  only: string | undefined,
  methodsDir: string,
): Promise<MethodSource[]> {
  const methods = await discoverMethods(methodsDir);
  if (only === undefined) return methods;
  const found = methods.filter((method) => method.name === only);
  if (found.length === 0) {
    throw new Error(
      `no method '${only}' under methods/. Known: ${methods.map((m) => m.name).join(", ")}.`,
    );
  }
  return found;
}

/** The parsed command line. */
export interface DesignArgs {
  name?: string;
  pipe?: string;
  seed?: string;
}

const USAGE =
  "usage: npm run design -- [--name <method-dir>] [--pipe <domain>.<pipe_code>] [--seed <text>]";

/** Parse the command line, refusing an unknown flag and a swallowed value. */
export function parseDesignArgs(argv: readonly string[]): DesignArgs {
  const args: DesignArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag !== "--name" && flag !== "--pipe" && flag !== "--seed") {
      throw new Error(`unknown argument '${flag}'.\n  ${USAGE}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value.\n  ${USAGE}`);
    }
    args[flag.slice(2) as keyof DesignArgs] = value;
    i += 1;
  }
  return args;
}

async function runDesignInner(argv: readonly string[]): Promise<number> {
  let args: DesignArgs;
  try {
    args = parseDesignArgs(argv);
  } catch (error) {
    console.error(`design: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }

  loadEnvConfig(REPO_ROOT, false, { info: () => {}, error: console.error });

  const baseUrl = process.env.PIPELEX_BASE_URL ?? DEFAULT_API_BASE_URL;
  try {
    assertSecureBaseUrl(baseUrl);
  } catch (error) {
    console.error(`design: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
  if (!process.env.PIPELEX_API_KEY) {
    console.error("design: PIPELEX_API_KEY is not set — add it to .env.local.");
    return EXIT_FAILED;
  }

  let methods: MethodSource[];
  try {
    methods = await selectMethods(args.name, METHODS_DIR);
  } catch (error) {
    if (error instanceof ManifestError || error instanceof Error) {
      console.error(`design: ${error.message}`);
      return EXIT_FAILED;
    }
    throw error;
  }

  const bundle = await readFile(designerBundlePath(), "utf-8");
  const seed = args.seed;
  const deps: DesignDeps = {
    methodsDir: METHODS_DIR,
    generatedRoot: GENERATED_ROOT,
    client: new PipelexApiClient(),
    bundle,
    today: new Date().toISOString().slice(0, 10),
  };

  console.log(
    `design: ${methods.length} method(s), via ${baseUrl}, prompt ${PROMPT_HASH}` +
      `${seed === undefined ? "" : " (seeded)"}`,
  );
  console.log("        this costs inference — one designer run per method.\n");

  let failed = false;
  for (const method of methods) {
    const outcome = await designMethod(deps, method, { pipeRef: args.pipe, seed });
    if (outcome === "failed") failed = true;
  }
  return failed ? EXIT_FAILED : EXIT_OK;
}

/** `npm run design`, exit code included. Never throws. */
export async function runDesign(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    return await runDesignInner(argv);
  } catch (error) {
    console.error(`design: ${error instanceof Error ? error.stack : String(error)}`);
    return EXIT_FAILED;
  }
}

async function runDesignCheckInner(): Promise<number> {
  let methods: MethodSource[];
  try {
    methods = await discoverMethods();
  } catch (error) {
    console.error(`design:check: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_NO_VERDICT;
  }

  let designed = 0;
  let absent = 0;
  const codes: number[] = [];
  for (const method of methods) {
    const result = await checkMethodDesign(method);
    codes.push(result.code);
    if (result.absent) {
      absent += 1;
      if (result.problems.length === 0) {
        console.log(`\n· ${method.name} — no design (the plain form renders)`);
      }
    } else if (result.code === EXIT_CURRENT) {
      designed += 1;
      console.log(`\n✓ ${method.name} — the designed page is current`);
    }
    if (result.problems.length > 0) {
      console.error(`\n✗ ${method.name}`);
      for (const problem of result.problems) console.error(`    ${problem}`);
    }
  }

  const drift = codes.filter((code) => code === EXIT_DRIFT).length;
  const noVerdict = codes.filter((code) => code === EXIT_NO_VERDICT).length;
  console.log(
    `\ndesign:check: ${designed} designed · ${absent} undesigned · ${drift} drift · ` +
      `${noVerdict} no verdict`,
  );
  if (noVerdict > 0) return EXIT_NO_VERDICT;
  return drift > 0 ? EXIT_DRIFT : EXIT_CURRENT;
}

/** `npm run design:check`, exit code included. Never throws. */
export async function runDesignCheck(): Promise<number> {
  try {
    return await runDesignCheckInner();
  } catch (error) {
    console.error(`design:check: ${error instanceof Error ? error.stack : String(error)}`);
    return EXIT_NO_VERDICT;
  }
}
