// @vitest-environment node
//
// Pins the generative arm's two gestures where they can be wrong silently: the
// producer, which must write NOTHING when a layout is refused, and the offline
// check, whose exit code is a contract `make check` branches on.
//
// The producer is exercised over a mocked client and a temporary repo — a real
// designer run costs inference and is not something a suite may spend — and the
// layout it "produces" is the same committed fixture the app's fallback tests
// break on purpose, so both sides judge one artifact.

import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROMPT_HASH } from "@pipelex/mthds-form/generative";

import {
  checkMethodDesign,
  designMethod,
  EXIT_CURRENT,
  EXIT_DRIFT,
  EXIT_NO_VERDICT,
  humanizeMethodName,
  jsonlFromResults,
  parseDesignArgs,
  pinnedModel,
  REJECTED_FILENAME,
  resolvePipeRef,
  seedLine,
  staleSources,
  type DesignDeps,
} from "./design.mts";
import {
  DESIGN_JSONL_FILENAME,
  DESIGN_MODULE_FILENAME,
  DESIGN_RECORD_FILENAME,
  hashSource,
  renderDesignModule,
  REPO_ROOT,
  SIDECAR_COMMENT,
  SOURCES_SIDECAR,
  type MethodSource,
} from "./shared.mts";
import { DEMO_JSONL } from "../../src/lib/design.fixture.ts";

const METHOD_NAME = "demo";
const MAIN_MTHDS = 'domain = "extract_entities"\n';
const SOURCE_PATH = `methods/${METHOD_NAME}/main.mthds`;

const SOURCE: MethodSource = {
  name: METHOD_NAME,
  kind: "files",
  files: [{ content: MAIN_MTHDS, source: SOURCE_PATH }],
  sourceHashes: { [SOURCE_PATH]: hashSource(MAIN_MTHDS) },
};

/** The designer bundle's model pin, in the object form the real one uses. */
const BUNDLE = [
  "[pipe.ui_designer]",
  'model = { model = "claude-5-sonnet", temperature = 1 }',
  "",
].join("\n");

let root: string;
let methodsDir: string;
let generatedRoot: string;
let outDir: string;

/**
 * A temporary repo carrying one method and the generated tree a design is
 * judged against. The contracts are the real committed ones for
 * `extract_entities`, because the fixture layout binds `/inputs/text` and the
 * point of the fit check is that it is asked against a real descriptor.
 */
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "starter-design-"));
  methodsDir = path.join(root, "methods");
  generatedRoot = path.join(root, "src", "generated");
  outDir = path.join(generatedRoot, METHOD_NAME);
  await mkdir(path.join(methodsDir, METHOD_NAME), { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(methodsDir, METHOD_NAME, "main.mthds"), MAIN_MTHDS);
  await copyFile(
    path.join(REPO_ROOT, "src", "generated", "extract-entities", "contracts.ts"),
    path.join(outDir, "contracts.ts"),
  );
  await writeFile(path.join(outDir, DESIGN_MODULE_FILENAME), renderDesignModule(null));
  await writeSidecar({ [DESIGN_MODULE_FILENAME]: hashSource(renderDesignModule(null)) });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeSidecar(derived: Record<string, string>): Promise<void> {
  await writeFile(
    path.join(outDir, SOURCES_SIDECAR),
    `${JSON.stringify(
      { comment: SIDECAR_COMMENT, sources: SOURCE.sourceHashes, derived },
      null,
      2,
    )}\n`,
  );
}

/** A client that answers one designer run with `jsonl`. */
function client(jsonl: string) {
  return {
    startAndWaitForResult: vi.fn().mockResolvedValue({
      pipeline_run_id: "run-1",
      main_stuff: { text: jsonl },
    }),
  };
}

function deps(jsonl: string): DesignDeps {
  return {
    methodsDir,
    generatedRoot,
    client: client(jsonl) as unknown as DesignDeps["client"],
    bundle: BUNDLE,
    today: "2026-09-06",
  };
}

const read = (relative: string) => readFile(path.join(root, relative), "utf-8");
const exists = (relative: string) =>
  read(relative).then(
    () => true,
    () => false,
  );

describe("the pure pieces", () => {
  it("formats the seed the way the kernel's own harness does", () => {
    // Two producers seeding the same method the same way must get the same run,
    // and the kernel does not export this line — so it is a copy that must not
    // drift, which is exactly what a test is for.
    expect(seedLine("abc")).toBe(
      "CREATIVE SEED (derive your direction from it; never reveal it): abc",
    );
  });

  it("reads the designer's model pin, so the record names what actually ran", () => {
    expect(pinnedModel(BUNDLE)).toBe("claude-5-sonnet");
    expect(pinnedModel("nothing here")).toBeNull();
  });

  it("takes the layout out of either shape a text output arrives in", () => {
    expect(jsonlFromResults({ main_stuff: { text: "x" } } as never)).toBe("x");
    expect(jsonlFromResults({ main_stuff: "x" } as never)).toBe("x");
    expect(jsonlFromResults({ main_stuff: { other: 1 } } as never)).toBeNull();
  });

  it("defaults to the only pipe there is, and refuses to guess between several", () => {
    expect(resolvePipeRef({ "d.p": {} } as never)).toBe("d.p");
    expect(resolvePipeRef({ "d.p": {}, "d.q": {} } as never, "d.q")).toBe("d.q");
    expect(() => resolvePipeRef({ "d.p": {}, "d.q": {} } as never)).toThrow(/2 pipes/);
    expect(() => resolvePipeRef({ "d.p": {} } as never, "d.nope")).toThrow(/no pipe 'd.nope'/);
  });

  it("names each way the method has moved under a design", () => {
    expect(staleSources({ a: "1" }, { a: "1" })).toEqual([]);
    expect(staleSources({ a: "1" }, { a: "2" })[0]).toContain("edited");
    expect(staleSources({}, { a: "1" })[0]).toContain("added");
    expect(staleSources({ a: "1" }, {})[0]).toContain("gone");
  });

  it("names the method the way a host would list it", () => {
    expect(humanizeMethodName("extract-entities")).toBe("Extract entities");
  });

  it("refuses an unknown flag and a swallowed value", () => {
    expect(parseDesignArgs(["--name", "demo", "--seed", "s"])).toEqual({
      name: "demo",
      seed: "s",
    });
    expect(() => parseDesignArgs(["--nope", "x"])).toThrow(/unknown argument/);
    expect(() => parseDesignArgs(["--name", "--seed"])).toThrow(/needs a value/);
  });
});

describe("designMethod", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes the layout, the record, the projection and the sidecar hash", async () => {
    expect(await designMethod(deps(DEMO_JSONL), SOURCE)).toBe("ok");

    expect(await read(`methods/${METHOD_NAME}/${DESIGN_JSONL_FILENAME}`)).toBe(DEMO_JSONL);

    const record = JSON.parse(await read(`methods/${METHOD_NAME}/${DESIGN_RECORD_FILENAME}`));
    expect(record).toMatchObject({
      pipeRef: "extract_entities.extract_entities",
      producer: "pipelex-method",
      model: "claude-5-sonnet",
      promptHash: PROMPT_HASH,
      date: "2026-09-06",
      sources: SOURCE.sourceHashes,
      jsonlSha256: hashSource(DEMO_JSONL),
    });
    expect(record.seed).toBeUndefined();

    // The projection and the sidecar are re-written by the same renderer and the
    // same hash the codegen writer uses, so `codegen:check` stays green without
    // a regeneration — a design is not a source.
    const projected = await read(`src/generated/${METHOD_NAME}/${DESIGN_MODULE_FILENAME}`);
    expect(projected).toContain('"pipeRef": "extract_entities.extract_entities"');
    const sidecar = JSON.parse(await read(`src/generated/${METHOD_NAME}/${SOURCES_SIDECAR}`));
    expect(sidecar.derived[DESIGN_MODULE_FILENAME]).toBe(hashSource(projected));
  });

  it("records the seed it was given, and hands it to the model as one line", async () => {
    const d = deps(DEMO_JSONL);
    expect(await designMethod(d, SOURCE, { seed: "cobalt" })).toBe("ok");

    const record = JSON.parse(await read(`methods/${METHOD_NAME}/${DESIGN_RECORD_FILENAME}`));
    expect(record.seed).toBe("cobalt");
    const call = (d.client.startAndWaitForResult as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as { inputs: Record<string, string> };
    expect(call.inputs.seed).toBe(seedLine("cobalt"));
    expect(call.inputs.catalog_rules.length).toBeGreaterThan(0);
    expect(call.inputs.brief).toContain("/inputs/text");
  });

  it("writes NOTHING but the rejected text when the catalog refuses the layout", async () => {
    const bad = DEMO_JSONL.replace('"type":"Hero"', '"type":"NoSuchComponent"');
    expect(await designMethod(deps(bad), SOURCE)).toBe("failed");

    expect(await exists(`methods/${METHOD_NAME}/${DESIGN_JSONL_FILENAME}`)).toBe(false);
    expect(await exists(`methods/${METHOD_NAME}/${DESIGN_RECORD_FILENAME}`)).toBe(false);
    expect(await read(`methods/${METHOD_NAME}/${REJECTED_FILENAME}`)).toBe(bad);
    // The projection is untouched, so the app goes on rendering the plain form.
    expect(await read(`src/generated/${METHOD_NAME}/${DESIGN_MODULE_FILENAME}`)).toBe(
      renderDesignModule(null),
    );
  });

  it("writes nothing when the layout does not fit the method", async () => {
    const unfit = DEMO_JSONL.replace("/inputs/text", "/inputs/renamed");
    expect(await designMethod(deps(unfit), SOURCE)).toBe("failed");

    expect(await exists(`methods/${METHOD_NAME}/${DESIGN_JSONL_FILENAME}`)).toBe(false);
    expect(await read(`methods/${METHOD_NAME}/${REJECTED_FILENAME}`)).toBe(unfit);
  });

  it("fails on an empty answer rather than committing a page with nothing on it", async () => {
    expect(await designMethod(deps("   \n"), SOURCE)).toBe("failed");
    expect(await exists(`methods/${METHOD_NAME}/${DESIGN_JSONL_FILENAME}`)).toBe(false);
  });

  it("clears a stale rejected copy once a run is accepted", async () => {
    await writeFile(path.join(methodsDir, METHOD_NAME, REJECTED_FILENAME), "old\n");
    expect(await designMethod(deps(DEMO_JSONL), SOURCE)).toBe("ok");
    expect(await exists(`methods/${METHOD_NAME}/${REJECTED_FILENAME}`)).toBe(false);
  });
});

describe("checkMethodDesign", () => {
  /** Produce a design into the temp repo, so the check has something current to judge. */
  async function produce(): Promise<void> {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await designMethod(deps(DEMO_JSONL), SOURCE)).toBe("ok");
  }

  it("is current for a method nobody has designed a page for", async () => {
    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result).toEqual({ code: EXIT_CURRENT, problems: [], absent: true });
  });

  it("is current right after a production", async () => {
    await produce();
    expect(await checkMethodDesign(SOURCE, methodsDir, generatedRoot)).toEqual({
      code: EXIT_CURRENT,
      problems: [],
      absent: false,
    });
  });

  it("reports drift when the layout was hand-edited under its record", async () => {
    await produce();
    await writeFile(
      path.join(methodsDir, METHOD_NAME, DESIGN_JSONL_FILENAME),
      `${DEMO_JSONL}\n{"op":"add","path":"/elements/x","value":{"type":"Stack","props":{}}}`,
    );
    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_DRIFT);
    expect(result.problems.join(" ")).toContain("hand-edited");
  });

  it("reports drift when the method has been edited since", async () => {
    await produce();
    const edited: MethodSource = {
      ...SOURCE,
      sourceHashes: { [SOURCE_PATH]: hashSource("something else\n") },
    };
    const result = await checkMethodDesign(edited, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_DRIFT);
    expect(result.problems.join(" ")).toContain("edited since this design was produced");
  });

  it("reports drift when the kernel's catalog prompt has moved under it", async () => {
    await produce();
    const recordPath = path.join(methodsDir, METHOD_NAME, DESIGN_RECORD_FILENAME);
    const record = JSON.parse(await readFile(recordPath, "utf-8"));
    await writeFile(
      recordPath,
      `${JSON.stringify({ ...record, promptHash: "000000000000" }, null, 2)}\n`,
    );

    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_DRIFT);
    expect(result.problems.join(" ")).toContain("npm run design");
  });

  it("reports drift when the projection was never regenerated", async () => {
    await produce();
    await writeFile(path.join(outDir, DESIGN_MODULE_FILENAME), renderDesignModule(null));
    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_DRIFT);
    expect(result.problems.join(" ")).toContain("npm run codegen");
  });

  it("reports drift when a projection carries a design the method no longer has", async () => {
    await produce();
    await rm(path.join(methodsDir, METHOD_NAME, DESIGN_JSONL_FILENAME));
    await rm(path.join(methodsDir, METHOD_NAME, DESIGN_RECORD_FILENAME));
    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_DRIFT);
    expect(result.absent).toBe(true);
  });

  it("gives no verdict on half a design, rather than calling it undesigned", async () => {
    await writeFile(path.join(methodsDir, METHOD_NAME, DESIGN_JSONL_FILENAME), DEMO_JSONL);
    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_NO_VERDICT);
    expect(result.problems.join(" ")).toContain(DESIGN_RECORD_FILENAME);
  });

  it("gives no verdict when the tree has never been generated", async () => {
    await rm(path.join(outDir, DESIGN_MODULE_FILENAME));
    const result = await checkMethodDesign(SOURCE, methodsDir, generatedRoot);
    expect(result.code).toBe(EXIT_NO_VERDICT);
    expect(result.problems.join(" ")).toContain("npm run codegen");
  });
});
