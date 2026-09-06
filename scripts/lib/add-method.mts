/**
 * `make add-method` — scaffold a method that lives somewhere else into this app.
 *
 * The template's first story is `methods/<name>/main.mthds` → `npm run codegen`
 * → an app written by hand around the generated tree. This is the second story
 * for a method that lives on the platform (a catalog `method_id`) or in a
 * published package (a `method_ref` address): the method stays where it is,
 * `methods/<name>/method.json` names it, and everything the four shipped
 * examples have by hand — the generated tree, the Server Action trio, the typed
 * narrower, the form, the tab — is written by the same projections.
 *
 * Two halves, in this order, and the ordering is the whole safety story:
 *
 *  1. **Read-only.** Parse the selector, check the base URL forwards it, fetch
 *     the catalog name, run `fetchGenerated` (both API calls and every pre-write
 *     guard), choose the pipe, bind the output, derive every name, refuse every
 *     collision, and perform the `ExampleTabs.tsx` insertion *in memory*. Every
 *     refusal happens here, with nothing on disk changed. `--dry-run` stops at
 *     the end of it and prints the plan.
 *  2. **Write.** The manifest, the tree through `writeGenerated` (the same
 *     writer `npm run codegen` uses, so a scaffolded tree IS the tree a
 *     regeneration would write), then the four app files and the tab edit.
 *
 * The gesture is one-shot: re-running it for a name that already exists is a
 * refusal, not an overwrite. `npm run codegen` is the refresh — bumping a
 * published method's tag is an edit to one line of `method.json` and a
 * regeneration, and `npm run codegen:check` fails until you make it.
 *
 * Everything above `runAddMethod` is pure and unit-tested over a table; the
 * orchestration takes its repo root and its client from `deps` so the tests can
 * point it at a temporary skeleton.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// `@next/env` is CommonJS — see the note in `generate.mts`.
import nextEnv from "@next/env";
import {
  DEFAULT_API_BASE_URL,
  PipelexApiClient,
  type GeneratedArtifact,
  type InputForm,
  type InputFormItem,
  type PipeInputFormDescriptor,
  type PipeIOContract,
  type PipeIOContracts,
  type ValidateMethodSelector,
} from "@pipelex/sdk";

import { assertSelectorSupport } from "./api.mts";
import { fetchGenerated, writeGenerated, type FetchedMethod } from "./generate.mts";
import {
  assertSecureBaseUrl,
  hashSource,
  MANIFEST_FILENAME,
  REPO_ROOT,
  selectorKind,
  describeSelector,
  type MethodSource,
} from "./shared.mts";

const { loadEnvConfig } = nextEnv;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;

/**
 * A refusal: something the person asked for cannot be done, and the message
 * says what to do instead. Never a stack trace — every one of these is a
 * printed line and exit 1, the same contract `runGenerate` keeps.
 */
export class AddMethodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddMethodError";
  }
}

// ── The selector ────────────────────────────────────────────────────────────

/** A catalog id, as the platform mints them. */
const METHOD_ID_PATTERN = /^mt_[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** One segment of an address — host, owner, repo, or a package subpath segment. */
const ADDRESS_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** A `@tag` suffix: a git tag or branch name, as the address grammar allows. */
const ADDRESS_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const METHOD_ARG_FORMS =
  'a catalog id ("mt_…") or a published address ' +
  '("github.com/<owner>/<repo>[/<package>][@<tag>]")';

/**
 * Parse the one `METHOD` argument into the SDK's own selector type.
 *
 * That type is what `validate`, `codegen`, `prepareInputs`, the manifest and
 * the scaffolded action's `buildOptions` all take, so the value is parsed once
 * here and carried unchanged everywhere else — there is no translation layer to
 * disagree with itself.
 *
 * `mthds` does not export its address parser from a public entry (it is
 * internal to the installer), so this is a small parser over the same grammar:
 * `github.com/<owner>/<repo>[/<subpath>…][@<tag>]`, with an optional
 * `https://` prefix that is normalized away.
 */
export function parseMethodArg(arg: string): ValidateMethodSelector {
  const trimmed = arg.trim();
  if (trimmed === "") throw new AddMethodError(`METHOD is empty — pass ${METHOD_ARG_FORMS}.`);

  if (trimmed.startsWith("mt_")) {
    if (!METHOD_ID_PATTERN.test(trimmed)) {
      throw new AddMethodError(`"${trimmed}" is not a well-formed catalog id (mt_…).`);
    }
    return { method_id: trimmed };
  }

  const bare = trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const [address, ...extraTags] = bare.split("@");
  if (extraTags.length > 1) {
    throw new AddMethodError(`"${trimmed}" has more than one @tag — an address names one.`);
  }
  const tag = extraTags[0];
  if (tag !== undefined && !ADDRESS_TAG.test(tag)) {
    throw new AddMethodError(`"${trimmed}" has an @tag that is not a tag name.`);
  }

  const segments = (address ?? "").split("/");
  const wellFormed =
    segments.length >= 3 && segments.every((segment) => ADDRESS_SEGMENT.test(segment));
  if (!wellFormed) {
    throw new AddMethodError(
      `"${trimmed}" is neither ${METHOD_ARG_FORMS}.\n` +
        "  An address names at least a host, an owner and a repository.",
    );
  }

  return { method_ref: tag === undefined ? segments.join("/") : `${segments.join("/")}@${tag}` };
}

/**
 * The address's path segments, tag stripped — `github.com/o/r/pkg@v1` yields
 * `["github.com", "o", "r", "pkg"]`.
 */
export function addressSegments(methodRef: string): string[] {
  return methodRef.split("@")[0]!.split("/");
}

// ── Names ───────────────────────────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * `text_stats` → `text-stats`, `CV screening` → `cv-screening`, `Test-1` →
 * `test-1`. The result is a directory name, a tab id, and the stem of four
 * source files, so it is validated rather than merely produced: a name that
 * cannot be one of those is a refusal here, not a broken import later.
 */
export function kebabCase(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!SLUG_PATTERN.test(slug)) {
    throw new AddMethodError(
      `"${input}" does not yield a usable directory name (got "${slug}"). ` +
        "Pass --name with a kebab-case name of your own.",
    );
  }
  return slug;
}

/** `text-stats` → `TextStats`. The component, the actions, the output type. */
export function pascalCase(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** `text-stats` → `textStats`. The adapter module's basename. */
export function camelCase(slug: string): string {
  const pascal = pascalCase(slug);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `text-stats` → `Text stats`. The fallback tab label. */
export function humanize(slug: string): string {
  const words = slug.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where the slug comes from when `--name` is not given: the catalog `name` for
 * a stored method (a person chose it), and the address's last path segment for
 * a published one — the package, falling back to the repository for an address
 * that names no package.
 */
export function slugSource(selector: ValidateMethodSelector, catalogName?: string): string {
  if (selectorKind(selector) === "method_id") {
    if (catalogName === undefined || catalogName.trim() === "") {
      throw new AddMethodError(
        "the catalog method has no name to derive a directory name from — pass --name.",
      );
    }
    return catalogName;
  }
  const segments = addressSegments(selector.method_ref!);
  return segments.length > 3 ? segments[segments.length - 1]! : segments[2]!;
}

/** Every name the scaffold derives, in one record the templates read. */
export interface ScaffoldNames {
  /** Directory name under `methods/` and `src/generated/`, and the tab id. */
  slug: string;
  /** `TextStats` — the component, the action names, the output type. */
  pascal: string;
  /** `textStats` — the adapter module's basename. */
  camel: string;
  /** The tab's visible label. */
  label: string;
}

export function scaffoldNames(slug: string, label?: string): ScaffoldNames {
  const trimmed = label?.trim();
  return {
    slug,
    pascal: pascalCase(slug),
    camel: camelCase(slug),
    label: trimmed !== undefined && trimmed !== "" ? trimmed : humanize(slug),
  };
}

/** Every repo-relative path the gesture touches, derived from the names. */
export interface ScaffoldPaths {
  manifestDir: string;
  manifest: string;
  generatedDir: string;
  adapter: string;
  action: string;
  actionTest: string;
  form: string;
  tabs: string;
}

export function scaffoldPaths(names: ScaffoldNames): ScaffoldPaths {
  return {
    manifestDir: `methods/${names.slug}`,
    manifest: `methods/${names.slug}/${MANIFEST_FILENAME}`,
    generatedDir: `src/generated/${names.slug}`,
    adapter: `src/types/${names.camel}Pipeline.ts`,
    action: `src/actions/run${names.pascal}Pipeline.ts`,
    actionTest: `src/actions/run${names.pascal}Pipeline.test.ts`,
    form: `src/components/${names.pascal}Form.tsx`,
    tabs: "src/components/ExampleTabs.tsx",
  };
}

// ── The pipe ────────────────────────────────────────────────────────────────

/** The chosen pipe, split the way `requireContract` and the run options take it. */
export interface ChosenPipe {
  /** Qualified: `text_stats.analyze_text`. */
  ref: string;
  /** Everything before the last dot. */
  domain: string;
  /** Everything after it — what the run request sends as `pipe_code`. */
  code: string;
}

function splitPipeRef(ref: string): ChosenPipe {
  const at = ref.lastIndexOf(".");
  if (at <= 0 || at === ref.length - 1) {
    throw new AddMethodError(
      `the method declares a pipe ref this scaffold cannot split into a domain and a ` +
        `code: "${ref}". Report it upstream.`,
    );
  }
  return { ref, domain: ref.slice(0, at), code: ref.slice(at + 1) };
}

/**
 * Which pipe the scaffolded slice runs, by a rule that ends in a refusal rather
 * than a guess.
 *
 * In order: an explicit `--pipe` (bare or qualified); else the validate
 * report's `default_pipe_ref`; else the single entry when there is exactly one;
 * else a refusal listing what the method declares. `default_pipe_ref` is read
 * in preference to the blueprint's opaque `main_pipe` because it is typed and
 * because it is the field a published package's manifest fills — the
 * `documents` package has no bundle-level `main_pipe` and still names one.
 */
export function choosePipe(
  contracts: PipeIOContracts,
  defaultPipeRef: string | null,
  requested?: string,
): ChosenPipe {
  const refs = Object.keys(contracts);
  if (refs.length === 0) {
    throw new AddMethodError("the method declares no pipes — there is nothing to scaffold.");
  }
  const listed = refs.join(", ");

  if (requested !== undefined) {
    if (Object.prototype.hasOwnProperty.call(contracts, requested)) return splitPipeRef(requested);
    const matches = refs.filter((ref) => ref.slice(ref.lastIndexOf(".") + 1) === requested);
    if (matches.length === 1) return splitPipeRef(matches[0]!);
    if (matches.length > 1) {
      throw new AddMethodError(
        `--pipe "${requested}" is ambiguous — it matches ${matches.join(", ")}. ` +
          "Pass the qualified <domain>.<pipe_code>.",
      );
    }
    throw new AddMethodError(
      `--pipe "${requested}" is not a pipe this method declares. It declares: ${listed}.`,
    );
  }

  if (defaultPipeRef !== null && defaultPipeRef.trim() !== "") {
    if (!Object.prototype.hasOwnProperty.call(contracts, defaultPipeRef)) {
      throw new AddMethodError(
        `the method's default pipe "${defaultPipeRef}" is not among the pipes it declares ` +
          `(${listed}). Pass --pipe, and report the inconsistency upstream.`,
      );
    }
    return splitPipeRef(defaultPipeRef);
  }

  if (refs.length === 1) return splitPipeRef(refs[0]!);

  throw new AddMethodError(
    `the method declares several pipes and names no default — pass --pipe.\n` +
      `  Pipes: ${listed}`,
  );
}

/** Look a pipe's contract up, tolerating a map keyed by bare code. */
export function contractFor(contracts: PipeIOContracts, pipe: ChosenPipe): PipeIOContract {
  const contract = contracts[pipe.ref] ?? contracts[pipe.code];
  if (contract === undefined) {
    throw new AddMethodError(`the validate report carries no IO contract for "${pipe.ref}".`);
  }
  return contract;
}

/** Look a pipe's input-form descriptor up the same way. */
export function descriptorFor(inputForm: InputForm, pipe: ChosenPipe): PipeInputFormDescriptor {
  const descriptor = inputForm[pipe.ref] ?? inputForm[pipe.code];
  if (descriptor === undefined) {
    throw new AddMethodError(
      `the validate report carries no input-form descriptor for "${pipe.ref}" — ` +
        "the form would render empty. Check PIPELEX_BASE_URL, or report it upstream.",
    );
  }
  return descriptor;
}

// ── The output ──────────────────────────────────────────────────────────────

/** What the scaffolded narrower is written against. */
export interface OutputBinding {
  /** The concept's code — `Text` for `native.Text`. `<Code>Schema` and `parse<Code>`. */
  conceptCode: string;
  /**
   * A plural output is a list of the concept. The runtime renders one as a
   * `{ items: [...] }` envelope on some paths and as a bare array on others, so
   * the narrower reads it through `wireListOutput`, which accepts both.
   */
  plural: boolean;
}

/**
 * Bind the chosen pipe's output onto the exports the projection just produced.
 *
 * The narrower is typed — the ts-zod emitter projects native concepts too, so a
 * binder always exports a `parse<Concept>` for whatever the pipe produces. What
 * makes that safe to write blind is this check: the exports are looked for in
 * the artifacts we have in hand, so an emitter naming change is a refusal here
 * rather than a type error the person has to debug in a file they did not write.
 */
export function bindOutput(
  contract: PipeIOContract,
  artifacts: readonly GeneratedArtifact[],
): OutputBinding {
  const conceptRef = contract.output.concept_ref;
  const conceptCode = conceptRef.slice(conceptRef.lastIndexOf(".") + 1);
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(conceptCode)) {
    throw new AddMethodError(
      `the pipe's output concept "${conceptRef}" does not end in a name this scaffold can ` +
        "turn into a TypeScript identifier.",
    );
  }

  const plural = contract.output.multiplicity !== "single";
  const bodyOf = (name: string): string => {
    const artifact = artifacts.find((candidate) => candidate.path === name);
    if (artifact === undefined) {
      throw new AddMethodError(`the codegen response carries no ${name} to bind the output to.`);
    }
    return artifact.content;
  };

  if (!bodyOf("types.ts").includes(`export const ${conceptCode}Schema`)) {
    throw new AddMethodError(
      `the generated types.ts exports no ${conceptCode}Schema for the pipe's output ` +
        `concept "${conceptRef}". Nothing was written; report it upstream.`,
    );
  }
  // The plural arm parses through `z.array(<Code>Schema)`, so it needs the
  // schema and not the single-value binder.
  if (!plural && !bodyOf("binder.ts").includes(`export function parse${conceptCode}(`)) {
    throw new AddMethodError(
      `the generated binder.ts exports no parse${conceptCode} for the pipe's output ` +
        `concept "${conceptRef}". Nothing was written; report it upstream.`,
    );
  }

  return { conceptCode, plural };
}

// ── File inputs ─────────────────────────────────────────────────────────────

/** One file-bearing position of a pipe's inputs, at any depth. */
export interface FileInput {
  /** Dotted, with `[]` for a list's items: `document`, `cvs[]`, `packet.scan`. */
  path: string;
  kind: "document" | "image";
}

function collectFiles(node: InputFormItem, at: string, out: FileInput[]): void {
  if (node.kind === "document" || node.kind === "image") {
    out.push({ path: at, kind: node.kind });
  } else if (node.kind === "object") {
    for (const child of node.fields) collectFiles(child, `${at}.${child.name}`, out);
  } else if (node.kind === "list") {
    collectFiles(node.item, `${at}[]`, out);
  }
}

/**
 * Every file position a pipe's inputs declare, in descriptor order.
 *
 * Any one of them gives the slice the PDF example's whole path: the browser
 * encodes through `useFileInputs` (the kernel's list and object controls hand
 * a nested file to the same `onDropFile` seam, at its dotted id), the action
 * gates every position with `checkFileInputs` — which walks this same
 * descriptor — and `prepareInputs` uploads them. Depth does not change the
 * shape of what is scaffolded, only the media types the gate accepts.
 */
export function fileInputsOf(descriptor: PipeInputFormDescriptor): FileInput[] {
  const files: FileInput[] = [];
  for (const field of descriptor.fields) collectFiles(field, field.name, files);
  return files;
}

/** The media types a scaffolded action accepts, by the file kinds it declares. */
export function allowedMimesFor(files: FileInput[]): string[] {
  const mimes = new Set<string>();
  for (const field of files) {
    if (field.kind === "document") mimes.add("application/pdf");
    else for (const mime of ["image/png", "image/jpeg", "image/webp"]) mimes.add(mime);
  }
  return [...mimes];
}

/** Does the pipe have an input the run gate will refuse an empty submission for? */
export function hasGatingInput(descriptor: PipeInputFormDescriptor): boolean {
  return descriptor.fields.some((field) => field.gating);
}

// ── The tab ─────────────────────────────────────────────────────────────────

/**
 * The two markers `src/components/ExampleTabs.tsx` carries, and the scaffold's
 * whole contract with that file.
 *
 * The match is on the token alone, not on the full comment line, so the prose
 * after it can be reworded freely; the tokens themselves may not move. An
 * anchor test reads the real file, so a template edit that loses one fails the
 * suite rather than the next person's scaffold run.
 */
export const IMPORTS_ANCHOR = "// add-method:imports";
export const TABS_ANCHOR = "// add-method:tabs";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One entry of the `TABS` array, and the import that feeds it. */
export interface TabEntry {
  id: string;
  label: string;
  componentName: string;
}

/**
 * Insert a scaffolded tab into `ExampleTabs.tsx` — one import line above the
 * imports anchor, one array entry above the tabs anchor.
 *
 * Pure over the source text: the orchestration does this in memory during its
 * read-only half, so a missing anchor or a duplicate id is a refusal before
 * anything is written.
 */
export function insertTab(source: string, entry: TabEntry): string {
  const lines = source.split("\n");
  const importsAt = lines.findIndex((line) => line.includes(IMPORTS_ANCHOR));
  const tabsAt = lines.findIndex((line) => line.includes(TABS_ANCHOR));

  for (const [anchor, at] of [
    [IMPORTS_ANCHOR, importsAt],
    [TABS_ANCHOR, tabsAt],
  ] as const) {
    if (at === -1) {
      throw new AddMethodError(
        `src/components/ExampleTabs.tsx has no '${anchor}' anchor.\n` +
          "  The scaffold inserts at that comment; restore it (see the file's other anchor\n" +
          "  for the shape) or add the tab by hand.",
      );
    }
  }
  if (new RegExp(`\\bid:\\s*"${escapeRegExp(entry.id)}"`).test(source)) {
    throw new AddMethodError(
      `src/components/ExampleTabs.tsx already has a tab with id "${entry.id}". ` +
        "Pass --name to scaffold under a different name.",
    );
  }
  if (new RegExp(`\\b${escapeRegExp(entry.componentName)}\\b`).test(source)) {
    throw new AddMethodError(
      `src/components/ExampleTabs.tsx already mentions ${entry.componentName}. ` +
        "Pass --name to scaffold under a different name.",
    );
  }

  const indent = /^\s*/.exec(lines[tabsAt]!)?.[0] ?? "  ";
  const withImport = [
    ...lines.slice(0, importsAt),
    `import { ${entry.componentName} } from "./${entry.componentName}";`,
    ...lines.slice(importsAt),
  ];
  const entryAt = tabsAt + 1; // the import above pushed everything down one line
  return [
    ...withImport.slice(0, entryAt),
    `${indent}{ id: ${JSON.stringify(entry.id)}, label: ${JSON.stringify(entry.label)}, ` +
      `Component: ${entry.componentName} },`,
    ...withImport.slice(entryAt),
  ].join("\n");
}

// ── The emitted files ───────────────────────────────────────────────────────

/** Everything the templates read, derived once by the read-only half. */
export interface ScaffoldPlan {
  names: ScaffoldNames;
  selector: ValidateMethodSelector;
  pipe: ChosenPipe;
  binding: OutputBinding;
  files: FileInput[];
  /** Does the run gate refuse an empty submission? Decides the emitted test. */
  gating: boolean;
}

/** The manifest — the whole of the selector story on the codegen side. */
export function renderManifest(selector: ValidateMethodSelector): string {
  return `${JSON.stringify(selector, null, 2)}\n`;
}

/** How the selector reads as a TypeScript constant pair: the name and the literal. */
function selectorConstant(selector: ValidateMethodSelector): { name: string; value: string } {
  return selectorKind(selector) === "method_ref"
    ? { name: "METHOD_REF", value: JSON.stringify(selector.method_ref) }
    : { name: "METHOD_ID", value: JSON.stringify(selector.method_id) };
}

/**
 * `src/types/<camel>Pipeline.ts` — the adapter over the method's own generated
 * binder, written exactly like the four hand-written ones.
 *
 * The single arm hands `wireOutput` to the binder. The plural arm parses
 * `z.array(<Code>Schema)` over `wireListOutput`, which is what knows that the
 * runtime renders a list output two ways — `{ items: [...] }` on the blocking
 * path, a bare array on the durable path for a method-declared concept — and
 * hands back the array either way. Neither arm declares a field: the element
 * schema is the generated one, and the list around it is the contract's
 * `multiplicity`, not a shape.
 */
export function renderAdapter(plan: ScaffoldPlan): string {
  const { names, binding } = plan;
  const outputType = `${names.pascal}Output`;
  const parseName = `parse${names.pascal}Output`;
  const header = [
    "// Scaffolded by `make add-method` — yours to edit from here on.",
    "//",
    "// The output shape is NOT written here: `npm run codegen` projects it from the",
    `// method \`${scaffoldPaths(names).manifest}\` names, and this module is the`,
    "// thin adapter over that projection. If you find yourself declaring fields,",
    "// the method already declares them.",
    "",
  ];

  if (!binding.plural) {
    return [
      ...header,
      'import type { RunResults } from "@pipelex/sdk";',
      `import { parse${binding.conceptCode} } from "@/generated/${names.slug}/binder";`,
      `import { ${binding.conceptCode}Schema, type ${binding.conceptCode} } from "@/generated/${names.slug}/types";`,
      'import { describeSchemaFailure, wireOutput } from "@/lib/wireOutput";',
      'import { BadPipelineOutputError } from "@/types/pipelineError";',
      "",
      `/** The pipe's output concept, re-exported under this slice's own name. */`,
      `export type ${outputType} = ${binding.conceptCode};`,
      "",
      "/**",
      ` * Narrow a run's output into \`${outputType}\` by handing \`main_stuff\` to the`,
      " * generated binder. Throws `BadPipelineOutputError` on a shape mismatch — this is",
      " * a system boundary (model output → typed app), so a failure is a real bug we",
      " * want surfaced; the blocking/poll catch classifies it.",
      " */",
      `export function ${parseName}(results: RunResults): ${outputType} {`,
      "  try {",
      `    return parse${binding.conceptCode}(wireOutput(results, ${binding.conceptCode}Schema));`,
      "  } catch (err) {",
      `    throw new BadPipelineOutputError(describeSchemaFailure(err, ${JSON.stringify(binding.conceptCode)}));`,
      "  }",
      "}",
      "",
    ].join("\n");
  }

  const listSchema = `${names.pascal}OutputSchema`;
  return [
    ...header,
    'import type { RunResults } from "@pipelex/sdk";',
    'import { z } from "zod";',
    `import { ${binding.conceptCode}Schema, type ${binding.conceptCode} } from "@/generated/${names.slug}/types";`,
    'import { describeSchemaFailure, wireListOutput } from "@/lib/wireOutput";',
    'import { BadPipelineOutputError } from "@/types/pipelineError";',
    "",
    `/** This pipe produces several items: its output is a list of the concept. */`,
    `export type ${outputType} = ${binding.conceptCode}[];`,
    "",
    `const ${listSchema} = z.array(${binding.conceptCode}Schema);`,
    "",
    "/**",
    ` * Narrow a run's output into \`${outputType}\`. The runtime renders a list output`,
    " * two ways — a `{ items: [...] }` envelope on the blocking path, a bare array on",
    " * the durable path — and `wireListOutput` hands back the array either way, so",
    " * the generated element schema owns the verdict. Throws `BadPipelineOutputError`",
    " * on a shape mismatch — a system boundary, so a failure is a real bug we want",
    " * surfaced; the blocking/poll catch classifies it.",
    " */",
    `export function ${parseName}(results: RunResults): ${outputType} {`,
    "  try {",
    `    return ${listSchema}.parse(wireListOutput(results, ${binding.conceptCode}Schema));`,
    "  } catch (err) {",
    `    throw new BadPipelineOutputError(describeSchemaFailure(err, ${JSON.stringify(`${binding.conceptCode}[]`)}));`,
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * `src/actions/run<Pascal>Pipeline.ts` — the Server Action trio.
 *
 * Identical in shape to the four hand-written ones but for the run selector: a
 * scaffolded method lives elsewhere, so `buildOptions` sends the same
 * `method_ref` / `method_id` the tree was projected from instead of inline
 * `mthds_contents`, and there is no bundle loader.
 */
export function renderAction(plan: ScaffoldPlan): string {
  const { names, selector, pipe, files } = plan;
  const outputType = `${names.pascal}Output`;
  const parseName = `parse${names.pascal}Output`;
  const constant = selectorConstant(selector);
  const hasFiles = files.length > 0;

  const imports = [
    `import { ${hasFiles ? "INPUT_FORM, " : ""}PIPE_IO_CONTRACTS } from "@/generated/${names.slug}/contracts";`,
    `import { ${parseName}, type ${outputType} } from "@/types/${names.camel}Pipeline";`,
    'import { executeBlockingRun, type BlockingOutcome } from "@/lib/blockingRun";',
    "import {",
    "  pollDurableRun,",
    "  startDurableRun,",
    "  type PollOutcome,",
    "  type StartOutcome,",
    '} from "@/lib/durableRun";',
    `import { gateRunInputs, requireContract${hasFiles ? ", requireInputForm" : ""} } from "@/lib/runInputs";`,
    'import type { PipelexStartOptions } from "@pipelex/sdk";',
  ];
  if (hasFiles) {
    imports.splice(
      2,
      0,
      'import { getPipelexClient } from "@/lib/pipelexClient";',
      'import { MAX_PDF_BYTES, checkFileInputs } from "@/lib/fileEncoding";',
      'import type { PipelineError } from "@/lib/errors";',
    );
  }

  const head = [
    '"use server";',
    "",
    ...imports,
    "",
    "// Scaffolded by `make add-method` — yours to edit from here on.",
    "//",
    "// The method is NOT copied into this repo: it lives where",
    `// \`${scaffoldPaths(names).manifest}\` says, and the run names the same selector the`,
    "// generated tree was projected from. To move to another version of it, edit that",
    "// manifest and run `npm run codegen`.",
    `const ${constant.name} = ${constant.value};`,
    `const PIPE_CODE = ${JSON.stringify(pipe.code)};`,
  ];
  if (hasFiles) {
    head.push(
      "/** `prepareInputs` keys on the qualified ref — a bare pipe code is refused. */",
      `const PIPE_REF = ${JSON.stringify(pipe.ref)};`,
    );
  }
  head.push(
    "",
    "// The same generated contract the browser rendered the form from. One gate, two",
    "// call sites, zero drift — and the server's copy is the one that's trusted.",
    `const CONTRACT = requireContract(PIPE_IO_CONTRACTS, ${JSON.stringify(pipe.domain)}, PIPE_CODE);`,
  );
  if (hasFiles) {
    head.push(
      "// The file gate walks the same wire descriptor the browser rendered the form",
      "// from, and the SDK's `prepareInputs` resolves uploads by — so the three agree",
      "// on where the files are, at any depth.",
      `const DESCRIPTOR = requireInputForm(INPUT_FORM, ${JSON.stringify(pipe.domain)}, PIPE_CODE);`,
    );
  }
  head.push("");

  const gateName = hasFiles ? "gateInputs" : "gateRunInputs";
  const body: string[] = [];

  if (hasFiles) {
    body.push(
      "/** Media types the file input(s) accept. Widen it if your method takes more. */",
      `const ALLOWED_MIMES = ${JSON.stringify(allowedMimesFor(files))};`,
      "",
      "/**",
      " * Shape gate, then file gate, in that order — the PDF example's pattern.",
      " *",
      " * The kernel gate proves the shape a contract can declare; `checkFileInputs`",
      " * proves what it cannot: that the `url` at every file position the descriptor",
      " * declares — top-level, in a list, nested in a structured concept — is a",
      " * reference we accept, and that any bytes riding inline are an allowed type",
      " * under the cap. The scheme half is the security-relevant one — `prepareInputs`",
      " * reads an unrecognised string as a local filesystem path, and a Server Action",
      " * is a public endpoint.",
      " */",
      "function gateInputs(",
      "  data: Record<string, unknown>,",
      "): { ok: true; inputs: Record<string, unknown> } | { ok: false; error: PipelineError } {",
      "  const gated = gateRunInputs(CONTRACT, data);",
      "  if (!gated.ok) return gated;",
      "  const error = checkFileInputs(DESCRIPTOR, gated.inputs, {",
      "    allowedMimes: ALLOWED_MIMES,",
      "    maxBytes: MAX_PDF_BYTES,",
      "  });",
      "  return error ? { ok: false, error } : gated;",
      "}",
      "",
      "/**",
      " * Build the run options, uploading the file(s) through the SDK's",
      " * signature-driven `prepareInputs` rather than hand-rolling an envelope: it",
      " * reads the method's declared signature, uploads the decoded bytes to Pipelex",
      " * storage and rewrites each file input to a small `pipelex-storage://` URI, so",
      " * the run request carries a reference instead of fat inline base64.",
      " *",
      " * It throws *before any run starts*, and this closure runs inside",
      " * `executeBlockingRun` / `startDurableRun`'s try/catch, so that error is",
      " * classified like any other SDK error — no try/catch here.",
      " */",
      "async function buildOptions(",
      "  inputs: Record<string, unknown>,",
      "): Promise<PipelexStartOptions> {",
      "  const prepared = await getPipelexClient().prepareInputs({",
      `    ${constant.name === "METHOD_REF" ? "method_ref" : "method_id"}: ${constant.name},`,
      "    pipe_ref: PIPE_REF,",
      "    inputs,",
      "  });",
      "  return {",
      `    ${constant.name === "METHOD_REF" ? "method_ref" : "method_id"}: ${constant.name},`,
      "    pipe_code: PIPE_CODE,",
      "    inputs: prepared.inputs,",
      "  };",
      "}",
      "",
    );
  } else {
    body.push(
      "/**",
      " * SDK options shared by both paths — `execute` and `start` take the same shape.",
      " *",
      " * `PipelexStartOptions` is the protocol's run arguments plus the run extensions;",
      " * the selector below is one of those, which is what lets this action name a",
      " * method that lives elsewhere instead of shipping a bundle inline.",
      " */",
      "async function buildOptions(",
      "  inputs: Record<string, unknown>,",
      "): Promise<PipelexStartOptions> {",
      "  return {",
      `    ${constant.name === "METHOD_REF" ? "method_ref" : "method_id"}: ${constant.name},`,
      "    pipe_code: PIPE_CODE,",
      "    inputs,",
      "  };",
      "}",
      "",
    );
  }

  const gateCall =
    gateName === "gateRunInputs" ? "gateRunInputs(CONTRACT, data)" : "gateInputs(data)";

  body.push(
    "/**",
    " * BLOCKING path (`POST /v1/execute`). Behind the hosted gateway a synchronous run",
    " * is cut off at ~30s; flip the example to Durable mode to survive a long one.",
    " */",
    `export async function run${names.pascal}Blocking(`,
    "  data: Record<string, unknown>,",
    `): Promise<BlockingOutcome<${outputType}>> {`,
    `  const gated = ${gateCall};`,
    "  if (!gated.ok) return gated;",
    `  return executeBlockingRun(() => buildOptions(gated.inputs), ${parseName});`,
    "}",
    "",
    "/** DURABLE path — start the run (`POST /v1/start`) and return its id to poll. */",
    `export async function start${names.pascal}Run(data: Record<string, unknown>): Promise<StartOutcome> {`,
    `  const gated = ${gateCall};`,
    "  if (!gated.ok) return gated;",
    "  return startDurableRun(() => buildOptions(gated.inputs));",
    "}",
    "",
    "/** DURABLE path — poll one tick of a started run by id. */",
    `export async function poll${names.pascal}Run(runId: string): Promise<PollOutcome<${outputType}>> {`,
    `  return pollDurableRun(runId, ${parseName});`,
    "}",
    "",
  );

  return [...head, ...body].join("\n");
}

/**
 * `src/actions/run<Pascal>Pipeline.test.ts` — one fixture-free test, and no more.
 *
 * A test that guessed input values from the descriptor would be a liability the
 * day it guessed wrong, so this asserts only what is true without knowing what
 * the method takes: the trust boundary (a gating pipe refuses an empty
 * submission before the SDK is reached), or, for a pipe that gates on nothing,
 * that an empty submission reaches `execute` carrying the selector and the bare
 * pipe code. Everything else the slice does is covered by the shared code's own
 * tests — `useRun`, `RunInputsForm`, `runInputs`, `blockingRun`, `durableRun`.
 */
export function renderActionTest(plan: ScaffoldPlan): string {
  const { names, selector, pipe, files, gating } = plan;
  const constant = selectorConstant(selector);
  const selectorField = constant.name === "METHOD_REF" ? "method_ref" : "method_id";
  const hasFiles = files.length > 0;

  const clientMethods = ["execute", "start", "getRunStatus", "getRunResult"];
  if (hasFiles) clientMethods.push("prepareInputs");

  const head = [
    'import { describe, it, expect, vi, beforeEach } from "vitest";',
    "",
    ...clientMethods.map((method) => `const ${method} = vi.fn();`),
    "",
    'vi.mock("@/lib/pipelexClient", () => ({',
    `  getPipelexClient: () => ({ ${clientMethods.join(", ")} }),`,
    "}));",
    "",
    "import {",
    `  run${names.pascal}Blocking,`,
    `  start${names.pascal}Run,`,
    `} from "./run${names.pascal}Pipeline";`,
    "",
    "beforeEach(() => {",
    ...clientMethods.map((method) => `  ${method}.mockReset();`),
    "});",
    "",
    "// Scaffolded by `make add-method`, and deliberately fixture-free: a test that",
    "// guessed input values from the method's descriptor would be wrong the day the",
    "// method changes. Add your own cases with real inputs once you know what this",
    "// method takes — `src/actions/runExtractEntitiesPipeline.test.ts` is the shape.",
    `describe("run${names.pascal}Pipeline", () => {`,
  ];

  const body = gating
    ? [
        "  // The browser's readiness check is the Run button's UX; this is the trust",
        "  // boundary. The gate runs the kernel's rules over the method's own contract.",
        '  it("refuses an empty submission before calling the SDK (blocking)", async () => {',
        `    const result = await run${names.pascal}Blocking({});`,
        '    expect(result).toMatchObject({ ok: false, error: { kind: "bad_request" } });',
        "    expect(execute).not.toHaveBeenCalled();",
        "  });",
        "",
        '  it("refuses an empty submission before calling the SDK (durable)", async () => {',
        `    const result = await start${names.pascal}Run({});`,
        '    expect(result).toMatchObject({ ok: false, error: { kind: "bad_request" } });',
        "    expect(start).not.toHaveBeenCalled();",
        "  });",
      ]
    : [
        "  // This pipe gates on nothing, so an empty submission is a legitimate run and",
        "  // what is worth pinning is the wiring: the selector and the bare pipe code.",
        '  it("sends the selector and the bare pipe code to the SDK", async () => {',
        ...(hasFiles
          ? ["    prepareInputs.mockResolvedValueOnce({ inputs: {}, uploads: [] });"]
          : []),
        '    execute.mockResolvedValueOnce({ pipeline_run_id: "run-1", main_stuff: {} });',
        `    await run${names.pascal}Blocking({});`,
        "    expect(execute).toHaveBeenCalledWith({",
        `      ${selectorField}: ${constant.value},`,
        `      pipe_code: ${JSON.stringify(pipe.code)},`,
        "      inputs: {},",
        "    });",
        "  });",
      ];

  return [...head, ...body, "});", ""].join("\n");
}

/**
 * `src/components/<Pascal>Form.tsx` — the two kernel compositions, plus the
 * chrome the shipped examples share.
 *
 * Nothing about the method's IO is written by hand, on either side or in either
 * view: the input fields come from its committed input-form descriptor through
 * `useRunInputs` and are rendered by `<RunInputsForm>`, the result comes from
 * its output-form descriptor paired with the payload schema and is rendered by
 * `<RunResult>`, and the designed page comes from the layout `make design`
 * committed and is rendered by `<DesignedPage>`. A result component used to be
 * the one thing the scaffold could not project — it would have been inventing
 * headings for fields it had never seen — and the descriptor is what removed
 * that gap; the page is the same move one level out.
 *
 * The design import is unconditional, and that is why `npm run codegen` writes
 * a `design.ts` for every method whether one has been produced or not: a
 * scaffold runs before any design exists, and a module that is sometimes there
 * is a module a scaffold cannot import at the top of the file.
 */
export function renderForm(plan: ScaffoldPlan): string {
  const { names, pipe, files } = plan;
  const hasFiles = files.length > 0;
  const resultName = names.slug.replace(/-/g, "_");

  const imports = [
    '"use client";',
    "",
    'import { useState } from "react";',
    ...(hasFiles
      ? [
          'import { INPUTS_ROOT, pathFromDomId, segmentsUnder } from "@pipelex/mthds-form/generative";',
        ]
      : []),
    'import { humanizeFieldName } from "@pipelex/mthds-form/react";',
    "import {",
    `  poll${names.pascal}Run,`,
    `  run${names.pascal}Blocking,`,
    `  start${names.pascal}Run,`,
    `} from "@/actions/run${names.pascal}Pipeline";`,
    'import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";',
    `import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/${names.slug}/contracts";`,
    `import { DESIGN } from "@/generated/${names.slug}/design";`,
    ...(hasFiles ? ['import { useFileInputs } from "@/hooks/useFileInputs";'] : []),
    'import { useRun } from "@/hooks/useRun";',
    'import { useRunInputs } from "@/hooks/useRunInputs";',
    'import type { DesignFallback } from "@/lib/design";',
    'import { requireResultField } from "@/lib/resultField";',
    'import { requireContract, requireInputForm } from "@/lib/runInputs";',
    'import { CostReport } from "./CostReport";',
    'import { DesignedPage } from "./DesignedPage";',
    'import { DesignFallbackNote } from "./DesignFallbackNote";',
    'import { ErrorDisplay } from "./ErrorDisplay";',
    'import { ModeToggle } from "./ModeToggle";',
    'import { RunInputsForm } from "./RunInputsForm";',
    'import { RunResult } from "./RunResult";',
    'import { RunStatus } from "./RunStatus";',
    'import { ViewToggle, type InputView } from "./ViewToggle";',
    "",
    "// Scaffolded by `make add-method` — yours to edit from here on.",
    "//",
    "// The three things this component knows about its method are all committed by",
    "// `npm run codegen`: the form from the input-form descriptor, the result view",
    "// from the output-form descriptor paired with the payload schema, and the page",
    "// from the layout a model designed. There is nothing hand-written to keep in",
    "// step — change what the method takes or produces, regenerate, and all three",
    "// follow.",
    "//",
    "// `DESIGN` is `null` until you take the second gesture, `make design NAME=" +
      names.slug +
      "`,",
    "// and until then the kernel's plain form renders — which is the fallback rule's",
    "// first case, not a gap.",
    `const CONTRACT = requireContract(PIPE_IO_CONTRACTS, ${JSON.stringify(pipe.domain)}, ${JSON.stringify(pipe.code)});`,
    `const DESCRIPTOR = requireInputForm(INPUT_FORM, ${JSON.stringify(pipe.domain)}, ${JSON.stringify(pipe.code)});`,
    `const RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, ${JSON.stringify(pipe.domain)}, ${JSON.stringify(pipe.code)});`,
    `const RESULT_NAME = ${JSON.stringify(resultName)};`,
    "/** Prefixes the DOM ids the designed page's escape hatches mint. */",
    `const ID_PREFIX = ${JSON.stringify(names.slug)};`,
    "",
  ];

  if (hasFiles) {
    imports.push(
      "/**",
      " * The id inverse the designed view needs.",
      " *",
      " * On the plain form the kernel's id IS the dotted value path. On a designed",
      " * page the file control was reached through the layout's `MthdsField` hatch,",
      " * which mints its id from the store pointer, so the host maps it back before",
      " * it writes. One hook serves both views, so this answers for both spellings.",
      " */",
      "function inputPathOf(id: string): string[] | undefined {",
      "  const pointer = pathFromDomId(ID_PREFIX, id);",
      '  if (pointer === undefined) return id.split(".");',
      "  return segmentsUnder(INPUTS_ROOT, pointer);",
      "}",
      "",
    );
  }

  imports.push(
    `export function ${names.pascal}Form() {`,
    "  const { fields, values, setValues, ready, toData, design, store } = useRunInputs(",
    "    CONTRACT,",
    "    DESCRIPTOR,",
    "    undefined,",
    "    DESIGN,",
    "  );",
    "  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);",
    '  const [view, setView] = useState<InputView>("designed");',
    "  const [renderError, setRenderError] = useState<string | null>(null);",
    "  // `useRun` presents one state machine and dispatches to the blocking or",
    "  // durable Server Actions by `mode`. The form never branches on mode itself.",
    `  const { state, run${hasFiles ? ", reset" : ""} } = useRun({`,
    "    mode,",
    `    blocking: run${names.pascal}Blocking,`,
    `    start: start${names.pascal}Run,`,
    `    poll: poll${names.pascal}Run,`,
    "  });",
    "",
  );

  if (hasFiles) {
    imports.push(
      "  // The host side of the form kernel's file seam — the encode, the busy set the",
      "  // kernel reads as `uploadingIds`, the clear-before-await discipline, and on a",
      "  // designed page the id inverse above. The kernel never uploads: it hands the",
      "  // host a `File` and waits for a `FileValue` back.",
      "  const { dropFile, encodingIds, fileError, clearError } = useFileInputs({",
      "    setValues,",
      "    onSelectionStart: reset,",
      "    pathOf: inputPathOf,",
      "  });",
      "",
    );
  }

  imports.push(
    '  const running = state.phase === "running";',
    ...(hasFiles ? ["  const resolving = encodingIds.size > 0;"] : []),
    "",
    "  // The form kernel's fallback rule, with the render error the boundary reports",
    "  // folded in as its fifth cause. `null` means a designed page is renderable.",
    "  const fallback: DesignFallback | null =",
    "    renderError !== null",
    '      ? { cause: "render_error", message: renderError }',
    "      : design.ok",
    "        ? null",
    "        : design.fallback;",
    "  const designed = fallback === null && design.ok && store !== null;",
    "",
  );

  const submit = [
    "  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {",
    "    event.preventDefault();",
    ...(hasFiles ? ["    clearError();"] : []),
    "    // The action gates the same contract server-side, applying the kernel's",
    "    // rules in full — that is the trust boundary; `ready` below is only UX.",
    "    run(toData());",
    "  }",
    "",
    "  // Built once and placed in one of two places: under the plain form, or into",
    "  // the designed page's result slot. The same fragment either way, because what",
    "  // a run yields is not a property of how its inputs were laid out.",
    "  const outcome =",
    `    state.phase === "idle"${hasFiles ? " && !fileError" : ""} ? null : (`,
    "      <>",
    "        {running && (",
    "          <RunStatus status={state.status} elapsedMs={state.elapsedMs} health={state.health} />",
    "        )}",
    ...(hasFiles
      ? [
          "        {fileError && <ErrorDisplay error={fileError} />}",
          '        {!fileError && state.phase === "error" && <ErrorDisplay error={state.error} />}',
        ]
      : ['        {state.phase === "error" && <ErrorDisplay error={state.error} />}']),
    '        {state.phase === "done" && (',
    "          <>",
    "            {/* The result, rendered from the method's own output contract — the",
    "                scaffold has no design decision to make about a shape it has never",
    "                seen, because there is none left to make. */}",
    "            <RunResult field={RESULT_FIELD} value={state.output} name={RESULT_NAME} />",
    "            <CostReport usage={state.usage} />",
    "          </>",
    "        )}",
    "      </>",
    "    );",
    "",
  ];

  const formProps = hasFiles
    ? [
        "            <RunInputsForm",
        "              fields={fields}",
        "              values={values}",
        "              onValuesChange={(next) => {",
        "                // A rejection belongs to the value that caused it: the kernel's",
        '                // "paste a URL instead" writes straight through this setter.',
        "                clearError();",
        "                setValues(next);",
        "              }}",
        "              disabled={running}",
        "              env={{ onDropFile: dropFile, uploadingIds: encodingIds }}",
        "            />",
      ]
    : [
        "            <RunInputsForm",
        "              fields={fields}",
        "              values={values}",
        "              onValuesChange={setValues}",
        "              disabled={running}",
        "            />",
      ];

  const jsx = [
    "  return (",
    '    <div className="space-y-6">',
    "      {/* App chrome, above whichever view is on screen — the two toggles are",
    "          this app's, not the layout's. */}",
    '      <div className="flex flex-wrap items-start gap-4">',
    "        <ModeToggle value={mode} onChange={setMode} disabled={running} />",
    "        {design.ok && renderError === null && (",
    "          <ViewToggle value={view} onChange={setView} disabled={running} />",
    "        )}",
    "      </div>",
    "",
    '      {designed && view === "designed" ? (',
    "        <DesignedPage",
    "          design={design.design}",
    "          spec={design.spec}",
    "          store={store}",
    "          fields={fields}",
    "          idPrefix={ID_PREFIX}",
    ...(hasFiles
      ? [
          "          env={{",
          "            onDropFile: dropFile,",
          "            uploadingIds: encodingIds,",
          "            disabled: running || resolving,",
          "          }}",
        ]
      : ["          env={{ disabled: running }}"]),
    "          onRun={() => run(toData())}",
    "          result={outcome}",
    "          resultTitle={humanizeFieldName(RESULT_NAME)}",
    "          onRenderError={setRenderError}",
    "        />",
    "      ) : (",
    "        <>",
    '          <form onSubmit={handleSubmit} className="space-y-4">',
    ...formProps,
    "            <button",
    '              type="submit"',
    "              disabled={running || !ready}",
    '              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"',
    "            >",
    `              {running ? "Running…" : ${JSON.stringify(`Run ${names.label.toLowerCase()}`)}}`,
    "            </button>",
    "          </form>",
    "          <DesignFallbackNote fallback={fallback} />",
    "          {outcome}",
    "        </>",
    "      )}",
    "    </div>",
    "  );",
    "}",
    "",
  ];

  return [...imports, ...submit, ...jsx].join("\n");
}

// ── The orchestration ───────────────────────────────────────────────────────

/** The client surface the gesture needs — the two crate routes, the handshake, the catalog. */
export type AddMethodClient = Pick<
  PipelexApiClient,
  "codegen" | "validate" | "validateFiles" | "version" | "getMethod"
>;

/** What the tests swap out: the tree the gesture writes into, and the API it talks to. */
export interface AddMethodDeps {
  repoRoot: string;
  client: AddMethodClient;
  baseUrl: string;
}

/** The parsed command line. */
export interface AddMethodArgs {
  method: string;
  pipe?: string;
  name?: string;
  label?: string;
  dryRun: boolean;
}

const USAGE =
  "usage: npm run add-method -- <mt_… | github.com/owner/repo[/package][@tag]> " +
  "[--pipe <pipe_code>] [--name <dir-name>] [--label <tab label>] [--dry-run]";

/**
 * Parse the command line, refusing an unknown flag and a swallowed value.
 *
 * A value starting with `--` almost certainly means the real one was dropped
 * and the next flag is about to be eaten — `--label --dry-run` turning a
 * rehearsal into a real run is exactly the accident worth failing loudly on.
 */
export function parseArgs(argv: readonly string[]): AddMethodArgs {
  const FLAGS: Record<string, "pipe" | "name" | "label"> = {
    "--pipe": "pipe",
    "--name": "name",
    "--label": "label",
  };
  const parsed: Partial<AddMethodArgs> = {};
  let dryRun = false;
  let method: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg in FLAGS) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new AddMethodError(`missing value for ${arg}.\n  ${USAGE}`);
      }
      parsed[FLAGS[arg]!] = value;
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new AddMethodError(`unknown argument ${JSON.stringify(arg)}.\n  ${USAGE}`);
    } else if (method === undefined) {
      method = arg;
    } else {
      throw new AddMethodError(
        `unexpected second method ${JSON.stringify(arg)} — the gesture scaffolds one.\n  ${USAGE}`,
      );
    }
  }

  if (method === undefined) throw new AddMethodError(`no method given.\n  ${USAGE}`);
  return { method, pipe: parsed.pipe, name: parsed.name, label: parsed.label, dryRun };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format an emitted source through this repo's own Prettier config.
 *
 * Not a nicety: the emitted files land under `src/`, which `make check` runs
 * `prettier --check` over, so a slice whose method name happened to push one
 * line past the print width would fail the very first `make all` after being
 * scaffolded. Letting the formatter decide removes a whole class of that. If
 * Prettier cannot be loaded the content is written as-is and the caller is told;
 * a Prettier that loads and then throws is a broken template, and it propagates.
 */
async function formatEmitted(filePath: string, content: string): Promise<string> {
  let prettier: typeof import("prettier");
  try {
    prettier = await import("prettier");
  } catch {
    console.error(
      "add-method: prettier is not installed — writing unformatted; run `make format`.",
    );
    return content;
  }
  const options = await prettier.resolveConfig(filePath);
  return prettier.format(content, { ...options, filepath: filePath });
}

/** One file the gesture is about to write: where it goes and what goes in it. */
interface EmittedFile {
  /** Repo-relative, for the messages. */
  relative: string;
  content: string;
}

/**
 * The whole `make add-method` behavior, exit code included.
 *
 * `deps` is what the tests replace; omitted, it loads `.env.local`, checks the
 * base URL and the key, and constructs the same client `npm run codegen` uses.
 * Never throws: a refusal is a printed line and exit 1.
 */
export async function runAddMethod(argv: readonly string[], deps?: AddMethodDeps): Promise<number> {
  try {
    return await runAddMethodInner(argv, deps);
  } catch (error) {
    if (error instanceof AddMethodError) {
      console.error(`add-method: ${error.message}`);
      return EXIT_FAILED;
    }
    console.error(`add-method: ${error instanceof Error ? error.stack : String(error)}`);
    return EXIT_FAILED;
  }
}

function resolveDeps(deps?: AddMethodDeps): AddMethodDeps {
  if (deps !== undefined) return deps;

  loadEnvConfig(REPO_ROOT, false, { info: () => {}, error: console.error });
  const baseUrl = process.env.PIPELEX_BASE_URL ?? DEFAULT_API_BASE_URL;
  assertSecureBaseUrl(baseUrl);
  if (!process.env.PIPELEX_API_KEY) {
    throw new AddMethodError("PIPELEX_API_KEY is not set — add it to .env.local.");
  }
  // Constructed bare, exactly as `generate.mts` does: the `@/` alias is a
  // tsconfig path mapping Node's resolver never reads, and the client picks up
  // the same environment natively, so this IS the same client.
  return { repoRoot: REPO_ROOT, client: new PipelexApiClient(), baseUrl };
}

async function runAddMethodInner(argv: readonly string[], deps?: AddMethodDeps): Promise<number> {
  const args = parseArgs(argv);
  const { repoRoot, client, baseUrl } = resolveDeps(deps);
  const inRepo = (relative: string): string => path.join(repoRoot, relative);

  // ── Read-only half: nothing below writes until the plan is complete ──
  const selector = parseMethodArg(args.method);

  const unsupported = await assertSelectorSupport(
    client,
    baseUrl,
    new Set([selectorKind(selector)]),
  );
  if (unsupported !== null) throw new AddMethodError(unsupported);

  // A stored method's catalog name is both the slug's source and the tab's
  // default label — a person chose it. A published address has no such name.
  let catalogName: string | undefined;
  if (selectorKind(selector) === "method_id") {
    const method = await client.getMethod(selector.method_id!);
    catalogName = method.name;
  }

  const slug = args.name === undefined ? kebabCase(slugSource(selector, catalogName)) : args.name;
  if (!SLUG_PATTERN.test(slug)) {
    throw new AddMethodError(`--name "${slug}" is not kebab-case (a-z, 0-9 and single dashes).`);
  }
  const names = scaffoldNames(slug, args.label ?? catalogName);
  const paths = scaffoldPaths(names);

  for (const relative of [
    paths.manifestDir,
    paths.generatedDir,
    paths.adapter,
    paths.action,
    paths.actionTest,
    paths.form,
  ]) {
    if (await exists(inRepo(relative))) {
      throw new AddMethodError(
        `${relative} already exists — the gesture is one-shot and never overwrites.\n` +
          `  To refresh a slice that is already here, edit ${paths.manifest} and run\n` +
          "  `npm run codegen`. To start over, remove the slice first (see the README's\n" +
          '  "Remove an example" checklist), or pass --name to scaffold beside it.',
      );
    }
  }

  const manifestContent = renderManifest(selector);
  const source: MethodSource = {
    name: names.slug,
    kind: "selector",
    selector,
    sourceHashes: { [paths.manifest]: hashSource(manifestContent) },
  };

  // The same fetch-and-guard half `npm run codegen` runs, so a scaffolded tree
  // is the tree a regeneration would write — and every codegen refusal (an
  // unresolvable selector, an escaping artifact path, a missing input_form
  // view) happens here, having written nothing.
  const outDir = inRepo(paths.generatedDir);
  const fetched: FetchedMethod | null = await fetchGenerated(client, source, outDir, baseUrl);
  if (fetched === null) return EXIT_FAILED;

  const pipe = choosePipe(
    fetched.contracts.pipeIoContracts,
    fetched.contracts.defaultPipeRef,
    args.pipe,
  );
  const contract = contractFor(fetched.contracts.pipeIoContracts, pipe);
  const descriptor = descriptorFor(fetched.contracts.inputForm, pipe);
  const plan: ScaffoldPlan = {
    names,
    selector,
    pipe,
    binding: bindOutput(contract, fetched.report.artifacts),
    files: fileInputsOf(descriptor),
    gating: hasGatingInput(descriptor),
  };

  const tabsSource = await readFile(inRepo(paths.tabs), "utf-8");
  const tabsUpdated = insertTab(tabsSource, {
    id: names.slug,
    label: names.label,
    componentName: `${names.pascal}Form`,
  });

  const emitted: EmittedFile[] = [
    { relative: paths.adapter, content: renderAdapter(plan) },
    { relative: paths.action, content: renderAction(plan) },
    { relative: paths.actionTest, content: renderActionTest(plan) },
    { relative: paths.form, content: renderForm(plan) },
    { relative: paths.tabs, content: tabsUpdated },
  ];

  const warnings: string[] = [];
  if (selectorKind(selector) === "method_id") {
    warnings.push(
      "a method_id is scoped to your key's organization, so `npm run codegen` on this " +
        "slice needs a key of that same org. A published address (method_ref) is the " +
        "portable form.",
    );
  }

  // ── The plan, printed either way ──
  console.log(`add-method: ${describeSelector(selector)}, via ${baseUrl}`);
  console.log(`  pipe:   ${pipe.ref}`);
  console.log(
    `  output: ${contract.output.concept_ref}` +
      `${plan.binding.plural ? " (plural — a list of the concept)" : ""}`,
  );
  if (plan.files.length > 0) {
    console.log(`  files:  ${plan.files.map((file) => file.path).join(", ")}`);
  }
  console.log(`  tab:    ${JSON.stringify(names.label)} (id ${names.slug})`);

  if (args.dryRun) {
    console.log("\nWould write:");
    for (const relative of [paths.manifest, `${paths.generatedDir}/ (the generated tree)`]) {
      console.log(`  ${relative}`);
    }
    for (const file of emitted) {
      console.log(
        `  ${file.relative}${file.relative === paths.tabs ? " (one import, one tab)" : ""}`,
      );
    }
    for (const warning of warnings) console.log(`\n! ${warning}`);
    console.log("\nNothing was written (--dry-run).");
    return EXIT_OK;
  }

  // ── Write half ──
  await mkdir(inRepo(paths.manifestDir), { recursive: true });
  await writeFile(inRepo(paths.manifest), manifestContent, "utf-8");
  await writeGenerated(outDir, fetched, source, inRepo("methods"));
  for (const file of emitted) {
    await mkdir(path.dirname(inRepo(file.relative)), { recursive: true });
    await writeFile(
      inRepo(file.relative),
      await formatEmitted(inRepo(file.relative), file.content),
      "utf-8",
    );
  }

  console.log("\nWrote:");
  console.log(`  ${paths.manifest}`);
  console.log(
    `  ${paths.generatedDir}/  (types.ts, binder.ts, contracts.ts, design.ts, codegen.lock, sources.json)`,
  );
  for (const file of emitted) {
    console.log(
      `  ${file.relative}${file.relative === paths.tabs ? "  (one import, one tab)" : ""}`,
    );
  }
  for (const warning of warnings) console.log(`\n! ${warning}`);
  console.log(
    [
      "",
      "Next:",
      "  1. `make all` — the slice compiles, lints and tests with the rest of the app.",
      `  2. Open the tab and run it. The form and the result view both come from the`,
      `     method's contract; ${paths.form} is where you replace either with your own.`,
      "",
      `  3. \`make design NAME=${names.slug}\` — optional, and it spends a model call.`,
      `     The tab opens on the kernel's plain form until a method has a design; the`,
      `     gesture produces one, commits it beside the method, and the same tab opens`,
      `     on the page instead. Nothing else changes: the toggle still reaches the`,
      `     plain form, and the run path is the same on both views.`,
    ].join("\n"),
  );
  return EXIT_OK;
}
