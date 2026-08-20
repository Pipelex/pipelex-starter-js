/**
 * Prove, offline, that the committed trees under `src/generated/` are current.
 *
 * This is the CI half of the codegen trust chain, and it is deliberately the
 * cheap half: no API key, no network, no engine — just hashes. It answers two
 * questions, and it is worth being precise about which is which:
 *
 *  1. **Does each tree still agree with its own lock?** `runCodegenCheck` from
 *     `@pipelex/sdk` owns that verdict (categories `missing` · `modified` ·
 *     `hand-edited` · `orphan`). Its `detail` strings are printed verbatim so
 *     this report reads identically to `pipelex codegen check`.
 *  2. **Do the trees still match the `.mthds` files they were generated from?**
 *     The lock cannot know — it hashes artifacts, not sources — so `codegen.mts`
 *     writes a starter-owned `sources.json` beside each lock and this script
 *     compares it against the bundles on disk.
 *
 * Neither question is "is the tree what the engine would produce today". That one
 * needs the engine, and it is `npm run codegen:verify`.
 *
 * Exit codes follow the codegen spec: 0 current · 1 drift or stale sources ·
 * 2 no verdict could be produced.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { CodegenLockError, runCodegenCheck } from "@pipelex/sdk";

import {
  discoverMethods,
  GENERATED_ROOT,
  LOCK_FILENAME,
  METHODS_DIR,
  readGeneratedTree,
  REPO_ROOT,
  SOURCES_SIDECAR,
} from "./codegenShared.mts";

const EXIT_CURRENT = 0;
const EXIT_DRIFT = 1;
const EXIT_NO_VERDICT = 2;

const REGENERATE = "Run `npm run codegen` to regenerate.";

/**
 * Compare the sidecar's recorded source hashes against the bundles on disk.
 *
 * Returns one line per stale source; an empty array means the generated tree was
 * produced from exactly these bytes. A missing or unreadable sidecar counts as
 * stale rather than as a no-verdict: it is starter-owned, and regenerating both
 * restores it and re-proves the tree.
 */
async function compareSources(outDir: string, current: Record<string, string>): Promise<string[]> {
  let recorded: Record<string, string>;
  try {
    const raw = await readFile(path.join(outDir, SOURCES_SIDECAR), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const sources =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { sources?: unknown }).sources
        : undefined;
    if (typeof sources !== "object" || sources === null) {
      return [`stale-source: ${SOURCES_SIDECAR} — no "sources" map in the sidecar`];
    }
    recorded = sources as Record<string, string>;
  } catch {
    return [
      `stale-source: ${SOURCES_SIDECAR} — missing or unreadable, so staleness cannot be ruled out`,
    ];
  }

  const stale: string[] = [];
  for (const [source, hash] of Object.entries(current)) {
    if (!(source in recorded)) {
      stale.push(`stale-source: ${source} — a new bundle the generated types do not cover`);
    } else if (recorded[source] !== hash) {
      stale.push(`stale-source: ${source} — edited since the types were generated`);
    }
  }
  for (const source of Object.keys(recorded)) {
    if (!(source in current)) {
      stale.push(`stale-source: ${source} — recorded as a source but no longer on disk`);
    }
  }
  return stale.sort();
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
 */
async function findOrphanTrees(expected: Set<string>): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(GENERATED_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !expected.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function main(): Promise<void> {
  const methods = await discoverMethods();
  if (methods.length === 0) {
    console.error(
      `codegen:check: no methods found under ${path.relative(REPO_ROOT, METHODS_DIR)}/ — nothing to check.`,
    );
    process.exit(EXIT_NO_VERDICT);
  }

  let worst = EXIT_CURRENT;
  const record = (code: number): void => {
    worst = Math.max(worst, code);
  };

  console.log(`codegen:check: ${methods.length} method(s), offline`);

  for (const method of methods) {
    const outDir = path.join(GENERATED_ROOT, method.name);
    const where = path.relative(REPO_ROOT, outDir);

    const tree = await readGeneratedTree(outDir);
    if (tree.status === "no-tree") {
      console.error(`\n✗ ${method.name} — no generated tree at ${where}/`);
      console.error(`    ${REGENERATE}`);
      record(EXIT_DRIFT);
      continue;
    }
    if (tree.status === "no-lock") {
      console.error(
        `\n✗ ${method.name} — no ${LOCK_FILENAME} in ${where}/, so there is no verdict.`,
      );
      console.error(`    Found: ${tree.treePaths.join(", ") || "(empty directory)"}`);
      console.error(`    ${REGENERATE}`);
      record(EXIT_NO_VERDICT);
      continue;
    }
    const { lockContent, files } = tree;

    let drifts: { category: string; path: string; detail: string }[];
    let fingerprint: string;
    let engineVersion: string;
    try {
      const report = await runCodegenCheck({ lockContent, files });
      drifts = report.drifts;
      fingerprint = report.crateFingerprint;
      engineVersion = report.engineVersion;
    } catch (error) {
      if (error instanceof CodegenLockError) {
        // A no-verdict condition, not a drift: the message already names the fix
        // (an unknown `lock_version` says which side to upgrade), so print it as-is.
        console.error(`\n✗ ${method.name} — ${error.message}`);
        record(EXIT_NO_VERDICT);
        continue;
      }
      throw error;
    }

    const stale = await compareSources(outDir, method.sourceHashes);

    if (drifts.length === 0 && stale.length === 0) {
      console.log(
        `\n✓ ${method.name} — ${files.length} artifact(s) current  (crate ${fingerprint.slice(0, 12)}, engine ${engineVersion})`,
      );
      continue;
    }

    console.error(`\n✗ ${method.name} — ${where}/`);
    for (const drift of drifts) {
      console.error(`    ${drift.category}: ${drift.path} — ${drift.detail}`);
    }
    for (const line of stale) console.error(`    ${line}`);
    console.error(`    ${REGENERATE}`);
    record(EXIT_DRIFT);
  }

  const orphans = await findOrphanTrees(new Set(methods.map((m) => m.name)));
  for (const name of orphans) {
    console.error(`\n✗ ${name} — a generated tree with no methods/${name}/ behind it.`);
    console.error(
      `    Regeneration never removes a whole tree: delete src/generated/${name}/ or restore the method.`,
    );
    record(EXIT_DRIFT);
  }

  process.exit(worst);
}

main().catch((error: unknown) => {
  console.error(`codegen:check: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(EXIT_NO_VERDICT);
});
