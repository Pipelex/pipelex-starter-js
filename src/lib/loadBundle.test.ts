import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadMethodBundles } from "./loadBundle";

let methodsDir: string;

beforeEach(async () => {
  methodsDir = await mkdtemp(path.join(os.tmpdir(), "starter-bundles-"));
});

afterEach(async () => {
  await rm(methodsDir, { recursive: true, force: true });
});

async function put(relative: string, content: string): Promise<void> {
  const target = path.join(methodsDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
}

describe("loadMethodBundles", () => {
  it("reads every .mthds file of the method, at any depth, in sorted path order", async () => {
    await put("cv-screening/main.mthds", "MAIN");
    await put("cv-screening/concepts.mthds", "CONCEPTS");
    await put("cv-screening/steps/score.mthds", "SCORE");
    await put("cv-screening/README.md", "not a bundle");

    await expect(loadMethodBundles("cv-screening", methodsDir)).resolves.toEqual([
      "CONCEPTS",
      "MAIN",
      "SCORE",
    ]);
  });

  it("reads only the named method's directory", async () => {
    await put("first/main.mthds", "FIRST");
    await put("second/main.mthds", "SECOND");

    await expect(loadMethodBundles("first", methodsDir)).resolves.toEqual(["FIRST"]);
  });

  it("rejects with ENOENT when the directory is missing", async () => {
    await expect(loadMethodBundles("absent", methodsDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects with ENOENT when the directory holds no bundle", async () => {
    // A selector-sourced method's directory holds a method.json and no bundle.
    await put("published/method.json", "{}");
    await expect(loadMethodBundles("published", methodsDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["../escape", "Upper", "a/b", "", "3d-model"])(
    "refuses a name that is not kebab-case: %j",
    async (name) => {
      await expect(loadMethodBundles(name, methodsDir)).rejects.toThrow(/not a method directory/);
    },
  );

  // The real `methods/`, read with the default root the actions use: every
  // directory that holds a bundle is one an action can load by its name. Each
  // action's own test pins which name it passes.
  it("loads every bundle this app ships, by its directory name", async () => {
    const root = path.join(process.cwd(), "methods");
    const names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const name of names) {
      const entries = await readdir(path.join(root, name), { recursive: true });
      if (!entries.some((entry) => entry.endsWith(".mthds"))) continue;
      const bundles = await loadMethodBundles(name);
      expect(bundles.length).toBeGreaterThan(0);
      for (const bundle of bundles) expect(bundle).toMatch(/^domain\s*=/m);
    }
  });
});
