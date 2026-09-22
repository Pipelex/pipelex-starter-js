import { describe, it, expect } from "vitest";
import type { PipeInputFormDescriptor } from "@pipelex/sdk";
import {
  MAX_PDF_BYTES,
  checkFileInputs,
  dataUrlByteLength,
  dataUrlMimeType,
  fileInputErrorToPipelineError,
  validateDataUrl,
} from "./fileEncoding";

const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQK";

describe("dataUrlMimeType", () => {
  it("extracts the MIME type from a base64 data URL", () => {
    expect(dataUrlMimeType(PDF_DATA_URL)).toBe("application/pdf");
    expect(dataUrlMimeType("data:image/png;base64,AAAA")).toBe("image/png");
  });

  it("returns null for non-data-URL strings", () => {
    expect(dataUrlMimeType("https://example.com/file.pdf")).toBeNull();
    expect(dataUrlMimeType("")).toBeNull();
    // A non-base64 data URL is not accepted.
    expect(dataUrlMimeType("data:text/plain,plain")).toBeNull();
  });
});

describe("dataUrlByteLength", () => {
  it("computes decoded length from base64 length and padding", () => {
    // "JVBERi0=" → 8 chars, 1 pad → 5 bytes ("%PDF-").
    expect(dataUrlByteLength("data:application/pdf;base64,JVBERi0=")).toBe(5);
    // "JVBERi0xLjQK" → 12 chars, no pad → 9 bytes.
    expect(dataUrlByteLength(PDF_DATA_URL)).toBe(9);
  });

  it("returns 0 when there is no payload", () => {
    expect(dataUrlByteLength("no-comma-here")).toBe(0);
    expect(dataUrlByteLength("data:application/pdf;base64,")).toBe(0);
  });
});

describe("validateDataUrl", () => {
  const opts = { allowedMimes: ["application/pdf"], maxBytes: MAX_PDF_BYTES };

  it("returns null for a valid PDF data URL", () => {
    expect(validateDataUrl(PDF_DATA_URL, opts)).toBeNull();
  });

  it("rejects a non-data-URL string", () => {
    const result = validateDataUrl("https://example.com/x.pdf", opts);
    expect(result?.kind).toBe("unsupported_file_type");
  });

  it("rejects a disallowed MIME type", () => {
    const result = validateDataUrl("data:image/png;base64,AAAA", opts);
    expect(result?.kind).toBe("unsupported_file_type");
    expect(result?.message).toContain("image/png");
  });

  it("rejects a file over the size cap", () => {
    const result = validateDataUrl(PDF_DATA_URL, {
      allowedMimes: ["application/pdf"],
      maxBytes: 4,
    });
    expect(result?.kind).toBe("file_too_large");
    expect(result?.message).toMatch(/limit/);
  });

  it("rejects a malformed base64 payload", () => {
    // `@@@@` matches MIME and would pass the size cap, but isn't valid base64.
    const result = validateDataUrl("data:application/pdf;base64,@@@@", opts);
    expect(result?.kind).toBe("unsupported_file_type");
    expect(result?.message).toMatch(/base64/i);
  });

  it("rejects base64 with wrong padding", () => {
    // Base64 padding only appears at the very end; embedded `==` is invalid.
    const result = validateDataUrl("data:application/pdf;base64,AB==A===", opts);
    expect(result?.kind).toBe("unsupported_file_type");
  });

  it("rejects a payload whose length is not a multiple of four", () => {
    // The `% 4` rule is a separate half of `isBase64Payload` from the alphabet
    // test, and this is the only fixture that tells them apart: the alphabet
    // and the padding here are both valid, so deleting the length check leaves
    // every other case in this file green.
    const result = validateDataUrl("data:application/pdf;base64,AAAAA", opts);
    expect(result?.kind).toBe("unsupported_file_type");
    expect(result?.message).toMatch(/base64/i);
  });

  it("handles a payload large enough to have overflowed the old shape regex", () => {
    // The previous group-repetition regex threw `RangeError: Maximum call stack
    // size exceeded` above ~4.47 M payload characters, so every PDF between
    // 3.2 MB and the 8 MB cap crashed the Server Action instead of running.
    // 6 MB decoded: comfortably past that threshold, comfortably under the cap.
    const payload = "A".repeat(8 * 1024 * 1024); // 8 M chars → 6 MB decoded.
    expect(validateDataUrl(`data:application/pdf;base64,${payload}`, opts)).toBeNull();
  });

  it("reports a file over the cap rather than inspecting its payload", () => {
    // Size is checked first, so `file_too_large` is reachable for a payload big
    // enough that the old ordering would have crashed on the way to it.
    const result = validateDataUrl(`data:application/pdf;base64,${"A".repeat(16 * 1024 * 1024)}`, {
      allowedMimes: ["application/pdf"],
      maxBytes: MAX_PDF_BYTES,
    });
    expect(result?.kind).toBe("file_too_large");
  });
});

describe("checkFileInputs", () => {
  const opts = { allowedMimes: ["application/pdf"], maxBytes: MAX_PDF_BYTES };

  // Descriptor nodes in the wire shape `POST /v1/validate` returns — the same
  // artifact `INPUT_FORM` in a generated `contracts.ts` carries. The gate is
  // typed on the standard's closed shapes, so the fixtures cast to it.
  const DOCUMENT = { kind: "document", concept_ref: "native.Document", required: true } as const;
  const top = (name: string, node: Record<string, unknown>): Record<string, unknown> => ({
    ...node,
    name,
    required: true,
    presence: "plain",
    gating: true,
  });
  const descriptor = (...fields: unknown[]): PipeInputFormDescriptor =>
    ({ fields }) as PipeInputFormDescriptor;

  /** One top-level `document` input named `document` — the PDF example's shape. */
  const SINGLE = descriptor(top("document", DOCUMENT));
  const enveloped = (url: string, filename?: string) => ({
    document: { concept: "native.Document", content: { url, ...(filename && { filename }) } },
  });

  it("accepts the schemes a file input may legitimately carry", () => {
    expect(checkFileInputs(SINGLE, enveloped(PDF_DATA_URL), opts)).toBeNull();
    expect(checkFileInputs(SINGLE, enveloped("https://example.com/a.pdf"), opts)).toBeNull();
    expect(checkFileInputs(SINGLE, enveloped("pipelex-storage://abc"), opts)).toBeNull();
  });

  it("reads the compact form the SDK also accepts", () => {
    // `prepareInputs` resolves a bare source string at a file position exactly
    // as it resolves `{url}`. Skipping it would leave the verdict resting on
    // ajv refusing a string where `native.Document` declares an object — the
    // schema in front of the gate, not the gate.
    const compact = (content: string) => ({
      document: { concept: "native.Document", content },
    });
    expect(checkFileInputs(SINGLE, compact(PDF_DATA_URL), opts)).toBeNull();
    expect(checkFileInputs(SINGLE, compact("/etc/passwd"), opts)?.details).toBe(
      "unsupported_scheme: document",
    );
  });

  it("reads a bare value as readily as the kernel's envelope", () => {
    // The SDK reads a top-level input either way — the explicit `{concept,
    // content}` envelope or the compact value — and so must this, or a caller
    // that skips the envelope skips the gate.
    expect(checkFileInputs(SINGLE, { document: { url: "/etc/passwd" } }, opts)?.details).toBe(
      "unsupported_scheme: document",
    );
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a relative path", "../../.env.local"],
    ["a bare filename", "package.json"],
    ["a file:// URL", "file:///etc/hosts"],
    ["a cleartext http URL", "http://169.254.169.254/latest/meta-data/"],
  ])("refuses %s", (_label, url) => {
    // Anything outside the accepted set reaches `prepareInputs` as a *local
    // filesystem path*, which it reads and uploads. Refusing by default is the
    // whole design; see the ALLOWED_FILE_SCHEMES docstring.
    const error = checkFileInputs(SINGLE, enveloped(url), opts);
    expect(error?.kind).toBe("bad_request");
    expect(error?.title).toBe("Unsupported file reference");
  });

  it("gates a file input whatever the bundle calls it", () => {
    // The rename case the old `inputs.document` lookup failed open on. Codegen
    // carries a rename into the form, the readiness rules, the wire envelope —
    // and the descriptor this gate walks, so the gate moves with it.
    const RENAMED = descriptor(top("attachment", DOCUMENT));
    const renamed = { attachment: { concept: "native.Document", content: { url: "/etc/passwd" } } };
    expect(checkFileInputs(RENAMED, renamed, opts)?.details).toBe("unsupported_scheme: attachment");

    const oversized = {
      attachment: {
        concept: "native.Document",
        content: { url: `data:application/pdf;base64,${"A".repeat(16 * 1024 * 1024)}` },
      },
    };
    expect(checkFileInputs(RENAMED, oversized, opts)?.kind).toBe("file_too_large");
  });

  it("ignores inputs the descriptor declares as something else, and checks every file", () => {
    const MIXED = descriptor(
      top("text", { kind: "prose", concept_ref: "native.Text" }),
      top("first", DOCUMENT),
      top("second", DOCUMENT),
    );
    const mixed = {
      text: { concept: "native.Text", content: { text: "not a file" } },
      first: { concept: "native.Document", content: { url: "https://example.com/a.pdf" } },
      second: { concept: "native.Document", content: { url: "/etc/passwd" } },
    };
    expect(checkFileInputs(MIXED, mixed, opts)?.details).toBe("unsupported_scheme: second");
  });

  it("rejects a data URL of the wrong type, naming the file", () => {
    const error = checkFileInputs(
      SINGLE,
      enveloped("data:image/png;base64,AAAA", "logo.png"),
      opts,
    );
    expect(error?.kind).toBe("unsupported_file_type");
    expect(error?.details).toContain("logo.png");
  });

  // `prepareInputs` walks the method's wire descriptor, so it resolves a file
  // inside a list or nested in a structured concept. This gate walks the same
  // descriptor, so it reaches exactly those positions — the earlier shape of it
  // read one level down and refused anything deeper, which is how a
  // `cvs: list[Document]` input was refused at run time.
  describe("a file position below the top level", () => {
    /** `cvs: Document[]` beside a single `job_offer_pdf` — the CV-screening shape. */
    const CVS = descriptor(
      {
        ...top("cvs", { kind: "list", concept_ref: "native.Document", item: DOCUMENT }),
        gating: false,
      },
      top("job_offer_pdf", DOCUMENT),
    );
    const cvs = (...urls: string[]) => ({
      cvs: {
        concept: "native.Document",
        content: urls.map((url, index) => ({ url, filename: `cv-${index}.pdf` })),
      },
      job_offer_pdf: { concept: "native.Document", content: { url: PDF_DATA_URL } },
    });

    it("accepts every file in a list", () => {
      expect(checkFileInputs(CVS, cvs(PDF_DATA_URL, "https://example.com/b.pdf"), opts)).toBeNull();
    });

    it("refuses one bad reference in a list, naming its position", () => {
      const error = checkFileInputs(CVS, cvs(PDF_DATA_URL, "/etc/passwd"), opts);
      expect(error?.title).toBe("Unsupported file reference");
      expect(error?.details).toBe("unsupported_scheme: cvs.1");
    });

    it("applies the MIME and size checks to a list item, naming its file", () => {
      const error = checkFileInputs(CVS, cvs("data:image/png;base64,AAAA"), opts);
      expect(error?.kind).toBe("unsupported_file_type");
      expect(error?.details).toBe("unsupported_file_type: cv-0.pdf");
    });

    it("accepts an empty list — a variable list needs no items", () => {
      expect(checkFileInputs(CVS, cvs(), opts)).toBeNull();
    });

    it("reaches a file nested in a structured concept", () => {
      const PACKET = descriptor(
        top("packet", {
          kind: "object",
          concept_ref: "d.Packet",
          fields: [
            { kind: "text", name: "note", required: true },
            { ...DOCUMENT, name: "attachment" },
          ],
        }),
      );
      const nested = {
        packet: {
          concept: "d.Packet",
          content: { note: "hi", attachment: { url: "/etc/passwd", filename: "x.pdf" } },
        },
      };
      expect(checkFileInputs(PACKET, nested, opts)?.details).toBe(
        "unsupported_scheme: packet.attachment",
      );
    });

    it("leaves an empty optional file position alone", () => {
      // `null` is how an optional nested file is left unset, and nothing reads
      // a file for it. Only what is present is verified.
      const PACKET = descriptor(
        top("packet", {
          kind: "object",
          concept_ref: "d.Packet",
          fields: [{ ...DOCUMENT, name: "scan", required: false }],
        }),
      );
      const empty = { packet: { concept: "d.Packet", content: { scan: null } } };
      expect(checkFileInputs(PACKET, empty, opts)).toBeNull();
    });
  });

  // The descriptor is the classifier, never the value's shape — which cuts both
  // ways. A `url` the descriptor does not declare as a file is not one, and a
  // value the SDK will not read cannot be made to look like one.
  describe("what the descriptor does not declare", () => {
    it("does not mistake a text field named `url` for a file", () => {
      // The false positive a value walk cannot avoid: a structured concept with
      // a `url` field of its own. `prepareInputs` copies it through untouched,
      // so there is nothing to verify and refusing it would refuse the method.
      const LINK = descriptor(
        top("link", {
          kind: "object",
          concept_ref: "d.Link",
          fields: [{ kind: "text", name: "url", required: true }],
        }),
      );
      const link = { link: { concept: "d.Link", content: { url: "/not/a/file" } } };
      expect(checkFileInputs(LINK, link, opts)).toBeNull();
    });

    it("lets a plural text input through — an array is not by itself a file", () => {
      const PAGES = descriptor({
        ...top("pages", {
          kind: "list",
          concept_ref: "native.Text",
          item: { kind: "prose", concept_ref: "native.Text", required: true },
        }),
        gating: false,
      });
      const pages = { pages: { concept: "native.Text", content: [{ text: "first" }] } };
      expect(checkFileInputs(PAGES, pages, opts)).toBeNull();
    });

    it("does not walk a value whose shape disagrees with its node", () => {
      // A self-referential payload under a `prose` node is never descended (the
      // walk follows the descriptor, which is finite), and an array where the
      // descriptor declares an object is left to the shape gate.
      const loop: Record<string, unknown> = { note: "hi" };
      loop.self = loop;
      const PROSE = descriptor(top("text", { kind: "prose", concept_ref: "native.Text" }));
      expect(
        checkFileInputs(PROSE, { text: { concept: "native.Text", content: loop } }, opts),
      ).toBeNull();
    });

    it("refuses a present file position that holds neither a string nor {url}", () => {
      // Bytes or a shapeless object at a file position would either bypass the
      // size cap (the SDK uploads bytes as-is) or fail in the SDK with a typed
      // error; either way the verdict is this gate's, not the schema's in front.
      const blob = { document: { concept: "native.Document", content: new Uint8Array(4) } };
      expect(checkFileInputs(SINGLE, blob, opts)?.details).toBe("unsupported_scheme: document");
      const shapeless = {
        document: { concept: "native.Document", content: { filename: "x.pdf" } },
      };
      expect(checkFileInputs(SINGLE, shapeless, opts)?.details).toBe(
        "unsupported_scheme: document",
      );
    });

    it("passes an input the descriptor does not name through untouched", () => {
      // The shape gate in front drops undeclared inputs before this runs, and
      // the SDK copies one through without reading it; neither is a file.
      const stray = { stray: { concept: "native.Document", content: { url: "/etc/passwd" } } };
      expect(checkFileInputs(SINGLE, stray, opts)).toBeNull();
    });
  });
});

describe("fileInputErrorToPipelineError", () => {
  it("maps file_too_large to a rendered PipelineError", () => {
    const result = fileInputErrorToPipelineError(
      { kind: "file_too_large", message: "File is 20 MB; the limit is 8 MB." },
      "big.pdf",
    );
    expect(result.kind).toBe("file_too_large");
    expect(result.title).toBe("File too large");
    expect(result.details).toContain("big.pdf");
  });

  it("maps unsupported_file_type and tolerates a missing filename", () => {
    const result = fileInputErrorToPipelineError(
      { kind: "unsupported_file_type", message: "Expected a PDF." },
      "",
    );
    expect(result.kind).toBe("unsupported_file_type");
    expect(result.title).toBe("Unsupported file type");
    expect(result.details).toContain("(no filename)");
  });
});
