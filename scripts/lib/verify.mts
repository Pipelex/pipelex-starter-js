/**
 * Ask the engine whether the committed trees are still semantically right.
 *
 * `npm run codegen:check` proves a tree agrees with its own lock, which is a
 * question about bytes and needs nothing but hashes. It deliberately cannot
 * answer the other question — whether the crate those artifacts project is still
 * what the `.mthds` closure resolves to today — because that needs the engine.
 * This module closes that gap the way the SDK documents: re-run `codegen()` live
 * and compare its `crate_fingerprint` against the committed lock's.
 *
 * It writes nothing. A mismatch means `npm run codegen` has real work to do; the
 * fix is a deliberate regeneration commit, not a silent rewrite from a checker.
 *
 * Keyed and online, so it stays out of `make all` — same reason `test-e2e` does.
 */
import path from "node:path";
import process from "node:process";

// `@next/env` is CommonJS — see the same note in `generate.mts`.
import nextEnv from "@next/env";
import {
  ApiResponseError,
  CodegenLockError,
  DEFAULT_API_BASE_URL,
  PipelexApiClient,
  runCodegenCheck,
} from "@pipelex/sdk";

import {
  assertSecureBaseUrl,
  discoverMethods,
  refuseSymlinkRoot,
  GENERATED_ROOT,
  LOCK_FILENAME,
  METHODS_DIR,
  readGeneratedTree,
  REPO_ROOT,
} from "./shared.mts";

const { loadEnvConfig } = nextEnv;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;

async function runVerifyInner(): Promise<number> {
  loadEnvConfig(REPO_ROOT, false, { info: () => {}, error: console.error });

  const baseUrl = process.env.PIPELEX_BASE_URL ?? DEFAULT_API_BASE_URL;
  try {
    assertSecureBaseUrl(baseUrl);
  } catch (error) {
    console.error(`codegen:verify: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
  if (!process.env.PIPELEX_API_KEY) {
    console.error("codegen:verify: PIPELEX_API_KEY is not set — add it to .env.local.");
    return EXIT_FAILED;
  }

  const methods = await discoverMethods();
  if (methods.length === 0) {
    console.error(
      `codegen:verify: no methods found under ${path.relative(REPO_ROOT, METHODS_DIR)}/.`,
    );
    return EXIT_FAILED;
  }

  // A symlinked src/generated/ root would route reads — and for the writer,
  // writes and deletes — into an external target. Same refusal as the check's.
  await refuseSymlinkRoot(GENERATED_ROOT);

  const client = new PipelexApiClient();
  console.log(`codegen:verify: ${methods.length} method(s), against ${baseUrl}`);

  let failed = false;

  for (const method of methods) {
    const outDir = path.join(GENERATED_ROOT, method.name);
    const where = path.relative(REPO_ROOT, outDir);

    const tree = await readGeneratedTree(outDir);
    if (tree.status !== "ok") {
      const what = tree.status === "no-tree" ? "no generated tree" : `no ${LOCK_FILENAME}`;
      console.error(`\n✗ ${method.name} — ${what} at ${where}/. Run \`npm run codegen\` first.`);
      failed = true;
      continue;
    }

    // `runCodegenCheck` is how the committed fingerprint is read: it is the lock
    // parser, and it surfaces the header precisely so a caller can make this
    // comparison. Its drift verdict is a bonus here — `codegen:check` owns that.
    let committedFingerprint: string;
    let committedEngine: string;
    let driftCount: number;
    try {
      const report = await runCodegenCheck({ lockContent: tree.lockContent, files: tree.files });
      committedFingerprint = report.crateFingerprint;
      committedEngine = report.engineVersion;
      driftCount = report.drifts.length;
    } catch (error) {
      if (error instanceof CodegenLockError) {
        console.error(`\n✗ ${method.name} — ${error.message}`);
        failed = true;
        continue;
      }
      throw error;
    }

    let liveFingerprint: string;
    let liveEngine: string;
    try {
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
      liveFingerprint = response.crate_fingerprint;
      liveEngine = response.engine_version;
    } catch (error) {
      const detail =
        error instanceof ApiResponseError
          ? `HTTP ${error.status} from POST /v1/codegen — ${error.serverMessage ?? error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      console.error(`\n✗ ${method.name} — ${detail}`);
      failed = true;
      continue;
    }

    if (liveFingerprint !== committedFingerprint) {
      console.error(`\n✗ ${method.name} — the committed crate is not what the method resolves to.`);
      console.error(`    committed: ${committedFingerprint}`);
      console.error(`    live:      ${liveFingerprint}`);
      console.error("    Run `npm run codegen` and commit the result.");
      failed = true;
      continue;
    }

    console.log(
      `\n✓ ${method.name} — crate ${committedFingerprint.slice(0, 12)} matches the engine`,
    );
    if (liveEngine !== committedEngine) {
      // Not a failure. The stamp carries `engine_version`, so an engine bump
      // rewrites every artifact with zero semantic change — the fingerprint is
      // the semantic signal and it just matched. Regenerate deliberately, in its
      // own commit, rather than letting an unrelated PR carry a whole-tree diff.
      console.log(
        `    note: engine moved ${committedEngine} → ${liveEngine}; regenerating will restamp the tree with no semantic change`,
      );
    }
    if (driftCount > 0) {
      console.log(
        `    note: ${driftCount} drift(s) against the lock — run \`npm run codegen:check\``,
      );
    }
  }

  return failed ? EXIT_FAILED : EXIT_OK;
}

/**
 * The whole `npm run codegen:verify` behavior, exit code included. Never
 * throws — see the same note on `runGenerate`.
 */
export async function runVerify(): Promise<number> {
  try {
    return await runVerifyInner();
  } catch (error) {
    console.error(`codegen:verify: ${error instanceof Error ? error.stack : String(error)}`);
    return EXIT_FAILED;
  }
}
