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
  compareSidecar,
  CONTRACTS_FILENAME,
  discoverMethods,
  findOrphanTrees,
  hashSource,
  isContainedPath,
  NonUtf8FileError,
  readGeneratedTree,
  readTextFile,
  renderContracts,
  SOURCES_SIDECAR,
  SymlinkRefusedError,
  walk,
} from "./shared.mts";

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

describe("compareSidecar", () => {
  const HASH_A = hashSource("a = 1\n");
  const HASH_B = hashSource("b = 2\n");
  const CONTRACTS = renderContracts({ "d.p": { inputs: {}, output: {} } });

  /**
   * Write a sidecar plus a matching `contracts.ts`, so a test that is about the
   * `sources` half is not tripped by the `derived` half it does not care about.
   */
  async function writeSidecar(
    sources: Record<string, string>,
    derived: Record<string, string> = { [CONTRACTS_FILENAME]: hashSource(CONTRACTS) },
  ): Promise<void> {
    await writeFile(path.join(fixtureDir, CONTRACTS_FILENAME), CONTRACTS);
    await writeFile(
      path.join(fixtureDir, SOURCES_SIDECAR),
      JSON.stringify({ comment: "test", sources, derived }, null, 2),
    );
  }

  it("passes when the recorded hashes match the current ones", async () => {
    await writeSidecar({ "methods/m/main.mthds": HASH_A });
    expect(await compareSidecar(fixtureDir, { "methods/m/main.mthds": HASH_A })).toEqual([]);
  });

  it("reports an edited source", async () => {
    await writeSidecar({ "methods/m/main.mthds": HASH_A });
    const stale = await compareSidecar(fixtureDir, { "methods/m/main.mthds": HASH_B });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("edited since the types were generated");
  });

  it("reports a new source the sidecar does not cover", async () => {
    await writeSidecar({});
    const stale = await compareSidecar(fixtureDir, { "methods/m/new.mthds": HASH_A });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("a new bundle the generated types do not cover");
  });

  it("reports a recorded source no longer on disk", async () => {
    await writeSidecar({ "methods/m/gone.mthds": HASH_A });
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("no longer on disk");
  });

  it("treats a missing sidecar as stale, not as a crash", async () => {
    const stale = await compareSidecar(fixtureDir, { "methods/m/main.mthds": HASH_A });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("missing or unreadable");
  });

  it("reports a sidecar with no sources map", async () => {
    await writeFile(path.join(fixtureDir, SOURCES_SIDECAR), JSON.stringify({ comment: "x" }));
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('no "sources" map');
  });

  it("reports a sidecar with no derived map", async () => {
    await writeFile(
      path.join(fixtureDir, SOURCES_SIDECAR),
      JSON.stringify({ comment: "x", sources: {} }),
    );
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('no "derived" map');
  });

  // The derived half exists for exactly these three: without it a hand-edited or
  // deleted contracts.ts passes `make check` while the form it feeds renders from
  // something nobody generated.
  it("reports a hand-edited derived artifact", async () => {
    await writeSidecar({});
    await writeFile(path.join(fixtureDir, CONTRACTS_FILENAME), `${CONTRACTS}// tampered\n`);
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toEqual([`derived: ${CONTRACTS_FILENAME} — hand-edited since it was generated`]);
  });

  it("reports a deleted derived artifact", async () => {
    await writeSidecar({});
    await rm(path.join(fixtureDir, CONTRACTS_FILENAME));
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toEqual([
      `derived: ${CONTRACTS_FILENAME} — recorded in ${SOURCES_SIDECAR} but missing from the tree`,
    ]);
  });

  it("reports a derived artifact the sidecar never recorded", async () => {
    // The expectation is the constant, never the sidecar's own keys: reading it
    // off the file under test would let an empty `derived` map certify itself.
    await writeSidecar({}, {});
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toEqual([`derived: ${CONTRACTS_FILENAME} — not recorded in ${SOURCES_SIDECAR}`]);
  });

  it("reports a recorded derived artifact that is no longer generated", async () => {
    await writeSidecar(
      {},
      { [CONTRACTS_FILENAME]: hashSource(CONTRACTS), "retired.ts": hashSource("x") },
    );
    const stale = await compareSidecar(fixtureDir, {});
    expect(stale).toEqual([
      `derived: retired.ts — recorded in ${SOURCES_SIDECAR} but no longer generated`,
    ]);
  });

  it("hashes derived artifacts line-ending-invariantly, like sources", async () => {
    await writeSidecar({});
    await writeFile(path.join(fixtureDir, CONTRACTS_FILENAME), CONTRACTS.replace(/\n/g, "\r\n"));
    expect(await compareSidecar(fixtureDir, {})).toEqual([]);
  });
});

describe("renderContracts", () => {
  it("does not open with a codegen stamp, so the tree cleanup leaves it alone", () => {
    // `runCodegenCheck` calls a *stamped* file the lock does not track an orphan,
    // and `writeTree` deletes orphans. An unstamped `.ts` is the supported shape
    // for a consumer-owned file beside the lock — this is what keeps it alive.
    expect(renderContracts({})).not.toContain("pipelex-codegen-stamp");
  });

  it("is deterministic and ends with exactly one newline", () => {
    const payload = { "d.p": { inputs: { a: 1 }, output: { b: 2 } } };
    expect(renderContracts(payload)).toBe(renderContracts(payload));
    expect(renderContracts(payload).endsWith(";\n")).toBe(true);
  });

  it("types the literal against the kernel's mirror, so tsc gates contract drift", () => {
    const rendered = renderContracts({});
    expect(rendered).toContain('import type { PipeIOContracts } from "@pipelex/mthds-form";');
    expect(rendered).toContain("export const PIPE_IO_CONTRACTS: PipeIOContracts =");
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

describe("entry policy at the scanned roots", () => {
  it("readGeneratedTree maps a lockless tree to no-lock, carrying its paths", async () => {
    await writeFile(path.join(fixtureDir, "types.ts"), "export {};\n");

    expect(await readGeneratedTree(fixtureDir)).toEqual({
      status: "no-lock",
      treePaths: ["types.ts"],
    });
  });

  it("discoverMethods refuses a symlinked entry at the methods root", async () => {
    await mkdir(path.join(fixtureDir, "real-m"));
    await symlink(path.join(fixtureDir, "real-m"), path.join(fixtureDir, "link-m"));

    const error = await discoverMethods(fixtureDir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link-m");
  });

  it("discoverMethods skips a plain file at the methods root", async () => {
    await writeFile(path.join(fixtureDir, ".DS_Store"), "junk");
    await mkdir(path.join(fixtureDir, "m"));
    await writeFile(path.join(fixtureDir, "m", "main.mthds"), "a = 1\n");

    const methods = await discoverMethods(fixtureDir);
    expect(methods.map((m) => m.name)).toEqual(["m"]);
    expect(Object.keys(methods[0].sourceHashes)).toEqual(["methods/m/main.mthds"]);
  });

  it("findOrphanTrees refuses a symlinked entry under the generated root", async () => {
    await mkdir(path.join(fixtureDir, "real-tree"));
    await symlink(path.join(fixtureDir, "real-tree"), path.join(fixtureDir, "link-tree"));

    const error = await findOrphanTrees(fixtureDir, new Set()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SymlinkRefusedError);
    expect((error as SymlinkRefusedError).message).toContain("link-tree");
  });
});

describe("isContainedPath", () => {
  const TREE = path.join(path.sep, "repo", "src", "generated", "demo");

  it.each(["types.ts", "binder.ts", "nested/deeper.ts", "./types.ts"])(
    "accepts %s",
    (candidate) => {
      expect(isContainedPath(TREE, candidate)).toBe(true);
    },
  );

  it.each([
    "../escaped.ts",
    "../../../.husky/pre-commit",
    "nested/../../escaped.ts",
    path.join(path.sep, "etc", "passwd"),
    "",
    ".",
  ])("refuses %s", (candidate) => {
    expect(isContainedPath(TREE, candidate)).toBe(false);
  });

  it("refuses a sibling directory that merely shares the tree's name as a prefix", () => {
    // The bug a bare `startsWith` would have: `…/demo-backup/` is not `…/demo/`.
    expect(isContainedPath(TREE, path.join("..", "demo-backup", "types.ts"))).toBe(false);
  });
});
