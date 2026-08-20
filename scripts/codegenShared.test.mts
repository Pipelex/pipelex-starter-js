// @vitest-environment node
//
// Pins the shared layer's verdict-critical behavior: the line-ending-invariant
// source hash, the symlink refusal policy, fatal UTF-8 decoding, the orphan /
// case-mismatch split, the sidecar comparison, and the base-URL scheme guard.
// Each of these fails as a silent *wrong verdict* rather than an error if it
// regresses, which is what makes it worth a test.

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertSecureBaseUrl,
  compareSources,
  discoverMethods,
  findOrphanTrees,
  hashSource,
  NonUtf8FileError,
  readGeneratedTree,
  readTextFile,
  SOURCES_SIDECAR,
  SymlinkRefusedError,
  walk,
} from "./codegenShared.mts";

// Invalid UTF-8: a lone continuation byte. `readFile(p, "utf-8")` would decode
// it to U+FFFD without complaint — exactly the lossy path the fatal decoder closes.
const INVALID_UTF8 = Buffer.from([0x68, 0x69, 0x80, 0x0a]);

let fixtureDir: string;

beforeEach(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), "codegen-shared-"));
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("hashSource", () => {
  it("hashes CRLF and LF sources identically", () => {
    expect(hashSource("a = 1\r\nb = 2\r\n")).toBe(hashSource("a = 1\nb = 2\n"));
  });

  it("folds a lone CR, like the SDK's artifact check", () => {
    expect(hashSource("a\rb")).toBe(hashSource("a\nb"));
  });

  it("still distinguishes sources that differ in more than line endings", () => {
    expect(hashSource("a = 1\n")).not.toBe(hashSource("a = 2\n"));
  });
});

describe("walk symlink policy", () => {
  it("refuses a symlinked file, naming the path", async () => {
    await writeFile(path.join(fixtureDir, "real.ts"), "export {};\n");
    await symlink(path.join(fixtureDir, "real.ts"), path.join(fixtureDir, "link.ts"));

    const error = await walk(fixtureDir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link.ts");
    expect((error as SymlinkRefusedError).message).toContain("symlink");
  });

  it("refuses a symlinked directory, naming the path", async () => {
    await mkdir(path.join(fixtureDir, "real-dir"));
    await symlink(path.join(fixtureDir, "real-dir"), path.join(fixtureDir, "link-dir"));

    const error = await walk(fixtureDir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link-dir");
  });

  it("refuses a symlinked root, naming the path", async () => {
    const realRoot = path.join(fixtureDir, "real-root");
    const linkRoot = path.join(fixtureDir, "link-root");
    await mkdir(realRoot);
    await symlink(realRoot, linkRoot);

    const error = await walk(linkRoot).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link-root");
  });

  it("still walks a clean nested tree, sorted and slash-joined", async () => {
    await mkdir(path.join(fixtureDir, "sub"));
    await writeFile(path.join(fixtureDir, "b.ts"), "");
    await writeFile(path.join(fixtureDir, "sub", "a.ts"), "");

    expect(await walk(fixtureDir)).toEqual(["b.ts", "sub/a.ts"]);
  });
});

describe("root symlink guards", () => {
  it("discoverMethods refuses a symlinked methods/ root", async () => {
    const realRoot = path.join(fixtureDir, "real-methods");
    const linkRoot = path.join(fixtureDir, "link-methods");
    await mkdir(realRoot);
    await symlink(realRoot, linkRoot);

    const error = await discoverMethods(linkRoot).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link-methods");
  });

  it("findOrphanTrees refuses a symlinked generated root", async () => {
    const realRoot = path.join(fixtureDir, "real-generated");
    const linkRoot = path.join(fixtureDir, "link-generated");
    await mkdir(realRoot);
    await symlink(realRoot, linkRoot);

    const error = await findOrphanTrees(linkRoot, new Set()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link-generated");
  });
});

describe("readTextFile fatal decoding", () => {
  it("throws NonUtf8FileError on invalid UTF-8 bytes", async () => {
    const filePath = path.join(fixtureDir, "bad.ts");
    await writeFile(filePath, INVALID_UTF8);

    const error = await readTextFile(filePath).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NonUtf8FileError);
    expect((error as NonUtf8FileError).message).toContain("bad.ts");
  });

  it("reads valid UTF-8 exactly as written", async () => {
    const filePath = path.join(fixtureDir, "ok.ts");
    await writeFile(filePath, "café ✓\n");
    expect(await readTextFile(filePath)).toBe("café ✓\n");
  });

  it("surfaces from readGeneratedTree instead of a lossy verdict", async () => {
    // A tree whose lock decodes cleanly but whose artifact does not: the old
    // lossy read would hash the substituted text and could report `current`.
    await writeFile(path.join(fixtureDir, "codegen.lock"), "lock\n");
    await writeFile(path.join(fixtureDir, "types.ts"), INVALID_UTF8);

    const error = await readGeneratedTree(fixtureDir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NonUtf8FileError);
    expect((error as NonUtf8FileError).message).toContain("types.ts");
  });

  it("readGeneratedTree still maps a missing tree to no-tree", async () => {
    expect(await readGeneratedTree(path.join(fixtureDir, "absent"))).toEqual({
      status: "no-tree",
    });
  });
});

describe("findOrphanTrees", () => {
  it("reports an orphan dir, a case-mismatch dir, and ignores a plain root file", async () => {
    await mkdir(path.join(fixtureDir, "kept-method"));
    await mkdir(path.join(fixtureDir, "orphan-tree"));
    await mkdir(path.join(fixtureDir, "Cased-Method"));
    await writeFile(path.join(fixtureDir, ".DS_Store"), "junk");

    const scan = await findOrphanTrees(fixtureDir, new Set(["kept-method", "cased-method"]));
    expect(scan.orphans).toEqual(["orphan-tree"]);
    expect(scan.caseMismatches).toEqual([{ actual: "Cased-Method", expected: "cased-method" }]);
  });

  it("returns empty for a missing generated root", async () => {
    const scan = await findOrphanTrees(path.join(fixtureDir, "absent"), new Set(["x"]));
    expect(scan).toEqual({ orphans: [], caseMismatches: [] });
  });
});

describe("compareSources", () => {
  const HASH_A = hashSource("a = 1\n");
  const HASH_B = hashSource("b = 2\n");

  async function writeSidecar(sources: Record<string, string>): Promise<void> {
    await writeFile(
      path.join(fixtureDir, SOURCES_SIDECAR),
      JSON.stringify({ comment: "test", sources }, null, 2),
    );
  }

  it("passes when the recorded hashes match the current ones", async () => {
    await writeSidecar({ "methods/m/main.mthds": HASH_A });
    expect(await compareSources(fixtureDir, { "methods/m/main.mthds": HASH_A })).toEqual([]);
  });

  it("reports an edited source", async () => {
    await writeSidecar({ "methods/m/main.mthds": HASH_A });
    const stale = await compareSources(fixtureDir, { "methods/m/main.mthds": HASH_B });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("edited since the types were generated");
  });

  it("reports a new source the sidecar does not cover", async () => {
    await writeSidecar({});
    const stale = await compareSources(fixtureDir, { "methods/m/new.mthds": HASH_A });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("a new bundle the generated types do not cover");
  });

  it("reports a recorded source no longer on disk", async () => {
    await writeSidecar({ "methods/m/gone.mthds": HASH_A });
    const stale = await compareSources(fixtureDir, {});
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("no longer on disk");
  });

  it("treats a missing sidecar as stale, not as a crash", async () => {
    const stale = await compareSources(fixtureDir, { "methods/m/main.mthds": HASH_A });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("missing or unreadable");
  });

  it("reports a sidecar with no sources map", async () => {
    await writeFile(path.join(fixtureDir, SOURCES_SIDECAR), JSON.stringify({ comment: "x" }));
    const stale = await compareSources(fixtureDir, {});
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('no "sources" map');
  });
});

describe("assertSecureBaseUrl", () => {
  it.each([
    "https://api.pipelex.com",
    "https://api-dev.pipelex.com/v1",
    "http://localhost:8081",
    "http://api.localhost:8081",
    "http://127.0.0.1:8081",
    "http://[::1]:8081",
  ])("allows %s", (url) => {
    expect(() => assertSecureBaseUrl(url)).not.toThrow();
  });

  it.each([
    "http://api.pipelex.com",
    "http://192.168.1.10:8081",
    "http://evil-localhost.example.com",
    "ftp://api.pipelex.com",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => assertSecureBaseUrl(url)).toThrow();
  });

  it("explains why plaintext http is refused", () => {
    expect(() => assertSecureBaseUrl("http://api.pipelex.com")).toThrow(/bearer token/);
  });
});
