import { readFile } from "node:fs/promises";
import path from "node:path";

const HELLO_BUNDLE_PATH = path.join(process.cwd(), "methods", "hello", "main.mthds");
const SUMMARIZE_PDF_BUNDLE_PATH = path.join(
  process.cwd(),
  "methods",
  "summarize-pdf",
  "main.mthds",
);
const GENERATE_IMAGE_BUNDLE_PATH = path.join(
  process.cwd(),
  "methods",
  "generate-image",
  "main.mthds",
);

/**
 * Read a .mthds bundle as a TOML string. The Pipelex API accepts the bundle
 * content directly via the `mthds_contents` field — one helper per bundle.
 */
export async function loadHelloBundle(): Promise<string> {
  return readFile(HELLO_BUNDLE_PATH, "utf-8");
}

export async function loadSummarizePdfBundle(): Promise<string> {
  return readFile(SUMMARIZE_PDF_BUNDLE_PATH, "utf-8");
}

export async function loadGenerateImageBundle(): Promise<string> {
  return readFile(GENERATE_IMAGE_BUNDLE_PATH, "utf-8");
}

export const HELLO_BUNDLE_PATH_FOR_TESTS = HELLO_BUNDLE_PATH;
export const SUMMARIZE_PDF_BUNDLE_PATH_FOR_TESTS = SUMMARIZE_PDF_BUNDLE_PATH;
export const GENERATE_IMAGE_BUNDLE_PATH_FOR_TESTS = GENERATE_IMAGE_BUNDLE_PATH;
