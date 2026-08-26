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
 *
 * `runGenerate` owns the whole contract, exit code included, so the CLI entry
 * (`scripts/codegen.mts`) stays a one-liner and `writeTree` — the only code in
 * this repo that deletes files — is importable and tested.
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
  DEFAULT_API_BASE_URL,
  PipelexApiClient,
  runCodegenCheck,
  type CodegenValidReport,
  type GeneratedArtifact,
} from "@pipelex/sdk";

import {
  assertSecureBaseUrl,
  CONTRACTS_FILENAME,
  discoverMethods,
  hashSource,
  isContainedPath,
  refuseSymlinkRoot,
  GENERATED_ROOT,
  LOCK_FILENAME,
  METHODS_DIR,
  readGeneratedTree,
  renderContracts,
  REPO_ROOT,
  SIDECAR_COMMENT,
  SOURCES_SIDECAR,
  type MethodClosure,
  type SourcesSidecar,
  walk,
} from "./shared.mts";

const { loadEnvConfig } = nextEnv;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;

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
 * Write one method's artifact set, its lock, the starter-emitted artifacts, and
 * its sources sidecar.
 *
 * Stale artifacts that dropped out of the set are removed, and the authority on
 * what may be removed is `runCodegenCheck`'s own `orphan` verdict over the tree
 * we just wrote — not a filename test. That distinction is load-bearing. A
 * suffix test (`isStampableArtifactPath`) answers "could this file type be an
 * artifact"; the SDK's orphan rule additionally requires the file to *carry a
 * codegen stamp*. Deleting on the weaker test destroys any hand-written `.ts`
 * a consumer parks in the tree — including the "sibling module" the generated
 * header itself recommends for declaration merging — while the offline check,
 * which uses the stronger rule, reports that same file as perfectly healthy.
 * Deferring to the check here is what makes the writer and the checker agree by
 * construction, the same property the `lock_filename` guard below buys.
 *
 * `derived` (filename → content) carries the artifacts this repo emits itself,
 * `contracts.ts` today. They are written BEFORE the orphan pass, deliberately:
 * the writer and the checker then see the identical tree, so if the SDK's orphan
 * rule ever stopped exempting unstamped files, the writer would delete the file
 * and the failure would be visible here rather than only in a later check.
 */
export async function writeTree(
  outDir: string,
  report: CodegenValidReport,
  sourceHashes: Record<string, string>,
  derived: Record<string, string> = {},
): Promise<string[]> {
  // Vet the whole pre-existing tree — root and nested entries alike — BEFORE
  // the first write. `walk` refuses any symlink or special file, so a write
  // can never be routed through a link into an external target; the post-write
  // readGeneratedTree scan alone would refuse only after the damage was done.
  // An absent tree (first generation) is fine.
  try {
    await walk(outDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
  }

  const changed: string[] = [];

  for (const artifact of [
    ...report.artifacts,
    { path: report.lock_filename, content: report.lock },
    ...Object.entries(derived).map(([name, content]) => ({ path: name, content })),
  ]) {
    if (await writeIfChanged(path.join(outDir, artifact.path), artifact.content)) {
      changed.push(artifact.path);
    }
  }

  // Re-read what is now on disk and ask the check which files are orphans against
  // the lock we just wrote. `force: true` because a file vanishing between the
  // read and the unlink is a race, not a failure — and an ENOENT thrown here
  // would abort before the sidecar below is written, leaving a tree the offline
  // check then calls stale.
  const written = await readGeneratedTree(outDir);
  if (written.status === "ok") {
    const { drifts } = await runCodegenCheck({
      lockContent: written.lockContent,
      files: written.files,
    });
    for (const drift of drifts) {
      if (drift.category !== "orphan") continue;
      // The docstring above promises this ordering makes an orphan-rule change
      // visible here. That is only true if someone looks: without this, a
      // deleted `contracts.ts` still gets its hash recorded below (the sidecar
      // is hashed from the content we wrote, not from disk), so regeneration
      // exits 0 on a tree the very next check calls stale.
      if (drift.path in derived) {
        throw new Error(
          `the orphan pass removed '${drift.path}', which this script emits. ` +
            `@pipelex/sdk's orphan rule no longer exempts unstamped files — ` +
            `the derived artifacts need a new home or a stamp.`,
        );
      }
      await rm(path.join(outDir, drift.path), { force: true });
      changed.push(`${drift.path} (removed)`);
    }
  }

  // Hashed from the content we wrote, not re-read from disk: the sidecar records
  // what regeneration produced, and a re-read would launder any interference
  // between the write and the hash into a "current" verdict.
  const derivedHashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(derived)) derivedHashes[name] = hashSource(content);

  const sidecar: SourcesSidecar = {
    comment: SIDECAR_COMMENT,
    sources: sourceHashes,
    derived: derivedHashes,
  };
  const sidecarPath = path.join(outDir, SOURCES_SIDECAR);
  if (await writeIfChanged(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`)) {
    changed.push(SOURCES_SIDECAR);
  }

  return changed;
}

/** Turn a thrown value into an actionable line, naming the fix where we know it. */
function explain(error: unknown, baseUrl: string, route = "POST /v1/codegen"): string {
  if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
    return [
      `this base URL does not serve ${route} (HTTP ${error.status}).`,
      `  Base URL: ${baseUrl}`,
      "  The hosted Pipelex API serves this route — check PIPELEX_BASE_URL in",
      "  .env.local, or drop it to use the default.",
    ].join("\n");
  }
  if (error instanceof ApiResponseError) {
    return `HTTP ${error.status} from ${route} — ${error.serverMessage ?? error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch one method's pipe IO contracts from `POST /v1/validate`.
 *
 * `validateFiles` rather than the lower-level `validate`: the closure is already
 * `MthdsFileItem[]` (`{content, source}`) and this adapter takes `MthdsFile[]`
 * (`{content, uri}`), so one field rename buys per-file attribution in the
 * diagnostics — and the adapter, not this script, is what guarantees the
 * `mthds_contents` / `mthds_sources` arrays it builds are the same length. Doing
 * it by hand is a 422 waiting for the first method with two bundles.
 *
 * Returns `null` after reporting; the caller fails the method and writes nothing.
 * An invalid bundle is a produced verdict on a 200, not a thrown error, so it is
 * pattern-matched rather than caught — and it must never yield a contracts file:
 * contracts projected from a bundle that does not resolve would describe a form
 * for a method that cannot run.
 */
async function fetchContracts(
  client: PipelexApiClient,
  method: MethodClosure,
  baseUrl: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await client.validateFiles(
      method.files.map((file) => ({ content: file.content, uri: file.source })),
    );
    if (!response.is_valid) {
      console.error(`\n✗ ${method.name} — the bundle does not validate:`);
      for (const item of response.validation_errors) {
        console.error(`    ${item.source ?? "?"}: ${item.message}`);
      }
      return null;
    }
    return response.pipe_io_contracts;
  } catch (error) {
    console.error(`\n✗ ${method.name} — ${explain(error, baseUrl, "POST /v1/validate")}`);
    return null;
  }
}

async function runGenerateInner(): Promise<number> {
  loadEnvConfig(REPO_ROOT, false, { info: () => {}, error: console.error });

  const baseUrl = process.env.PIPELEX_BASE_URL ?? DEFAULT_API_BASE_URL;
  try {
    assertSecureBaseUrl(baseUrl);
  } catch (error) {
    console.error(`codegen: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
  if (!process.env.PIPELEX_API_KEY) {
    console.error("codegen: PIPELEX_API_KEY is not set — add it to .env.local.");
    return EXIT_FAILED;
  }

  const methods = await discoverMethods();
  if (methods.length === 0) {
    console.error(`codegen: no methods found under ${path.relative(REPO_ROOT, METHODS_DIR)}/.`);
    return EXIT_FAILED;
  }

  // A symlinked src/generated/ root would route reads — and for the writer,
  // writes and deletes — into an external target. Same refusal as the check's.
  await refuseSymlinkRoot(GENERATED_ROOT);

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

    // The offline check opens the lock by name, so the writer must not put it
    // anywhere else. Following a rename silently would leave the old lock in
    // place — it is not stampable, so the tree cleanup keeps it — and the check
    // would keep validating that obsolete file and stay green. A rename is
    // upstream news; surface it here rather than writing a tree nothing guards.
    if (report.lock_filename !== LOCK_FILENAME) {
      console.error(
        `\n✗ ${method.name} — the server returned lock_filename '${report.lock_filename}', ` +
          `not '${LOCK_FILENAME}'. Nothing was written; bump @pipelex/sdk or report it upstream.`,
      );
      failed = true;
      continue;
    }

    // The server names each artifact's path too, and `path.join` would resolve a
    // `..` in one into a write outside the tree — somewhere no stamp guards the
    // file and the offline check never looks, while `writeIfChanged`'s recursive
    // `mkdir` creates whatever directory the path asks for. Refuse the method
    // whole rather than write the containable ones, so the promise above holds.
    const escaping = artifacts.filter((artifact) => !isContainedPath(outDir, artifact.path));
    if (escaping.length > 0) {
      console.error(
        `\n✗ ${method.name} — the server returned artifact path(s) that escape ` +
          `${path.relative(REPO_ROOT, outDir)}/: ${escaping.map((artifact) => artifact.path).join(", ")}. ` +
          `Nothing was written; report it upstream.`,
      );
      failed = true;
      continue;
    }

    // The derived artifacts are written last, so a server artifact sharing one
    // of their names would be silently overwritten by ours: `writeTree` returns
    // normally, the sidecar records our content, and the lock still expects the
    // server's — leaving `codegen:check` reporting `hand-edited` forever, with a
    // remedy ("run npm run codegen") that reproduces the same tree. Same class
    // as the `lock_filename` guard above, and not hypothetical: the roadmap has
    // the API serving an input-form descriptor at exactly this seam.
    const colliding = artifacts.filter((artifact) => artifact.path === CONTRACTS_FILENAME);
    if (colliding.length > 0) {
      console.error(
        `\n✗ ${method.name} — the server now returns an artifact named '${CONTRACTS_FILENAME}', ` +
          `which this script also emits. Nothing was written; stop emitting it locally ` +
          `and take the server's, or report it upstream.`,
      );
      failed = true;
      continue;
    }

    // The form's half of the tree, and the last thing that can fail this method:
    // by here every codegen guard has passed, so a failure now leaves the whole
    // tree untouched rather than half-updated.
    const contracts = await fetchContracts(client, method, baseUrl);
    if (contracts === null) {
      failed = true;
      continue;
    }

    // The only per-method step that can throw rather than return a verdict, so
    // it needs the same treatment as every other failure in this loop: report
    // the method and keep going. Escaping here would print a bare stack and
    // skip every method after this one, leaving their trees untouched for no
    // reason connected to them.
    let changed: string[];
    try {
      changed = await writeTree(outDir, report, method.sourceHashes, {
        [CONTRACTS_FILENAME]: renderContracts(contracts),
      });
    } catch (error) {
      console.error(
        `\n✗ ${method.name} — writing the tree failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      failed = true;
      continue;
    }
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

  return failed ? EXIT_FAILED : EXIT_OK;
}

/**
 * The whole `npm run codegen` behavior, exit code included. Never throws: an
 * unexpected failure is reported with its stack and exits 1, which is the
 * contract, not the entry file's job.
 */
export async function runGenerate(): Promise<number> {
  try {
    return await runGenerateInner();
  } catch (error) {
    console.error(`codegen: ${error instanceof Error ? error.stack : String(error)}`);
    return EXIT_FAILED;
  }
}
