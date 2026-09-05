// @vitest-environment node
//
// Pins `make add-method`, in two layers.
//
// The pure helpers are tabled: each one turns an API payload or a command line
// into a decision the scaffold then writes into a file, so a wrong answer here
// is a wrong file rather than an error. The orchestration is exercised over a
// fake client and a temporary skeleton — what matters there is the ORDERING the
// design rests on: every refusal happens in the read-only half, with nothing on
// disk changed.
//
// Everything the API returns is a recorded fixture (`./fixtures/`), never
// re-fetched. The one thing read from the real repo is `ExampleTabs.tsx`: the
// anchor test exists precisely to fail the day a template edit moves an anchor.

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ApiResponseError, runCodegenCheck, type PipelexApiClient } from "@pipelex/sdk";

import {
  AddMethodError,
  addressSegments,
  allowedMimesFor,
  bindOutput,
  camelCase,
  choosePipe,
  contractFor,
  descriptorFor,
  fileInputsOf,
  hasGatingInput,
  humanize,
  IMPORTS_ANCHOR,
  insertTab,
  kebabCase,
  parseArgs,
  parseMethodArg,
  pascalCase,
  renderManifest,
  runAddMethod,
  scaffoldNames,
  scaffoldPaths,
  slugSource,
  TABS_ANCHOR,
  type ScaffoldPlan,
} from "./add-method.mts";
import { renderAction, renderActionTest, renderAdapter, renderForm } from "./add-method.mts";
import { MANIFEST_FILENAME, REPO_ROOT } from "./shared.mts";
import {
  DOCUMENTS_CONTRACTS,
  DOCUMENTS_INPUT_FORM,
  TEXT_STATS_ARTIFACTS,
  TEXT_STATS_CONTRACTS,
  TEXT_STATS_INPUT_FORM,
  TEXT_STATS_LOCK,
} from "./fixtures/add-method-fixtures.mts";

// The recorded artifacts are trimmed to their export lines and so carry no
// codegen stamp, which `fetchGenerated`'s self-verify would call `hand-edited`.
// That check has its own tests in `generate.test.mts`; here it is noise, so it
// is the one thing mocked — the rest of the SDK stays real, because
// `readGeneratedTree` depends on `isStampableArtifactPath` to keep
// `sources.json` out of the artifact set.
vi.mock("@pipelex/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pipelex/sdk")>();
  return { ...actual, runCodegenCheck: vi.fn() };
});

const TEXT_STATS_REF = "github.com/Pipelex/methods/text_stats@v0.1.1";

// ── The selector ────────────────────────────────────────────────────────────

describe("parseMethodArg", () => {
  it.each([
    [
      "mt_ca0aa9d3-61ac-4db1-8b46-fb0cc75787df",
      { method_id: "mt_ca0aa9d3-61ac-4db1-8b46-fb0cc75787df" },
    ],
    [TEXT_STATS_REF, { method_ref: TEXT_STATS_REF }],
    ["github.com/Pipelex/methods", { method_ref: "github.com/Pipelex/methods" }],
    // The https:// prefix and a trailing slash are normalized away, so the
    // manifest and the run always name the address in one form.
    [`https://${TEXT_STATS_REF}`, { method_ref: TEXT_STATS_REF }],
    [
      "github.com/Pipelex/methods/documents/",
      { method_ref: "github.com/Pipelex/methods/documents" },
    ],
    ["  github.com/o/r  ", { method_ref: "github.com/o/r" }],
  ])("parses %s", (arg, expected) => {
    expect(parseMethodArg(arg)).toEqual(expected);
  });

  it.each([
    ["", "empty"],
    ["mt_", "malformed id"],
    ["mt_bad id", "id with a space"],
    ["github.com/Pipelex", "address with no repository"],
    ["methods/text_stats", "path that is not an address"],
    ["github.com/o/r@v1@v2", "two tags"],
    ["../../etc/passwd", "a path"],
  ])("refuses %s (%s)", (arg) => {
    expect(() => parseMethodArg(arg)).toThrow(AddMethodError);
  });
});

describe("addressSegments", () => {
  it("strips the tag", () => {
    expect(addressSegments(TEXT_STATS_REF)).toEqual([
      "github.com",
      "Pipelex",
      "methods",
      "text_stats",
    ]);
  });
});

// ── Names ───────────────────────────────────────────────────────────────────

describe("the name derivations", () => {
  it.each([
    ["text_stats", "text-stats"],
    ["CV screening", "cv-screening"],
    ["Test-1", "test-1"],
    ["pipelex_mcp_e2e_fixture", "pipelex-mcp-e2e-fixture"],
    ["  Create   moodboard  ", "create-moodboard"],
  ])("kebab-cases %s", (input, expected) => {
    expect(kebabCase(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["---", "punctuation only"],
    ["🙂", "no ASCII at all"],
  ])("refuses %s (%s), pointing at --name", (input) => {
    expect(() => kebabCase(input)).toThrow(/--name/);
  });

  it("derives the identifiers and the label from the slug", () => {
    expect(pascalCase("text-stats")).toBe("TextStats");
    expect(camelCase("text-stats")).toBe("textStats");
    expect(humanize("text-stats")).toBe("Text stats");
    expect(scaffoldNames("text-stats")).toEqual({
      slug: "text-stats",
      pascal: "TextStats",
      camel: "textStats",
      label: "Text stats",
    });
    expect(scaffoldNames("text-stats", "Word counts").label).toBe("Word counts");
  });

  it("takes the slug from the package, and the repo when the address names none", () => {
    expect(slugSource({ method_ref: TEXT_STATS_REF })).toBe("text_stats");
    expect(slugSource({ method_ref: "github.com/Pipelex/methods" })).toBe("methods");
  });

  it("takes a stored method's slug from its catalog name — a person chose it", () => {
    expect(slugSource({ method_id: "mt_x" }, "CV screening")).toBe("CV screening");
    expect(() => slugSource({ method_id: "mt_x" }, "")).toThrow(/--name/);
  });

  it("puts every emitted file where the four hand-written examples live", () => {
    expect(scaffoldPaths(scaffoldNames("text-stats"))).toEqual({
      manifestDir: "methods/text-stats",
      manifest: "methods/text-stats/method.json",
      generatedDir: "src/generated/text-stats",
      adapter: "src/types/textStatsPipeline.ts",
      action: "src/actions/runTextStatsPipeline.ts",
      actionTest: "src/actions/runTextStatsPipeline.test.ts",
      form: "src/components/TextStatsForm.tsx",
      tabs: "src/components/ExampleTabs.tsx",
    });
  });
});

// ── The pipe rule ───────────────────────────────────────────────────────────

describe("choosePipe", () => {
  it("takes the single pipe when a method declares exactly one", () => {
    expect(choosePipe(TEXT_STATS_CONTRACTS, null)).toEqual({
      ref: "text_stats.analyze_text",
      domain: "text_stats",
      code: "analyze_text",
    });
  });

  it("reads default_pipe_ref, which a package manifest fills where main_pipe is null", () => {
    // `github.com/Pipelex/methods/documents` — measured: seven pipes, no
    // bundle-level main_pipe, and a default all the same.
    expect(choosePipe(DOCUMENTS_CONTRACTS, "documents.extract_document_markdown").ref).toBe(
      "documents.extract_document_markdown",
    );
  });

  it("takes an explicit --pipe, qualified or bare", () => {
    expect(choosePipe(DOCUMENTS_CONTRACTS, null, "documents.extract_text_pages").code).toBe(
      "extract_text_pages",
    );
    expect(choosePipe(DOCUMENTS_CONTRACTS, null, "extract_text_pages").ref).toBe(
      "documents.extract_text_pages",
    );
  });

  it("refuses a --pipe the method does not declare, listing what it does", () => {
    expect(() => choosePipe(DOCUMENTS_CONTRACTS, null, "nope")).toThrow(
      /not a pipe this method declares/,
    );
    expect(() => choosePipe(DOCUMENTS_CONTRACTS, null, "nope")).toThrow(
      /documents.extract_document_text/,
    );
  });

  it("refuses several pipes with no default rather than guessing", () => {
    expect(() => choosePipe(DOCUMENTS_CONTRACTS, null)).toThrow(/pass --pipe/);
  });

  it("refuses a default the contract map does not carry", () => {
    expect(() => choosePipe(DOCUMENTS_CONTRACTS, "documents.gone")).toThrow(/not among the pipes/);
  });

  it("refuses a method with no pipes at all", () => {
    expect(() => choosePipe({}, null)).toThrow(/no pipes/);
  });
});

describe("contractFor / descriptorFor", () => {
  const pipe = { ref: "text_stats.analyze_text", domain: "text_stats", code: "analyze_text" };

  it("finds both by qualified ref", () => {
    expect(contractFor(TEXT_STATS_CONTRACTS, pipe).output.concept_ref).toBe("native.Text");
    expect(descriptorFor(TEXT_STATS_INPUT_FORM, pipe).fields).toHaveLength(1);
  });

  it("refuses a descriptor the report did not carry — the form would render empty", () => {
    expect(() => descriptorFor({}, pipe)).toThrow(/no input-form descriptor/);
  });
});

// ── The output binding ──────────────────────────────────────────────────────

describe("bindOutput", () => {
  const single = contractFor(TEXT_STATS_CONTRACTS, {
    ref: "text_stats.analyze_text",
    domain: "text_stats",
    code: "analyze_text",
  });

  it("binds a single output to the concept's generated exports", () => {
    expect(bindOutput(single, TEXT_STATS_ARTIFACTS)).toEqual({
      conceptCode: "Text",
      plural: false,
    });
  });

  it("flags a plural output — it arrives as a { items: [...] } envelope", () => {
    const plural = contractFor(DOCUMENTS_CONTRACTS, {
      ref: "documents.extract_text_pages",
      domain: "documents",
      code: "extract_text_pages",
    });
    expect(
      bindOutput(plural, [
        { path: "types.ts", content: "export const PageSchema = 1;\n" },
        { path: "binder.ts", content: "export function parsePage(w: unknown) {}\n" },
      ]),
    ).toEqual({ conceptCode: "Page", plural: true });
  });

  it("refuses when the emitter names the export something else, rather than writing a type error", () => {
    expect(() =>
      bindOutput(single, [
        { path: "types.ts", content: "export const SomethingElse = 1;\n" },
        { path: "binder.ts", content: "export function parseText(w: unknown) {}\n" },
      ]),
    ).toThrow(/exports no TextSchema/);
  });

  it("refuses when the codegen response carries no types.ts to bind against", () => {
    expect(() => bindOutput(single, [])).toThrow(/no types.ts/);
  });
});

// ── File inputs ─────────────────────────────────────────────────────────────

describe("fileInputsOf", () => {
  it("finds nothing in a text-only method", () => {
    expect(fileInputsOf(TEXT_STATS_INPUT_FORM["text_stats.analyze_text"]!)).toEqual([]);
  });

  it("finds a top-level document input", () => {
    expect(fileInputsOf(DOCUMENTS_INPUT_FORM["documents.extract_text_pages"]!)).toEqual([
      { path: "document", kind: "document" },
    ]);
  });

  it("finds a file inside a list or a structured input, at its dotted path", () => {
    // Depth changes nothing about what is scaffolded: `checkFileInputs` walks
    // the same descriptor, so a nested position is gated like a top-level one.
    const files = fileInputsOf({
      fields: [
        {
          kind: "list",
          name: "cvs",
          concept_ref: "native.Document",
          description: null,
          required: true,
          presence: "plain",
          gating: false,
          item: { kind: "document", concept_ref: "native.Document", description: null },
        },
        {
          kind: "object",
          name: "packet",
          concept_ref: "demo.Packet",
          description: null,
          required: true,
          presence: "plain",
          gating: true,
          fields: [
            {
              kind: "document",
              name: "scan",
              concept_ref: "native.Document",
              description: null,
            },
            {
              kind: "list",
              name: "shots",
              concept_ref: "native.Image",
              description: null,
              item: { kind: "image", concept_ref: "native.Image", description: null },
            },
          ],
        },
      ],
    } as never);
    expect(files).toEqual([
      { path: "cvs[]", kind: "document" },
      { path: "packet.scan", kind: "document" },
      { path: "packet.shots[]", kind: "image" },
    ]);
  });
});

describe("allowedMimesFor", () => {
  it("maps each file kind to the types the action accepts", () => {
    expect(allowedMimesFor([{ path: "d", kind: "document" }])).toEqual(["application/pdf"]);
    expect(allowedMimesFor([{ path: "i", kind: "image" }])).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    expect(
      allowedMimesFor([
        { path: "d", kind: "document" },
        { path: "shots[]", kind: "image" },
      ]),
    ).toEqual(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  });
});

describe("hasGatingInput", () => {
  it("decides which of the two fixture-free tests the scaffold emits", () => {
    expect(hasGatingInput(TEXT_STATS_INPUT_FORM["text_stats.analyze_text"]!)).toBe(true);
    expect(hasGatingInput({ fields: [] })).toBe(false);
  });
});

// ── The command line ────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("takes the method positionally and the rest as flags", () => {
    expect(
      parseArgs([TEXT_STATS_REF, "--pipe", "analyze_text", "--name", "stats", "--dry-run"]),
    ).toEqual({
      method: TEXT_STATS_REF,
      pipe: "analyze_text",
      name: "stats",
      label: undefined,
      dryRun: true,
    });
  });

  it("refuses a swallowed value — `--label --dry-run` must not turn a rehearsal real", () => {
    expect(() => parseArgs([TEXT_STATS_REF, "--label", "--dry-run"])).toThrow(/missing value/);
  });

  it.each([
    [[TEXT_STATS_REF, "--nope"], /unknown argument/],
    [[TEXT_STATS_REF, "another"], /second method/],
    [["--dry-run"], /no method given/],
  ])("refuses %s", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

// ── The tab ─────────────────────────────────────────────────────────────────

describe("insertTab", () => {
  const ENTRY = { id: "demo", label: "Demo", componentName: "DemoForm" };

  /** The real file — this is the test that fails the day a template edit moves an anchor. */
  async function realTabs(): Promise<string> {
    return readFile(path.join(REPO_ROOT, "src", "components", "ExampleTabs.tsx"), "utf-8");
  }

  it("inserts one import and one entry into the real ExampleTabs.tsx", async () => {
    const source = await realTabs();
    const updated = insertTab(source, ENTRY);

    expect(updated).toContain('import { DemoForm } from "./DemoForm";');
    expect(updated).toContain('{ id: "demo", label: "Demo", Component: DemoForm },');
    // Both anchors survive, in order, so the next scaffold run still finds them.
    expect(updated.indexOf(IMPORTS_ANCHOR)).toBeGreaterThan(-1);
    expect(updated.indexOf(TABS_ANCHOR)).toBeGreaterThan(updated.indexOf(IMPORTS_ANCHOR));
    // The import lands above its anchor and the entry inside the array.
    expect(updated.indexOf("import { DemoForm }")).toBeLessThan(updated.indexOf(IMPORTS_ANCHOR));
    expect(updated.indexOf('{ id: "demo"')).toBeLessThan(updated.indexOf(TABS_ANCHOR));
    // One line added at each anchor, and nothing else touched.
    expect(updated.split("\n")).toHaveLength(source.split("\n").length + 2);
  });

  it.each([IMPORTS_ANCHOR, TABS_ANCHOR])(
    "refuses a source with %s missing, naming it",
    async (anchor) => {
      const source = (await realTabs())
        .split("\n")
        .filter((line) => !line.includes(anchor))
        .join("\n");
      expect(() => insertTab(source, ENTRY)).toThrow(anchor);
    },
  );

  it("refuses a duplicate tab id and a duplicate component, pointing at --name", async () => {
    const source = await realTabs();
    expect(() => insertTab(source, { ...ENTRY, id: "text" })).toThrow(/--name/);
    expect(() => insertTab(source, { ...ENTRY, componentName: "EntityForm" })).toThrow(/--name/);
  });
});

// ── The templates ───────────────────────────────────────────────────────────

const TEXT_STATS_PLAN: ScaffoldPlan = {
  names: scaffoldNames("text-stats"),
  selector: { method_ref: TEXT_STATS_REF },
  pipe: { ref: "text_stats.analyze_text", domain: "text_stats", code: "analyze_text" },
  binding: { conceptCode: "Text", plural: false },
  files: [],
  gating: true,
};

/** The plural + document variant, built from the `documents` measurements. */
const DOCUMENTS_PLAN: ScaffoldPlan = {
  names: scaffoldNames("documents", "Document pages"),
  selector: { method_id: "mt_ca0aa9d3-61ac-4db1-8b46-fb0cc75787df" },
  pipe: { ref: "documents.extract_text_pages", domain: "documents", code: "extract_text_pages" },
  binding: { conceptCode: "Page", plural: true },
  files: [{ path: "document", kind: "document" }],
  gating: true,
};

describe("renderManifest", () => {
  it("holds the selector and nothing else", () => {
    expect(renderManifest({ method_ref: TEXT_STATS_REF })).toBe(
      `{\n  "method_ref": "${TEXT_STATS_REF}"\n}\n`,
    );
  });
});

describe("renderAdapter", () => {
  it("hands wireOutput to the method's own generated binder", () => {
    const source = renderAdapter(TEXT_STATS_PLAN);
    expect(source).toContain('import { parseText } from "@/generated/text-stats/binder";');
    expect(source).toContain("export type TextStatsOutput = Text;");
    expect(source).toContain("return parseText(wireOutput(results, TextSchema));");
    expect(source).toContain("throw new BadPipelineOutputError(");
    // No shape is declared: if this file lists fields, it duplicates the method.
    expect(source).not.toMatch(/z\.object\(\{\s*\w+:/);
  });

  it("wraps a plural output in the list envelope the runtime actually returns", () => {
    const source = renderAdapter(DOCUMENTS_PLAN);
    expect(source).toContain(
      "const DocumentsOutputSchema = z.object({ items: z.array(PageSchema) });",
    );
    expect(source).toContain(
      "DocumentsOutputSchema.parse(wireOutput(results, DocumentsOutputSchema))",
    );
    // The single-value binder is deliberately not used on this arm.
    expect(source).not.toContain("parsePage(");
  });
});

describe("renderAction", () => {
  it("sends the selector in place of an inline bundle, with the bare pipe code", () => {
    const source = renderAction(TEXT_STATS_PLAN);
    expect(source).toContain(`const METHOD_REF = "${TEXT_STATS_REF}";`);
    expect(source).toContain('const PIPE_CODE = "analyze_text";');
    expect(source).toContain('requireContract(PIPE_IO_CONTRACTS, "text_stats", PIPE_CODE)');
    expect(source).toContain("method_ref: METHOD_REF,");
    // No bundle loader, and no hand-guard beside the gate.
    expect(source).not.toContain("loadBundle");
    expect(source).not.toContain("mthds_contents");
    expect(source).toContain("const gated = gateRunInputs(CONTRACT, data);");
    for (const name of ["runTextStatsBlocking", "startTextStatsRun", "pollTextStatsRun"]) {
      expect(source).toContain(`export async function ${name}`);
    }
  });

  it("adds the file gate and prepareInputs when the method takes a file", () => {
    const source = renderAction(DOCUMENTS_PLAN);
    expect(source).toContain('const ALLOWED_MIMES = ["application/pdf"];');
    // The file gate walks the pipe's wire descriptor, the same one the form is
    // rendered from — so the action looks it up beside the contract.
    expect(source).toContain(
      'import { INPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/documents/contracts";',
    );
    expect(source).toContain(
      'const DESCRIPTOR = requireInputForm(INPUT_FORM, "documents", PIPE_CODE);',
    );
    expect(source).toContain("checkFileInputs(DESCRIPTOR, gated.inputs, {");
    // prepareInputs keys on the QUALIFIED ref — a bare pipe code is refused.
    expect(source).toContain('const PIPE_REF = "documents.extract_text_pages";');
    expect(source).toContain("pipe_ref: PIPE_REF,");
    expect(source).toContain("method_id: METHOD_ID,");
    // The file gate runs over the GATED inputs, never beside the gate — so
    // inside `gateInputs` the shape gate comes first and short-circuits.
    const gate = source.slice(source.indexOf("function gateInputs("));
    expect(gate.indexOf("gateRunInputs(CONTRACT, data)")).toBeLessThan(
      gate.indexOf("checkFileInputs(DESCRIPTOR, gated.inputs"),
    );
  });

  it("scaffolds the same file path for a file below the top level", () => {
    // A `cvs: Document[]` slice is gated, uploaded and dropped into exactly like
    // a top-level document — the descriptor walk reaches every position.
    const source = renderAction({
      ...DOCUMENTS_PLAN,
      files: [{ path: "cvs[]", kind: "document" }],
    });
    expect(source).toContain('const ALLOWED_MIMES = ["application/pdf"];');
    expect(source).toContain("checkFileInputs(DESCRIPTOR, gated.inputs, {");
    expect(source).toContain("prepareInputs({");
  });
});

describe("renderActionTest", () => {
  it("pins the trust boundary for a gating pipe, and nothing it would have to invent", () => {
    const source = renderActionTest(TEXT_STATS_PLAN);
    expect(source).toContain("refuses an empty submission before calling the SDK (blocking)");
    expect(source).toContain("expect(execute).not.toHaveBeenCalled();");
    expect(source).not.toContain("execute.mockResolvedValue");
  });

  it("pins the wiring instead when the pipe gates on nothing", () => {
    const source = renderActionTest({ ...TEXT_STATS_PLAN, gating: false });
    expect(source).toContain("expect(execute).toHaveBeenCalledWith({");
    expect(source).toContain(`method_ref: "${TEXT_STATS_REF}",`);
    expect(source).toContain('pipe_code: "analyze_text",');
  });
});

describe("renderForm", () => {
  it("writes no input markup — the descriptor declares the fields", () => {
    const source = renderForm(TEXT_STATS_PLAN);
    expect(source).toContain("useRunInputs(CONTRACT, DESCRIPTOR)");
    expect(source).toContain("<RunInputsForm");
    expect(source).toContain("<JsonResult value={state.output}");
    for (const tag of ["<textarea", "<input", "<select"]) expect(source).not.toContain(tag);
  });

  it("wires the kernel's file seam through useFileInputs when the method takes a file", () => {
    const source = renderForm(DOCUMENTS_PLAN);
    expect(source).toContain('import { useFileInputs } from "@/hooks/useFileInputs";');
    expect(source).toContain("env={{ onDropFile: dropFile, uploadingIds: encodingIds }}");
    expect(source).toContain("{fileError && <ErrorDisplay error={fileError} />}");
  });
});

// ── The orchestration ───────────────────────────────────────────────────────
//
// What is worth pinning here is not the writing (the templates above cover
// that, and `writeTree` has its own tests) but the ORDERING the design rests
// on: every refusal happens in the read-only half, having written nothing.

describe("runAddMethod", () => {
  let root: string;

  /** A skeleton with just enough of the repo for the gesture to land in. */
  async function skeleton(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "add-method-"));
    for (const relative of [
      "methods",
      "src/generated",
      "src/types",
      "src/actions",
      "src/components",
    ]) {
      await mkdir(path.join(dir, relative), { recursive: true });
    }
    // The real file, minus the slice the template itself ships — which is the
    // state this gesture is designed to run against. Filtered rather than
    // fabricated, so the anchors under test stay exactly the ones on disk.
    const tabs = await readFile(
      path.join(REPO_ROOT, "src", "components", "ExampleTabs.tsx"),
      "utf-8",
    );
    await writeFile(
      path.join(dir, "src", "components", "ExampleTabs.tsx"),
      tabs
        .split("\n")
        .filter((line) => !line.includes("TextStatsForm"))
        .join("\n"),
      "utf-8",
    );
    return dir;
  }

  function fakeClient(overrides: Record<string, unknown> = {}) {
    return {
      version: vi.fn().mockResolvedValue({ extensions: ["runs", "method_id", "method_ref"] }),
      getMethod: vi.fn().mockResolvedValue({ name: "pipelex_mcp_e2e_fixture" }),
      codegen: vi.fn().mockResolvedValue({
        is_valid: true,
        artifacts: TEXT_STATS_ARTIFACTS,
        lock: TEXT_STATS_LOCK,
        lock_filename: "codegen.lock",
        crate_fingerprint: "28f776a299e6ab8d2c14fafae459f5daa50bd030ee1191d149e566f0f37d38e2",
        engine_version: "0.56.0",
      }),
      validate: vi.fn().mockResolvedValue({
        is_valid: true,
        pipe_io_contracts: TEXT_STATS_CONTRACTS,
        input_form: TEXT_STATS_INPUT_FORM,
        default_pipe_ref: "text_stats.analyze_text",
      }),
      validateFiles: vi.fn(),
      ...overrides,
    } as unknown as Pick<
      PipelexApiClient,
      "codegen" | "validate" | "validateFiles" | "version" | "getMethod"
    > & { codegen: Mock; validate: Mock; version: Mock; getMethod: Mock };
  }

  function deps(client = fakeClient()) {
    return { repoRoot: root, client, baseUrl: "https://api.example" };
  }

  beforeEach(async () => {
    root = await skeleton();
    (runCodegenCheck as unknown as Mock).mockResolvedValue({ drifts: [], isCurrent: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  /** Every path the gesture creates, relative to the skeleton, sorted. */
  async function written(): Promise<string[]> {
    const found: string[] = [];
    async function walkInto(relative: string): Promise<void> {
      for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await walkInto(child);
        else found.push(child.replace(/^\//, ""));
      }
    }
    await walkInto("");
    return found.sort();
  }

  it("writes the manifest, the tree and the four app files, and edits the tab switcher", async () => {
    expect(await runAddMethod([TEXT_STATS_REF], deps())).toBe(0);

    expect(await written()).toEqual([
      `methods/text-stats/${MANIFEST_FILENAME}`,
      "src/actions/runTextStatsPipeline.test.ts",
      "src/actions/runTextStatsPipeline.ts",
      "src/components/ExampleTabs.tsx",
      "src/components/TextStatsForm.tsx",
      "src/generated/text-stats/binder.ts",
      "src/generated/text-stats/codegen.lock",
      "src/generated/text-stats/contracts.ts",
      "src/generated/text-stats/sources.json",
      "src/generated/text-stats/types.ts",
      "src/types/textStatsPipeline.ts",
    ]);
    expect(await readFile(path.join(root, "methods/text-stats", MANIFEST_FILENAME), "utf-8")).toBe(
      `{\n  "method_ref": "${TEXT_STATS_REF}"\n}\n`,
    );
    const tabs = await readFile(path.join(root, "src/components/ExampleTabs.tsx"), "utf-8");
    expect(tabs).toContain('import { TextStatsForm } from "./TextStatsForm";');
    expect(tabs).toContain('{ id: "text-stats", label: "Text stats", Component: TextStatsForm }');
  });

  it("records the manifest's own hash as the tree's source — that is the staleness gate", async () => {
    await runAddMethod([TEXT_STATS_REF], deps());

    const sidecar: unknown = JSON.parse(
      await readFile(path.join(root, "src/generated/text-stats/sources.json"), "utf-8"),
    );
    expect(sidecar).toMatchObject({
      sources: { [`methods/text-stats/${MANIFEST_FILENAME}`]: expect.any(String) },
    });
  });

  it("is one-shot: a second run is refused on the collision, changing nothing", async () => {
    await runAddMethod([TEXT_STATS_REF], deps());
    const before = await written();
    const tabsBefore = await readFile(path.join(root, "src/components/ExampleTabs.tsx"), "utf-8");

    expect(await runAddMethod([TEXT_STATS_REF], deps())).toBe(1);

    expect(await written()).toEqual(before);
    expect(await readFile(path.join(root, "src/components/ExampleTabs.tsx"), "utf-8")).toBe(
      tabsBefore,
    );
  });

  it("takes --name and --label, and --name is what makes a second slice possible", async () => {
    await runAddMethod([TEXT_STATS_REF], deps());
    expect(
      await runAddMethod(
        [TEXT_STATS_REF, "--name", "word-counts", "--label", "Word counts"],
        deps(),
      ),
    ).toBe(0);

    const tabs = await readFile(path.join(root, "src/components/ExampleTabs.tsx"), "utf-8");
    expect(tabs).toContain(
      '{ id: "word-counts", label: "Word counts", Component: WordCountsForm }',
    );
  });

  it("names a stored method's slice after its catalog name", async () => {
    const client = fakeClient();
    expect(await runAddMethod(["mt_ca0aa9d3-61ac-4db1-8b46-fb0cc75787df"], deps(client))).toBe(0);

    expect(client.getMethod).toHaveBeenCalledWith("mt_ca0aa9d3-61ac-4db1-8b46-fb0cc75787df");
    expect(await written()).toContain("src/components/PipelexMcpE2eFixtureForm.tsx");
    const action = await readFile(
      path.join(root, "src/actions/runPipelexMcpE2eFixturePipeline.ts"),
      "utf-8",
    );
    expect(action).toContain('const METHOD_ID = "mt_ca0aa9d3-61ac-4db1-8b46-fb0cc75787df";');
  });

  it("--dry-run stops at the end of the read-only half, writing nothing", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));

    expect(await runAddMethod([TEXT_STATS_REF, "--dry-run"], deps())).toBe(0);

    expect(await written()).toEqual(["src/components/ExampleTabs.tsx"]);
    expect(lines.join("\n")).toContain("text_stats.analyze_text");
    expect(lines.join("\n")).toContain("Nothing was written");
  });

  it("refuses a base URL that does not forward the selector, before any fetch", async () => {
    const client = fakeClient({
      version: vi.fn().mockResolvedValue({ extensions: ["runs", "method_id"] }),
    });

    expect(await runAddMethod([TEXT_STATS_REF], deps(client))).toBe(1);

    expect(client.codegen).not.toHaveBeenCalled();
    expect(client.validate).not.toHaveBeenCalled();
    expect(await written()).toEqual(["src/components/ExampleTabs.tsx"]);
  });

  it("refuses an unresolvable selector with the server's own message, writing nothing", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation(
      (line: unknown) => void errors.push(String(line)),
    );
    const client = fakeClient({
      codegen: vi
        .fn()
        .mockRejectedValue(
          new ApiResponseError(
            "API POST /v1/codegen failed (404)",
            "https://api.example/v1/codegen",
            404,
            "Not Found",
            "{}",
            "MethodPackageNotFoundError",
            "No package at address 'github.com/Pipelex/methods/__nope__'.",
            undefined,
            undefined,
          ),
        ),
    });

    expect(await runAddMethod(["github.com/Pipelex/methods/__nope__"], deps(client))).toBe(1);

    expect(errors.join("\n")).toContain("No package at address");
    expect(await written()).toEqual(["src/components/ExampleTabs.tsx"]);
  });

  it("refuses a multi-pipe method that names no default, listing the pipes", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation(
      (line: unknown) => void errors.push(String(line)),
    );
    const client = fakeClient({
      validate: vi.fn().mockResolvedValue({
        is_valid: true,
        pipe_io_contracts: DOCUMENTS_CONTRACTS,
        input_form: DOCUMENTS_INPUT_FORM,
        default_pipe_ref: null,
      }),
    });

    expect(await runAddMethod(["github.com/Pipelex/methods/documents"], deps(client))).toBe(1);

    expect(errors.join("\n")).toContain("pass --pipe");
    expect(errors.join("\n")).toContain("documents.extract_text_pages");
    // The tree fetch happened (the pipe rule reads the validate report), but the
    // refusal still landed before the write half.
    expect(await written()).toEqual(["src/components/ExampleTabs.tsx"]);
  });

  it("scaffolds the whole file path for a file below the top level, and warns of nothing", async () => {
    // A file inside a structured or list input used to be a scaffold-time
    // warning, because the action's gate could not reach it. The gate now walks
    // the descriptor, so the slice gets the gate, the upload and the drop seam
    // like a top-level document — and the plan names the position instead.
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    const client = fakeClient({
      validate: vi.fn().mockResolvedValue({
        is_valid: true,
        pipe_io_contracts: TEXT_STATS_CONTRACTS,
        input_form: {
          "text_stats.analyze_text": {
            fields: [
              {
                kind: "object",
                name: "packet",
                concept_ref: "demo.Packet",
                description: null,
                required: true,
                presence: "plain",
                gating: true,
                fields: [
                  {
                    kind: "document",
                    name: "scan",
                    concept_ref: "native.Document",
                    description: null,
                  },
                ],
              },
            ],
          },
        },
        default_pipe_ref: "text_stats.analyze_text",
      }),
    });

    expect(await runAddMethod([TEXT_STATS_REF], deps(client))).toBe(0);

    const printed = lines.join("\n");
    expect(printed).toContain("files:  packet.scan");
    expect(printed).not.toContain("handle it yourself");

    const action = await readFile(
      path.join(root, "src", "actions", "runTextStatsPipeline.ts"),
      "utf-8",
    );
    expect(action).toContain("checkFileInputs(DESCRIPTOR, gated.inputs, {");
    const form = await readFile(path.join(root, "src", "components", "TextStatsForm.tsx"), "utf-8");
    expect(form).toContain("useFileInputs");
  });

  it("refuses a tab switcher whose anchor is gone, before writing anything", async () => {
    const tabsPath = path.join(root, "src/components/ExampleTabs.tsx");
    const stripped = (await readFile(tabsPath, "utf-8"))
      .split("\n")
      .filter((line) => !line.includes(TABS_ANCHOR))
      .join("\n");
    await writeFile(tabsPath, stripped, "utf-8");

    expect(await runAddMethod([TEXT_STATS_REF], deps())).toBe(1);

    expect(await written()).toEqual(["src/components/ExampleTabs.tsx"]);
    expect(await readFile(tabsPath, "utf-8")).toBe(stripped);
  });
});
