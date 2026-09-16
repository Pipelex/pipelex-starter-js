import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const METHODS_DIR = path.join(process.cwd(), "methods");

/** A method directory name, exactly as `make add-method` derives one: kebab-case, a letter first. */
const METHOD_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Read every `.mthds` file of one method directory, for a run's
 * `mthds_contents`.
 *
 * The Pipelex API takes a bundle's TOML directly, so a method authored in this
 * repo is read from disk at request time rather than inlined as a string. The
 * files are the ones `npm run codegen` projected the method from — every
 * `.mthds` file under `methods/<name>/`, at any depth, in sorted path order — so
 * a run and its generated types always describe the same bundle. One loader
 * serves every bundle-sourced action, hand-written or scaffolded: the action
 * names its directory, and that is all it holds.
 *
 * A missing directory, or one holding no `.mthds` file, rejects with an
 * `ENOENT` error, which `classifyPipelineError` reports as `bundle_load_failed`.
 */
export async function loadMethodBundles(
  name: string,
  methodsDir: string = METHODS_DIR,
): Promise<string[]> {
  // The name comes from a constant in an action, never from a request, but it
  // is joined into a filesystem path, so it is held to the one shape it can have.
  if (!METHOD_NAME.test(name)) {
    throw new Error(`"${name}" is not a method directory name (kebab-case).`);
  }
  const dir = path.join(methodsDir, name);
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const bundlePaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mthds"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  if (bundlePaths.length === 0) {
    throw Object.assign(new Error(`ENOENT: no .mthds file under ${dir}`), { code: "ENOENT" });
  }
  return Promise.all(bundlePaths.map((bundlePath) => readFile(bundlePath, "utf-8")));
}
