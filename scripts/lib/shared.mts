/**
 * The pieces the three codegen scripts must agree on, byte for byte.
 *
 * `generate.mts` writes the trees, `check.mts` proves them current offline,
 * and `verify.mts` asks the engine whether they are still semantically right.
 * All three walk the same directories and hash the same sources the same
 * way; the writer emits the sidecar and the check reads it. Any
 * disagreement between them shows up as a false verdict rather than an error, so
 * the agreement lives here rather than being restated in each script.
 *
 * Nothing here touches the network, `process.env`, or the SDK client: the check
 * has to stay runnable in CI with no API key. Pure validators are fine —
 * `assertSecureBaseUrl` lives here so the two keyed scripts agree on it.
 *
 * Two policies are enforced at this layer, because every caller needs them to
 * produce a *true* verdict rather than a silent wrong one:
 *
 *  - **Only regular files and directories.** A symlink, FIFO, or socket under
 *    `methods/` or a generated tree — or a symlinked tree root, method
 *    directory, or `methods/` / `src/generated/` root — throws
 *    `SymlinkRefusedError` naming the path. Following
 *    symlinks would need cycle handling and would let a symlinked `.mthds`
 *    drop out of the staleness closure; refusing loudly beats both.
 *  - **Fatal UTF-8 decoding.** Every text read goes through `readTextFile`,
 *    which throws `NonUtf8FileError` instead of substituting U+FFFD — a lossy
 *    decode can hash a corrupted artifact to its locked value and report it
 *    `current`.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DesignRecord, MethodDesign } from "../../src/lib/design.ts";
import {
  isStampableArtifactPath,
  type CodegenTreeFile,
  type InputForm,
  type MthdsFileItem,
  type OutputForm,
  type PipeIOContracts,
  type ValidateMethodSelector,
} from "@pipelex/sdk";

// Anchored on this file's location, not `process.cwd()`, so the scripts produce
// the same verdict no matter which directory they are launched from.
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const METHODS_DIR = path.join(REPO_ROOT, "methods");
export const GENERATED_ROOT = path.join(REPO_ROOT, "src", "generated");

/**
 * The lock filename the codegen API emits (`lock_filename` on the response).
 *
 * The offline check opens the lock by this name, so the writer (`generate.mts`) refuses to
 * write one under any other: a response naming a different `lock_filename` is
 * an error there, not something to follow silently. That refusal is what makes
 * the two agree by construction. Writing the new lock beside the old one would
 * not — the old lock is not a stampable artifact, so the tree cleanup never
 * removes it, and the check would go on validating the obsolete file and
 * reporting a confident, wrong verdict.
 */
export const LOCK_FILENAME = "codegen.lock";

/** The starter-owned staleness sidecar, written beside each lock. Not stamped, not locked. */
export const SOURCES_SIDECAR = "sources.json";

/**
 * The starter-owned manifest that names a method living somewhere other than
 * this repo — a stored method's catalog id or a published package's address.
 *
 * A method directory holds either `.mthds` files or this file, never both: the
 * two would disagree on what the generated tree comes from, and the scripts
 * would have to pick a winner. Its bytes are hashed into the sidecar exactly the
 * way a bundle's are, which is what makes "edited the tag, forgot to
 * regenerate" the same `stale-source` verdict with the same remedy.
 */
export const MANIFEST_FILENAME = "method.json";

/**
 * The method's validate-report artifacts — the pipe IO contracts and the wire
 * input-form descriptor — projected from one `POST /v1/validate` call.
 *
 * One file for both payloads, deliberately: they come from the same response,
 * are keyed by the same pipe refs, and are consumed together (`fieldsForContract`
 * co-walks the contract beside the descriptor; the run gate validates against
 * the contract alone). Starter-owned, not server-stamped: the codegen lock signs
 * the artifacts the codegen route emitted and knows nothing about this one,
 * which is why the sidecar grew a `derived` map to cover it (see
 * `DERIVED_ARTIFACTS`).
 */
export const CONTRACTS_FILENAME = "contracts.ts";

/**
 * The layout a model designed for this method, as the producer emitted it:
 * json-render patch lines, one per line. Lives beside the method rather than in
 * the generated tree because that is what the method's page IS about — and
 * because for a method that lives elsewhere it is the one thing this repo owns
 * about it. Two files rather than one so a re-produced design diffs line by
 * line instead of as a single escaped string.
 */
export const DESIGN_JSONL_FILENAME = "design.jsonl";

/** The layout's provenance and its two hashes. See `DesignRecord`. */
export const DESIGN_RECORD_FILENAME = "design.json";

/**
 * The projection of the two files above, written into the generated tree.
 *
 * It exists so a form can import its design UNCONDITIONALLY, at module level,
 * beside `CONTRACT`, `DESCRIPTOR` and `RESULT_FIELD` — `make add-method` writes
 * a tree before any design exists, so the module for "no design yet" has to be a
 * file that is there, exporting `null`.
 */
export const DESIGN_MODULE_FILENAME = "design.ts";

/**
 * Artifacts this repo emits into a generated tree that the codegen lock cannot
 * cover. Each one's SHA-256 goes into the sidecar's `derived` map, and the
 * offline check compares that map against the bytes on disk.
 *
 * The lock is not an option for these: it signs exactly what `POST /v1/codegen`
 * returned, and re-signing it locally would forge the one thing that makes the
 * committed tree traceable to a server response.
 */
export const DERIVED_ARTIFACTS: readonly string[] = [CONTRACTS_FILENAME, DESIGN_MODULE_FILENAME];

export const SIDECAR_COMMENT =
  "Generated by `npm run codegen`. `sources` is the SHA-256 of everything this method is " +
  "generated from — every .mthds file in its closure, or the method.json manifest naming " +
  "where it lives — so the offline check can tell you to regenerate after an edit; `derived` " +
  "is the SHA-256 of each starter-emitted artifact the codegen lock does not sign. " +
  "Not part of the codegen lock — do not hand-edit.";

/** Sidecar shape — deliberately plain, so a human diff reads as "which source changed". */
export interface SourcesSidecar {
  comment: string;
  sources: Record<string, string>;
  /** Starter-emitted artifact filename → SHA-256 of its bytes. See `DERIVED_ARTIFACTS`. */
  derived: Record<string, string>;
}

/**
 * The structured views `contracts.ts` is rendered from, opted into on every
 * `POST /v1/validate` call this repo makes.
 *
 * Shared rather than spelled out twice because `verify.mts` compares the bytes
 * `generate.mts` wrote against a freshly rendered live response: one script
 * asking for a view the other does not would read as drift on a tree nobody
 * touched. A view token is lenient-ignored by an API too old to serve it, so
 * asking for both costs nothing and the callers refuse on the absent payload
 * instead.
 */
export const VALIDATE_VIEWS: string[] = ["input_form", "output_form"];

/**
 * The views of `VALIDATE_VIEWS` a verdict came back without.
 *
 * A view token IS the response key it fills — `views: ["input_form"]` answers
 * on `input_form` — which is the coupling `VALIDATE_VIEWS` already rests on, so
 * one filter over it names every absent payload without a second list to keep in
 * step. Reporting only the first is what sent an operator on two round trips
 * against an API serving neither: they fix the view the message named and hit
 * the same refusal for the other.
 */
export function missingViews(response: object): string[] {
  const payload = response as Record<string, unknown>;
  return VALIDATE_VIEWS.filter((view) => !payload[view]);
}

/**
 * The header every `contracts.ts` opens with.
 *
 * Deliberately does NOT start with codegen's stamp begin-marker: a stamped file
 * the lock does not track is exactly what `runCodegenCheck` calls an `orphan`,
 * and the writer deletes orphans. An unstamped `.ts` beside the lock is the
 * supported shape for a consumer-owned file, and it is what keeps this artifact
 * alive through both the writer's cleanup and the check's verdict.
 */
export const CONTRACTS_HEADER = [
  "// ---------------------------------------------------------------------------",
  "// AUTOGENERATED by `npm run codegen` — DO NOT EDIT.",
  "//",
  "// The method's pipe input/output contracts and both of its wire form",
  "// descriptors, exactly as `POST /v1/validate` returned them, all keyed by",
  "// namespaced pipe ref (`<domain>.<pipe_code>`).",
  "//",
  "// The two halves of the same idea. On the way in, the form kernel derives its",
  "// input fields from INPUT_FORM (co-walking the contract) and the run gate",
  "// validates against the contract. On the way out, OUTPUT_FORM says what the",
  "// result IS and the contract's `output.json_schema` names the property its",
  "// payload sits under; the kernel's `buildResultField` pairs them into the one",
  "// field the result view renders. Look entries up with the kernel's",
  "// `getPipeIOContract`, `getPipeInputForm` and `getPipeOutputForm`.",
  "//",
  "// Not signed by the codegen lock — its SHA-256 lives in this tree's",
  "// `sources.json` under `derived`, and `npm run codegen:check` compares it.",
  "// ---------------------------------------------------------------------------",
].join("\n");

/**
 * Render one method's `contracts.ts`, byte for byte.
 *
 * Lives here rather than in the writer because all three scripts must agree on
 * these bytes: `generate.mts` writes them, `check.mts` hashes them, and
 * `verify.mts` re-renders a live response to compare against the committed file.
 * A formatting difference between any two of them would read as drift on a tree
 * nobody touched.
 *
 * Determinism comes from `JSON.stringify` over the parsed response: key order is
 * the server's own, two-space indent, one trailing newline. `src/generated/` is
 * out of Prettier's reach on purpose, so nothing reformats this afterwards.
 *
 * `INPUT_FORM` and `OUTPUT_FORM` are emitted with an `as` assertion rather than
 * a `:` annotation, and that is a workaround with an expiry, not a design. The
 * payload is written verbatim, and the deployed hosted engine still emits a
 * `name` on a list's `item` — a member the standard's closed shape forbids and
 * `InputFormItem` therefore does not declare, so tsc's excess-property check
 * rejects the annotated literal. The output side inherits it exactly, because an
 * output node IS an input node minus its slot facts and a plural output is a
 * `list` with the same `item`. Fixed upstream in pipelex 0.54.0 (#1155); once
 * the hosted engine carries it, regeneration drops the member and both become
 * `:` annotations again so the compiler guards the emitted shapes.
 */
export function renderContracts(
  pipeIoContracts: PipeIOContracts,
  inputForm: InputForm,
  outputForm: OutputForm,
): string {
  return [
    CONTRACTS_HEADER,
    "",
    'import type { InputForm, OutputForm, PipeIOContracts } from "@pipelex/mthds-form";',
    "",
    `export const PIPE_IO_CONTRACTS: PipeIOContracts = ${JSON.stringify(pipeIoContracts, null, 2)};`,
    "",
    `export const INPUT_FORM = ${JSON.stringify(inputForm, null, 2)} as InputForm;`,
    "",
    `export const OUTPUT_FORM = ${JSON.stringify(outputForm, null, 2)} as OutputForm;`,
    "",
  ].join("\n");
}

/** A parsed JSON value, when it is a plain object. */
function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * `readTextFile`, with an absent file as `null` rather than a throw.
 *
 * ENOENT only — every other failure, the fatal-UTF-8 refusal included, still
 * throws. Symlink safety is `discoverMethods`'s: it walks each method directory
 * before any of this runs, and `walk` refuses a symlink or special file
 * anywhere under it.
 */
async function readTextFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readTextFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
    throw error;
  }
}

export const DESIGN_HEADER = [
  "// ---------------------------------------------------------------------------",
  "// AUTOGENERATED by `npm run codegen` — DO NOT EDIT.",
  "//",
  "// The page a model designed for this method: the layout exactly as the",
  "// designer method emitted it, plus the provenance recorded beside it in",
  "// `methods/<name>/design.json`. `null` when no design has been produced —",
  "// `npm run design` is what produces one, and the form then renders it instead",
  "// of the kernel's plain form.",
  "//",
  "// A layout names a PATH and nothing more. It never restates what a field is,",
  "// so it cannot go out of date about a fact it never stated; the two questions",
  "// worth asking of one — is it written in this kernel's vocabulary, does it",
  "// still fit this method — are asked offline by `npm run design:check` and",
  "// again at runtime by `acceptDesign`.",
  "//",
  "// Not signed by the codegen lock — its SHA-256 lives in this tree's",
  "// `sources.json` under `derived`, and `npm run codegen:check` compares it.",
  "// ---------------------------------------------------------------------------",
].join("\n");

/**
 * Render one method's `design.ts`, byte for byte.
 *
 * Lives here for `renderContracts`'s reason: `generate.mts` writes these bytes
 * as part of a regeneration, `check.mts` hashes them, and `design.mts` writes
 * them again the moment a design is produced. A formatting difference between
 * any two of them would read as drift on a tree nobody touched.
 *
 * The object is assembled field by field rather than restringified from the
 * record on disk, so the key order is this function's and not the file's — and
 * so the two facts the record carries for the CHECK's benefit (the source
 * hashes, the layout's own hash) stay out of the app's bundle.
 */
export function renderDesignModule(design: MethodDesign | null): string {
  const body =
    design === null
      ? "null"
      : JSON.stringify(
          {
            pipeRef: design.pipeRef,
            producer: design.producer,
            model: design.model,
            ...(design.seed === undefined ? {} : { seed: design.seed }),
            promptHash: design.promptHash,
            date: design.date,
            jsonl: design.jsonl,
          },
          null,
          2,
        );
  return [
    DESIGN_HEADER,
    "",
    'import type { MethodDesign } from "@/lib/design";',
    "",
    `export const DESIGN: MethodDesign | null = ${body};`,
    "",
  ].join("\n");
}

/** A `design.json` / `design.jsonl` pair that is not what it claims to be. */
export class DesignFileError extends Error {
  readonly filePath: string;

  constructor(filePath: string, detail: string) {
    super(`${filePath} ${detail}`);
    this.name = "DesignFileError";
    this.filePath = filePath;
  }
}

/** What `readMethodDesign` found on disk: the record, the layout, and where each came from. */
export interface MethodDesignFiles {
  record: DesignRecord;
  jsonl: string;
  /** Repo-relative, for a message a reader can act on. */
  recordPath: string;
  jsonlPath: string;
}

function requireString(fields: Record<string, unknown>, key: string, file: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DesignFileError(file, `has no string "${key}".`);
  }
  return value;
}

const PRODUCERS = new Set(["pipelex-method", "claude-code-subagent", "claude-code-session"]);

/**
 * Read `methods/<name>/design.{json,jsonl}`, or `null` when neither is there.
 *
 * A method with no design is the ordinary state, not a failure — but HALF a
 * design is a failure, and a loud one: a record with no layout renders nothing,
 * and a layout with no record has no prompt hash to judge it by, so neither can
 * be treated as "no design" without hiding a half-finished production.
 *
 * The record's two hashes are read but not judged here. Whether they still
 * describe the method and the layout is `runDesignCheck`'s question, and asking
 * it in the reader would make `npm run codegen` refuse to project a design that
 * a `npm run design` re-run is about to fix.
 */
export async function readMethodDesign(
  name: string,
  methodsDir = METHODS_DIR,
): Promise<MethodDesignFiles | null> {
  const dir = path.join(methodsDir, name);
  const recordPath = `methods/${name}/${DESIGN_RECORD_FILENAME}`;
  const jsonlPath = `methods/${name}/${DESIGN_JSONL_FILENAME}`;

  const recordText = await readTextFileIfPresent(path.join(dir, DESIGN_RECORD_FILENAME));
  const jsonlText = await readTextFileIfPresent(path.join(dir, DESIGN_JSONL_FILENAME));

  if (recordText === null && jsonlText === null) return null;
  if (recordText === null) {
    throw new DesignFileError(jsonlPath, `has no ${DESIGN_RECORD_FILENAME} beside it.`);
  }
  if (jsonlText === null) {
    throw new DesignFileError(recordPath, `has no ${DESIGN_JSONL_FILENAME} beside it.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(recordText);
  } catch (error) {
    throw new DesignFileError(
      recordPath,
      `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const fields = asJsonObject(parsed);
  if (!fields) throw new DesignFileError(recordPath, "is not a JSON object.");

  const producer = requireString(fields, "producer", recordPath);
  if (!PRODUCERS.has(producer)) {
    throw new DesignFileError(
      recordPath,
      `names an unknown producer '${producer}' — expected one of ${[...PRODUCERS].join(", ")}.`,
    );
  }
  const sources = asJsonObject(fields.sources);
  if (!sources) throw new DesignFileError(recordPath, 'has no "sources" map.');
  for (const [key, value] of Object.entries(sources)) {
    if (typeof value !== "string") {
      throw new DesignFileError(recordPath, `records a non-string hash for source '${key}'.`);
    }
  }
  const seed = fields.seed;
  if (seed !== undefined && typeof seed !== "string") {
    throw new DesignFileError(recordPath, 'has a non-string "seed".');
  }

  const record: DesignRecord = {
    pipeRef: requireString(fields, "pipeRef", recordPath),
    producer: producer as DesignRecord["producer"],
    model: requireString(fields, "model", recordPath),
    ...(seed === undefined ? {} : { seed }),
    promptHash: requireString(fields, "promptHash", recordPath),
    date: requireString(fields, "date", recordPath),
    sources: sources as Record<string, string>,
    jsonlSha256: requireString(fields, "jsonlSha256", recordPath),
  };

  return { record, jsonl: jsonlText, recordPath, jsonlPath };
}

/**
 * Re-record one derived artifact's hash in a tree's `sources.json`, in place.
 *
 * `npm run design` writes a `design.ts` without a codegen response to hand
 * `writeTree`, and a sidecar left naming the old bytes is exactly the
 * `hand-edited` verdict the check exists to raise. So the two writers agree
 * here instead: same map, same hash function, same formatting.
 *
 * It refuses a tree with no sidecar rather than inventing one — a sidecar is
 * written by a regeneration, and a design produced against a tree that has
 * never been generated has nothing to be current with respect to.
 */
export async function recordDerivedArtifact(
  outDir: string,
  filename: string,
  content: string,
): Promise<void> {
  const sidecarPath = path.join(outDir, SOURCES_SIDECAR);
  const text = await readTextFile(sidecarPath);
  const parsed = asJsonObject(JSON.parse(text));
  if (!parsed) throw new Error(`${describePath(sidecarPath)} is not a JSON object.`);
  const sidecar: SourcesSidecar = {
    comment: typeof parsed.comment === "string" ? parsed.comment : SIDECAR_COMMENT,
    sources: (asJsonObject(parsed.sources) ?? {}) as Record<string, string>,
    derived: (asJsonObject(parsed.derived) ?? {}) as Record<string, string>,
  };
  sidecar.derived[filename] = hashSource(content);
  await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf-8");
}

/** The record and the layout, as the app-facing shape the projection carries. */
export function designOf(files: MethodDesignFiles): MethodDesign {
  const { record, jsonl } = files;
  return {
    pipeRef: record.pipeRef,
    producer: record.producer,
    model: record.model,
    ...(record.seed === undefined ? {} : { seed: record.seed }),
    promptHash: record.promptHash,
    date: record.date,
    jsonl,
  };
}

/**
 * One method the codegen scripts work on, in either of the two shapes a method
 * can reach this repo in.
 *
 * The `name` and `sourceHashes` halves are common on purpose: every gate the
 * three scripts run — the tree's directory name, the orphan scan, the staleness
 * sidecar — is written against those two fields and stays kind-blind. Only the
 * two API calls branch, and they branch on `kind`.
 */
export type MethodSource = {
  /** Directory name under `methods/`, reused as the generated tree's directory name. */
  name: string;
  /** Repo-relative path → SHA-256 of the file's bytes, for the sidecar. */
  sourceHashes: Record<string, string>;
} & (
  | {
      /** The closure lives here: `.mthds` files under `methods/<name>/`. */
      kind: "files";
      /** Every `.mthds` file in the closure, sorted, with repo-relative `source` labels. */
      files: MthdsFileItem[];
    }
  | {
      /** The closure lives elsewhere; `methods/<name>/method.json` names it. */
      kind: "selector";
      /** Exactly what the SDK's selector-taking routes accept, carried unchanged. */
      selector: ValidateMethodSelector;
    }
);

/**
 * Thrown when `method.json` is not a manifest this repo can act on. A refusal,
 * never a drift verdict: nothing can be regenerated from a selector that cannot
 * be read, so there is no remedy to print beyond the message.
 */
export class ManifestError extends Error {
  readonly filePath: string;

  constructor(filePath: string, detail: string) {
    super(`${filePath} ${detail}`);
    this.name = "ManifestError";
    this.filePath = filePath;
  }
}

/**
 * Parse a `method.json` body into the SDK's own selector type.
 *
 * The manifest is deliberately the narrowest possible file: one object, exactly
 * one of `method_ref` / `method_id`, a non-empty string. Every other shape is
 * refused by name rather than tolerated, because each tolerance is a way to
 * generate a tree from a selector nobody meant — an ignored unknown key is a
 * typo'd `method_ref` silently becoming a manifest with no selector at all, and
 * both keys at once is two sources of truth in the file whose whole job is to be
 * the one source of truth.
 *
 * Takes the text rather than the path so the parse is pure and testable; the
 * `label` is only ever used to build the message.
 */
export function parseManifest(text: string, label: string): ValidateMethodSelector {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(label, `is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ManifestError(label, "must be a JSON object.");
  }

  const fields = parsed as Record<string, unknown>;
  const unknown = Object.keys(fields).filter(
    (key) => !(SELECTOR_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new ManifestError(
      label,
      `has unknown key(s) ${unknown.join(", ")} — a manifest holds exactly one of ` +
        `${SELECTOR_KEYS.join(" or ")}.`,
    );
  }

  const present = SELECTOR_KEYS.filter((key) => key in fields);
  if (present.length === 0) {
    throw new ManifestError(label, `names no method — set ${SELECTOR_KEYS.join(" or ")}.`);
  }
  if (present.length > 1) {
    throw new ManifestError(
      label,
      `sets both ${SELECTOR_KEYS.join(" and ")} — a manifest names exactly one method.`,
    );
  }

  const key = present[0]!;
  const value = fields[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ManifestError(label, `has a ${key} that is not a non-empty string.`);
  }
  return key === "method_ref" ? { method_ref: value } : { method_id: value };
}

/** The two manifest keys, in the order every message lists them. */
const SELECTOR_KEYS = ["method_ref", "method_id"] as const;

/** Which selector a manifest carries, for a message that has to name the kind. */
export function selectorKind(selector: ValidateMethodSelector): "method_ref" | "method_id" {
  return "method_ref" in selector && selector.method_ref !== undefined ? "method_ref" : "method_id";
}

/** How a selector reads in a console line — the kind and the value it names. */
export function describeSelector(selector: ValidateMethodSelector): string {
  const kind = selectorKind(selector);
  return `${kind} ${kind === "method_ref" ? selector.method_ref : selector.method_id}`;
}

/**
 * Thrown when a file that must be UTF-8 text is not. The caller maps it by
 * ownership: in a generated tree it is drift (regenerating rewrites the file),
 * in a `.mthds` source it is a refusal (regenerating would ship garbage).
 */
export class NonUtf8FileError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(`${filePath} is not valid UTF-8.`);
    this.name = "NonUtf8FileError";
    this.filePath = filePath;
  }
}

/**
 * Thrown on any directory entry that is not a regular file or a directory
 * (symlink, FIFO, socket, …) under a codegen-governed tree. Refusal produces
 * no verdict — following a symlink would silently defeat the staleness gate.
 */
export class SymlinkRefusedError extends Error {
  readonly filePath: string;

  constructor(filePath: string, kind: string) {
    super(
      `refusing ${kind} at ${filePath} — only regular files and directories are allowed ` +
        `under methods/ and src/generated/.`,
    );
    this.name = "SymlinkRefusedError";
    this.filePath = filePath;
  }
}

/** Repo-relative when the path is inside the repo, absolute otherwise (e.g. test fixtures). */
function describePath(absPath: string): string {
  const relative = path.relative(REPO_ROOT, absPath);
  return relative && !relative.startsWith("..") ? relative : absPath;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/**
 * Read a file as UTF-8 text, fatally: invalid bytes throw `NonUtf8FileError`
 * instead of decoding to U+FFFD. `readFile(p, "utf-8")` never throws on bad
 * bytes, and a lossy decode is exactly how a corrupted artifact still hashes
 * to its locked value and reports `current`.
 */
export async function readTextFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new NonUtf8FileError(describePath(filePath));
  }
}

/**
 * Refuse a directory that is itself a symlink. `lstat` only inspects the final
 * path component, so this guards exactly the case the per-entry checks cannot:
 * a symlinked root (`methods/`, `src/generated/`, or a tree directory) would
 * otherwise be followed transparently, letting the scripts certify — or
 * regeneration rewrite — external content. An absent path passes: ENOENT is
 * the caller's story (no-tree, empty scan, or the readdir error).
 */
export async function refuseSymlinkRoot(dirPath: string): Promise<void> {
  let rootStat;
  try {
    rootStat = await lstat(dirPath);
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }
  if (rootStat.isSymbolicLink()) {
    throw new SymlinkRefusedError(describePath(dirPath), "a symlink");
  }
}

/**
 * Recursively collect file paths under `dir`, relative to it, sorted for
 * determinism. Enforces the entry policy above: the root is `lstat`ed once
 * (recursive calls descend only vetted dirents), and every entry that is not
 * a regular file or a directory throws `SymlinkRefusedError`.
 */
export async function walk(dir: string, prefix = ""): Promise<string[]> {
  if (prefix === "") {
    await refuseSymlinkRoot(dir);
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    // Forward slashes: these become artifact paths and sidecar keys, on every platform.
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...(await walk(path.join(dir, entry.name), relative)));
    } else if (entry.isFile()) {
      found.push(relative);
    } else {
      throw new SymlinkRefusedError(
        describePath(path.join(dir, entry.name)),
        entry.isSymbolicLink() ? "a symlink" : "a special file",
      );
    }
  }
  return found.sort();
}

/**
 * Hash one text file for the sidecar, over line-ending-normalized text. Used for
 * both halves of it: the `.mthds` sources and the starter-emitted artifacts.
 *
 * The normalization is the one `runCodegenCheck` already applies to artifacts
 * and to the lock, and it is here for the same reason. `.gitattributes` pins
 * only `src/generated/**`, so a Windows checkout under `core.autocrlf=true`
 * gets CRLF `.mthds` files; hashing those verbatim reports every bundle
 * `stale-source` on a tree nobody touched — and the remedy the check prints,
 * `npm run codegen`, needs the API key and the network this check is defined
 * not to need. The crate fingerprint is line-ending-invariant anyway (the
 * engine parses TOML, which folds CRLF inside multi-line strings), so raw
 * bytes were never the question the sidecar meant to ask.
 */
export function hashSource(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Discover every method directory under `methods/`, in either source kind.
 *
 * A directory holding `.mthds` files is a `files` source; one holding a
 * `method.json` is a `selector` source; one holding both is refused naming the
 * two, because a tree generated from one while the other sits beside it is a
 * tree whose staleness gate answers the wrong question. A directory holding
 * neither is skipped, as it always was.
 */
export async function discoverMethods(methodsDir = METHODS_DIR): Promise<MethodSource[]> {
  await refuseSymlinkRoot(methodsDir);
  const entries = await readdir(methodsDir, { withFileTypes: true });
  const dirs: Dirent[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      dirs.push(entry);
    } else if (!entry.isFile()) {
      // A symlinked method directory silently dropping out of the closure is
      // exactly the wrong-verdict class this policy exists for.
      throw new SymlinkRefusedError(
        describePath(path.join(methodsDir, entry.name)),
        entry.isSymbolicLink() ? "a symlink" : "a special file",
      );
    }
    // A plain file at the methods/ root (.DS_Store, a stray README) is not a method.
  }

  const methods: MethodSource[] = [];
  for (const entry of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const methodDir = path.join(methodsDir, entry.name);
    const treePaths = await walk(methodDir);
    const bundlePaths = treePaths.filter((p) => p.endsWith(".mthds"));
    // Only at the directory root: a `method.json` nested deeper is a stray file,
    // the same as any other non-bundle file a method directory happens to carry.
    const hasManifest = treePaths.includes(MANIFEST_FILENAME);

    if (hasManifest && bundlePaths.length > 0) {
      throw new ManifestError(
        `methods/${entry.name}/${MANIFEST_FILENAME}`,
        `sits beside ${bundlePaths.length} .mthds file(s) (${bundlePaths.join(", ")}) — a method ` +
          `is generated from its own bundles or from the method the manifest names, never both.`,
      );
    }

    if (hasManifest) {
      const manifestPath = `methods/${entry.name}/${MANIFEST_FILENAME}`;
      const content = await readTextFile(path.join(methodDir, MANIFEST_FILENAME));
      methods.push({
        name: entry.name,
        kind: "selector",
        selector: parseManifest(content, manifestPath),
        sourceHashes: { [manifestPath]: hashSource(content) },
      });
      continue;
    }

    if (bundlePaths.length === 0) continue;

    const files: MthdsFileItem[] = [];
    const sourceHashes: Record<string, string> = {};
    for (const relative of bundlePaths) {
      const content = await readTextFile(path.join(methodDir, relative));
      // `source` is the repo-relative path, so a validation error points at a real file.
      const source = `methods/${entry.name}/${relative}`;
      files.push({ content, source });
      sourceHashes[source] = hashSource(content);
    }
    methods.push({ name: entry.name, kind: "files", files, sourceHashes });
  }
  return methods;
}

/** What `readGeneratedTree` found on disk — the three cases the callers report differently. */
export type GeneratedTree =
  | { status: "ok"; lockContent: string; files: CodegenTreeFile[]; treePaths: string[] }
  | { status: "no-tree" }
  | { status: "no-lock"; treePaths: string[] };

/**
 * Read one generated tree: its lock, plus every file the check considers.
 *
 * Two of the SDK's caller obligations are discharged here, and both fail as a
 * *wrong verdict* rather than an error if you get them wrong. The walk is
 * recursive from the lock's directory with paths relative to it, because an
 * incomplete list reports a present file as `missing` and hides a stray
 * entirely. And the text is passed exactly as read — reformatting or
 * re-encoding an artifact reports it `hand-edited`.
 *
 * Only ENOENT maps to `no-tree` / `no-lock`. Any other failure — a refused
 * symlink, a non-UTF-8 file, a permissions error — propagates, because "this
 * tree could not be read" is not the same verdict as "this tree is absent":
 * the absent tree's remedy is to regenerate, and the unreadable tree has no
 * verdict at all.
 *
 * Filtering with the SDK's own `isStampableArtifactPath` is what lets the
 * starter-owned `sources.json` sit beside the lock without being called an orphan.
 */
export async function readGeneratedTree(outDir: string): Promise<GeneratedTree> {
  let treePaths: string[];
  try {
    treePaths = await walk(outDir);
  } catch (error) {
    if (isEnoent(error)) return { status: "no-tree" };
    throw error;
  }

  let lockContent: string;
  try {
    lockContent = await readTextFile(path.join(outDir, LOCK_FILENAME));
  } catch (error) {
    if (isEnoent(error)) return { status: "no-lock", treePaths };
    throw error;
  }

  const files: CodegenTreeFile[] = [];
  for (const relative of treePaths) {
    if (!isStampableArtifactPath(relative)) continue;
    files.push({ path: relative, content: await readTextFile(path.join(outDir, relative)) });
  }
  return { status: "ok", lockContent, files, treePaths };
}

/**
 * Compare the sidecar against reality — the sources it was generated from, and
 * the starter-emitted artifacts it stamps.
 *
 * Two questions the codegen lock cannot answer, asked in one pass because they
 * read one file:
 *
 *  - **`sources`** — does everything the tree was generated from still hash to
 *    what it hashed then — the `.mthds` bundles of a files method, the
 *    `method.json` of a selector one? This is what catches "edited a bundle (or
 *    bumped a tag), forgot to regenerate".
 *  - **`derived`** — is every artifact this repo emits itself (`DERIVED_ARTIFACTS`)
 *    present and unmodified? The lock signs only what the codegen route returned,
 *    so without this a hand-edited or deleted `contracts.ts` passes `make check`
 *    while the form it feeds renders from something nobody generated.
 *
 * Returns one line per problem; an empty array means the tree is current on both
 * counts. A missing or unreadable sidecar is reported once, as stale rather than
 * as a no-verdict: it is starter-owned, and regenerating both restores it and
 * re-proves the tree.
 */
export async function compareSidecar(
  outDir: string,
  currentSources: Record<string, string>,
): Promise<string[]> {
  let sidecar: { sources: Record<string, string>; derived: Record<string, string> };
  try {
    const raw = await readTextFile(path.join(outDir, SOURCES_SIDECAR));
    const parsed: unknown = JSON.parse(raw);
    const asRecord = (value: unknown): Record<string, string> | undefined =>
      typeof value === "object" && value !== null ? (value as Record<string, string>) : undefined;
    const fields = (typeof parsed === "object" && parsed !== null ? parsed : {}) as {
      sources?: unknown;
      derived?: unknown;
    };
    const sources = asRecord(fields.sources);
    const derived = asRecord(fields.derived);
    if (!sources) return [`stale-source: ${SOURCES_SIDECAR} — no "sources" map in the sidecar`];
    if (!derived) return [`derived: ${SOURCES_SIDECAR} — no "derived" map in the sidecar`];
    sidecar = { sources, derived };
  } catch {
    return [
      `stale-source: ${SOURCES_SIDECAR} — missing or unreadable, so staleness cannot be ruled out`,
    ];
  }

  const problems: string[] = [];

  for (const [source, hash] of Object.entries(currentSources)) {
    if (!(source in sidecar.sources)) {
      problems.push(`stale-source: ${source} — a new source the generated types do not cover`);
    } else if (sidecar.sources[source] !== hash) {
      problems.push(`stale-source: ${source} — edited since the types were generated`);
    }
  }
  for (const source of Object.keys(sidecar.sources)) {
    if (!(source in currentSources)) {
      problems.push(`stale-source: ${source} — recorded as a source but no longer on disk`);
    }
  }

  // The expected set is the constant, not the sidecar's own keys: a sidecar that
  // never recorded an artifact is exactly the stale tree this check exists for,
  // and reading the expectation off the file being checked would certify it.
  for (const name of DERIVED_ARTIFACTS) {
    const recorded = sidecar.derived[name];
    let actual: string | null;
    try {
      actual = hashSource(await readTextFile(path.join(outDir, name)));
    } catch {
      actual = null;
    }
    if (recorded === undefined) {
      problems.push(`derived: ${name} — not recorded in ${SOURCES_SIDECAR}`);
    } else if (actual === null) {
      problems.push(`derived: ${name} — recorded in ${SOURCES_SIDECAR} but missing from the tree`);
    } else if (actual !== recorded) {
      problems.push(`derived: ${name} — hand-edited since it was generated`);
    }
  }
  for (const name of Object.keys(sidecar.derived)) {
    if (!DERIVED_ARTIFACTS.includes(name)) {
      problems.push(`derived: ${name} — recorded in ${SOURCES_SIDECAR} but no longer generated`);
    }
  }

  return problems.sort();
}

/** What `findOrphanTrees` reports — the two verdicts carry different remedies. */
export interface OrphanScan {
  /** Tree directories with no method behind them at all — the delete remedy. */
  orphans: string[];
  /** Tree directories that case-fold onto a method name but differ byte-wise — the rename remedy. */
  caseMismatches: { actual: string; expected: string }[];
}

/**
 * Generated trees with no matching directory under `methods/` — regeneration never removes these.
 *
 * A tree is a *directory*, so this enumerates directory entries rather than
 * walking files and reading their first path segment. Walking got both verdicts
 * wrong in opposite directions: a plain file at the root of `src/generated/`
 * (`.DS_Store`, which Finder writes into any folder you browse) contributed its
 * own filename as a tree name and failed the check with a remedy naming a
 * directory that does not exist, while an *empty* orphan directory contributed
 * no files at all and was never reported. A non-recursive read answers the
 * question the function actually asks, and it is the whole tree cheaper.
 *
 * The case-fold comparison exists for case-insensitive filesystems (macOS's
 * default): there, `readGeneratedTree` happily opens a tree whose on-disk name
 * differs from the method's in case only, certifies it current — and a
 * byte-wise orphan scan would then print a delete remedy for the very tree it
 * just certified. That is a rename, never a delete.
 */
export async function findOrphanTrees(
  generatedRoot: string,
  expected: Set<string>,
): Promise<OrphanScan> {
  await refuseSymlinkRoot(generatedRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(generatedRoot, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) return { orphans: [], caseMismatches: [] };
    throw error;
  }

  const byFold = new Map<string, string>();
  for (const name of expected) byFold.set(name.toLowerCase(), name);

  const orphans: string[] = [];
  const caseMismatches: { actual: string; expected: string }[] = [];
  for (const entry of entries) {
    if (entry.isFile()) continue; // a stray root file (.DS_Store) is not a tree
    if (!entry.isDirectory()) {
      throw new SymlinkRefusedError(
        describePath(path.join(generatedRoot, entry.name)),
        entry.isSymbolicLink() ? "a symlink" : "a special file",
      );
    }
    if (expected.has(entry.name)) continue;
    const match = byFold.get(entry.name.toLowerCase());
    if (match !== undefined) {
      caseMismatches.push({ actual: entry.name, expected: match });
    } else {
      orphans.push(entry.name);
    }
  }
  orphans.sort();
  caseMismatches.sort((a, b) => a.actual.localeCompare(b.actual));
  return { orphans, caseMismatches };
}

/**
 * Refuse a plaintext-`http:` base URL anywhere but loopback.
 *
 * The keyed scripts send `PIPELEX_API_KEY` as a bearer token and write
 * server-supplied TypeScript into the repo, so a non-local plaintext base URL
 * exposes both to the network. `https:` is allowed anywhere; `http:` only for
 * `localhost`, `*.localhost`, `127.0.0.1`, and `[::1]`.
 */
export function assertSecureBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`PIPELEX_BASE_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]"
    ) {
      return;
    }
    throw new Error(
      `PIPELEX_BASE_URL uses plaintext http: for a non-local host (${url}). The codegen scripts ` +
        `send the API key as a bearer token and write server-supplied TypeScript into the repo, ` +
        `so anything beyond localhost/127.0.0.1/[::1] must be https:.`,
    );
  }
  throw new Error(`PIPELEX_BASE_URL must be an http(s) URL: ${url}`);
}

/**
 * Does `relativePath` name a file that stays inside `outDir`?
 *
 * The codegen response names each artifact's own path, and `path.join` resolves
 * a `..` in one without complaint — so a single bad path turns a regeneration
 * into a write anywhere the process can reach (`.husky/pre-commit`, say), in a
 * place no stamp guards and the offline check never looks. `assertSecureBaseUrl`
 * closes the transport half of that exposure; this closes the response half.
 * An absolute path is refused for the same reason, and so is one that resolves
 * to the directory itself rather than to a file within it.
 */
export function isContainedPath(outDir: string, relativePath: string): boolean {
  if (path.isAbsolute(relativePath)) return false;
  const root = path.resolve(outDir);
  // The trailing separator matters: without it a sibling `…/tree-backup/` would
  // pass the prefix test against `…/tree`.
  return path.resolve(root, relativePath).startsWith(`${root}${path.sep}`);
}
