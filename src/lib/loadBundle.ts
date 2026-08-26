import { readFile } from "node:fs/promises";
import path from "node:path";

const EXTRACT_ENTITIES_BUNDLE_PATH = path.join(
  process.cwd(),
  "methods",
  "extract-entities",
  "main.mthds",
);
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
const COMPLEX_FORM_BUNDLE_PATH = path.join(process.cwd(), "methods", "complex-form", "main.mthds");

/**
 * Read a .mthds bundle as a TOML string. The Pipelex API accepts the bundle
 * content directly via the `mthds_contents` field — one helper per bundle.
 */
export async function loadExtractEntitiesBundle(): Promise<string> {
  return readFile(EXTRACT_ENTITIES_BUNDLE_PATH, "utf-8");
}

export async function loadSummarizePdfBundle(): Promise<string> {
  return readFile(SUMMARIZE_PDF_BUNDLE_PATH, "utf-8");
}

export async function loadGenerateImageBundle(): Promise<string> {
  return readFile(GENERATE_IMAGE_BUNDLE_PATH, "utf-8");
}

export async function loadComplexFormBundle(): Promise<string> {
  return readFile(COMPLEX_FORM_BUNDLE_PATH, "utf-8");
}

export const EXTRACT_ENTITIES_BUNDLE_PATH_FOR_TESTS = EXTRACT_ENTITIES_BUNDLE_PATH;
export const SUMMARIZE_PDF_BUNDLE_PATH_FOR_TESTS = SUMMARIZE_PDF_BUNDLE_PATH;
export const GENERATE_IMAGE_BUNDLE_PATH_FOR_TESTS = GENERATE_IMAGE_BUNDLE_PATH;
