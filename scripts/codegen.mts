/**
 * Regenerate the committed typed artifacts for every method in `methods/`.
 *
 * One generated tree per method, mirroring `methods/` one-to-one: each method is
 * its own closure, so each gets its own crate, artifact set, and lock. The tree
 * is written **verbatim** — every `artifacts[]` entry at its `path`, the `lock`
 * as `lock_filename` — because that byte-for-byte fidelity is what makes the
 * tree identical to a local `pipelex codegen types` run, and therefore what lets
 * the offline check (`npm run codegen:check`) pass on it. Reformatting an
 * artifact or re-serializing the lock breaks that trust chain.
 *
 * This is the dev action: it needs an API key and a base URL that serves
 * `/v1/codegen`. The check that guards CI is offline and needs neither.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// `@next/env` is CommonJS, so a native-ESM script must take the default export
// and destructure. (`playwright.config.ts` gets away with a named import only
// because Playwright transpiles its config to CJS first.)
import nextEnv from "@next/env";
import {
  ApiResponseError,
  isStampableArtifactPath,
  PipelexApiClient,
  runCodegenCheck,
  type CodegenValidReport,
  type GeneratedArtifact,
} from "@pipelex/sdk";

import {
  discoverMethods,
  GENERATED_ROOT,
  METHODS_DIR,
  REPO_ROOT,
  SIDECAR_COMMENT,
  SOURCES_SIDECAR,
  type SourcesSidecar,
  walk,
} from "./codegenShared.mts";

const { loadEnvConfig } = nextEnv;

/**
 * Write `content` at `filePath` only if the bytes differ.
 *
 * Mirrors pipelex's own `write_stamped_projection` discipline: no mtime churn,
 * clean diffs, and a regeneration over an already-current tree is a true no-op.
 */
async function writeIfChanged(filePath: string, content: string): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    existing = null;
  }
  if (existing === content) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return true;
}

/**
 * Write one method's artifact set, its lock, and its sources sidecar.
 *
 * Stale stamped files that dropped out of the artifact set are removed — but
 * ONLY files the check considers stampable, so the starter-owned sidecar sitting
 * in the same directory is never touched.
 */
async function writeTree(
  outDir: string,
  report: CodegenValidReport,
  sourceHashes: Record<string, string>,
): Promise<string[]> {
  const changed: string[] = [];

  for (const artifact of [
    ...report.artifacts,
    { path: report.lock_filename, content: report.lock },
  ]) {
    if (await writeIfChanged(path.join(outDir, artifact.path), artifact.content)) {
      changed.push(artifact.path);
    }
  }

  const kept = new Set([...report.artifacts.map((a) => a.path), report.lock_filename]);
  let existingPaths: string[] = [];
  try {
    existingPaths = await walk(outDir);
  } catch {
    existingPaths = [];
  }
  for (const relative of existingPaths) {
    if (kept.has(relative) || !isStampableArtifactPath(relative)) continue;
    await rm(path.join(outDir, relative));
    changed.push(`${relative} (removed)`);
  }

  const sidecar: SourcesSidecar = { comment: SIDECAR_COMMENT, sources: sourceHashes };
  const sidecarPath = path.join(outDir, SOURCES_SIDECAR);
  if (await writeIfChanged(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`)) {
    changed.push(SOURCES_SIDECAR);
  }

  return changed;
}

/** Turn a thrown value into an actionable line, naming the fix where we know it. */
function explain(error: unknown, baseUrl: string): string {
  if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
    return [
      `this base URL does not serve POST /v1/codegen (HTTP ${error.status}).`,
      `  Base URL: ${baseUrl}`,
      "  The crate routes are live on https://api-dev.pipelex.com but not yet on",
      "  api.pipelex.com. Point PIPELEX_BASE_URL at api-dev in .env.local.",
    ].join("\n");
  }
  if (error instanceof ApiResponseError) {
    return `HTTP ${error.status} from POST /v1/codegen — ${error.serverMessage ?? error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  loadEnvConfig(REPO_ROOT, false, { info: () => {}, error: console.error });

  const baseUrl = process.env.PIPELEX_BASE_URL ?? "https://api.pipelex.com";
  if (!process.env.PIPELEX_API_KEY) {
    console.error("codegen: PIPELEX_API_KEY is not set — add it to .env.local.");
    process.exit(1);
  }

  const methods = await discoverMethods();
  if (methods.length === 0) {
    console.error(`codegen: no methods found under ${path.relative(REPO_ROOT, METHODS_DIR)}/.`);
    process.exit(1);
  }

  // Constructed bare, not via `@/lib/pipelexClient`: the `@/` alias is a tsconfig
  // path mapping that Node's runtime resolver never reads. The client picks up the
  // same PIPELEX_API_KEY / PIPELEX_BASE_URL natively, so this IS the same client.
  const client = new PipelexApiClient();
  console.log(`codegen: ${methods.length} method(s), via ${baseUrl}`);

  let failed = false;

  for (const method of methods) {
    const outDir = path.join(GENERATED_ROOT, method.name);
    let report: CodegenValidReport;

    try {
      // No `pipe_ref`: `kind: "types"` is concept-set-wide and rejects it with a 422.
      const response = await client.codegen({
        files: method.files,
        kind: "types",
        target: "ts-zod",
      });
      if (!response.is_valid) {
        console.error(`\n✗ ${method.name} — the closure does not resolve:`);
        for (const item of response.validation_errors) {
          console.error(`    ${item.source ?? "?"}: ${item.message}`);
        }
        failed = true;
        continue;
      }
      report = response;
    } catch (error) {
      console.error(`\n✗ ${method.name} — ${explain(error, baseUrl)}`);
      failed = true;
      continue;
    }

    // Self-verify BEFORE writing: `GeneratedArtifact` and `CodegenTreeFile` are
    // structurally identical on purpose, so the response feeds in with no mapping.
    // A tree that fails its own check would fail `make check` after being committed.
    const artifacts: GeneratedArtifact[] = report.artifacts;
    const selfCheck = await runCodegenCheck({ lockContent: report.lock, files: artifacts });
    if (!selfCheck.isCurrent) {
      console.error(`\n✗ ${method.name} — the server's own artifacts fail the offline check:`);
      for (const drift of selfCheck.drifts) {
        console.error(`    ${drift.category}: ${drift.path} — ${drift.detail}`);
      }
      console.error("    Nothing was written. This is an upstream bug — report it.");
      failed = true;
      continue;
    }

    const changed = await writeTree(outDir, report, method.sourceHashes);
    const fingerprint = report.crate_fingerprint.slice(0, 12);
    const where = path.relative(REPO_ROOT, outDir);
    console.log(
      `\n✓ ${method.name} → ${where}/  (crate ${fingerprint}, engine ${report.engine_version})`,
    );
    if (changed.length === 0) {
      console.log("    no changes");
    } else {
      for (const entry of changed) console.log(`    wrote ${entry}`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`codegen: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
