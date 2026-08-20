// @vitest-environment node
//
// Pins the offline check's exit-code contract — the part that used to live at
// a script's top level and could not be imported.
//
// Exit codes are the contract `make check` reads (0 current · 1 drift · 2 no
// verdict), and both halves fail as a *wrong verdict* rather than an error:
// `summarizeVerdicts` must let a no-verdict outrank drift instead of one
// method's verdict masking another's, and `checkMethod` must map each way a
// tree can be unreadable onto the right one of those three.

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkMethod,
  EXIT_CURRENT,
  EXIT_DRIFT,
  EXIT_NO_VERDICT,
  summarizeVerdicts,
} from "./check.mts";
import { LOCK_FILENAME, type MethodClosure } from "./shared.mts";

// Invalid UTF-8: a lone continuation byte, the same fixture the shared layer uses.
const INVALID_UTF8 = Buffer.from([0x68, 0x69, 0x80, 0x0a]);

const METHOD: MethodClosure = {
  name: "demo",
  files: [{ content: "", source: "methods/demo/main.mthds" }],
  sourceHashes: { "methods/demo/main.mthds": "abc123" },
};

let generatedRoot: string;

beforeEach(async () => {
  generatedRoot = await mkdtemp(path.join(tmpdir(), "codegen-check-"));
  // The reports are the CLI's output, not the assertion surface.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(generatedRoot, { recursive: true, force: true });
});

/** Create `<generatedRoot>/demo/` with the given files, and return its path. */
async function tree(files: Record<string, string | Buffer>): Promise<string> {
  const outDir = path.join(generatedRoot, "demo");
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(outDir, name), content);
  }
  return outDir;
}

describe("summarizeVerdicts", () => {
  it("reports current when every method is current", () => {
    expect(summarizeVerdicts([EXIT_CURRENT, EXIT_CURRENT])).toMatchObject({
      current: 2,
      exit: EXIT_CURRENT,
    });
  });

  it("lets a no-verdict outrank drift, whichever came first", () => {
    // Order-independence is the point: a max() over codes happens to agree
    // today, but precedence is the rule and the counts are what gets printed.
    expect(summarizeVerdicts([EXIT_NO_VERDICT, EXIT_DRIFT]).exit).toBe(EXIT_NO_VERDICT);
    expect(summarizeVerdicts([EXIT_DRIFT, EXIT_NO_VERDICT]).exit).toBe(EXIT_NO_VERDICT);
  });

  it("counts the mix the single exit code cannot show", () => {
    expect(summarizeVerdicts([EXIT_CURRENT, EXIT_DRIFT, EXIT_NO_VERDICT])).toEqual({
      current: 1,
      drift: 1,
      noVerdict: 1,
      exit: EXIT_NO_VERDICT,
    });
  });

  it("treats an unknown code as a no-verdict rather than as success", () => {
    expect(summarizeVerdicts([42]).exit).toBe(EXIT_NO_VERDICT);
  });

  it("reports current on an empty run — the caller owns the 'nothing to check' case", () => {
    expect(summarizeVerdicts([]).exit).toBe(EXIT_CURRENT);
  });
});

describe("checkMethod", () => {
  it("calls an absent tree drift — regenerating is the real remedy", async () => {
    expect(await checkMethod(METHOD, generatedRoot)).toBe(EXIT_DRIFT);
  });

  it("produces no verdict for a tree with no lock", async () => {
    await tree({ "types.ts": "export {};\n" });

    expect(await checkMethod(METHOD, generatedRoot)).toBe(EXIT_NO_VERDICT);
  });

  it("calls a non-UTF-8 artifact drift, because regenerating rewrites it", async () => {
    await tree({ [LOCK_FILENAME]: "lock_version = 1\n", "types.ts": INVALID_UTF8 });

    expect(await checkMethod(METHOD, generatedRoot)).toBe(EXIT_DRIFT);
  });

  it("produces no verdict for a symlinked tree", async () => {
    const external = path.join(generatedRoot, "external");
    await mkdir(external, { recursive: true });
    await writeFile(path.join(external, LOCK_FILENAME), "lock_version = 1\n");
    await symlink(external, path.join(generatedRoot, "demo"));

    expect(await checkMethod(METHOD, generatedRoot)).toBe(EXIT_NO_VERDICT);
  });

  it("produces no verdict for an unparseable lock", async () => {
    await tree({ [LOCK_FILENAME]: "this is not a lock\n" });

    expect(await checkMethod(METHOD, generatedRoot)).toBe(EXIT_NO_VERDICT);
  });
});
