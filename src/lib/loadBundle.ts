import { readFile } from "node:fs/promises";
import path from "node:path";

const HELLO_BUNDLE_PATH = path.join(process.cwd(), "methods", "hello", "main.mthds");

/**
 * Read the hello-pipeline .mthds bundle as a TOML string. The Pipelex API
 * accepts the bundle content directly via the `mthds_contents` field.
 */
export async function loadHelloBundle(): Promise<string> {
  return readFile(HELLO_BUNDLE_PATH, "utf-8");
}

export const HELLO_BUNDLE_PATH_FOR_TESTS = HELLO_BUNDLE_PATH;
