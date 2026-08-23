import { describe, it, expect } from "vitest";
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
  const enveloped = (url: string, filename?: string) => ({
    document: { concept: "native.Document", content: { url, ...(filename && { filename }) } },
  });

  it("accepts the schemes a file input may legitimately carry", () => {
    expect(checkFileInputs(enveloped(PDF_DATA_URL), opts)).toBeNull();
    expect(checkFileInputs(enveloped("https://example.com/a.pdf"), opts)).toBeNull();
    expect(checkFileInputs(enveloped("pipelex-storage://abc"), opts)).toBeNull();
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
    const error = checkFileInputs(enveloped(url), opts);
    expect(error?.kind).toBe("bad_request");
    expect(error?.title).toBe("Unsupported file reference");
  });

  it("gates a file input whatever the bundle calls it", () => {
    // The rename case the old `inputs.document` lookup failed open on. Codegen
    // carries a rename into the form, the readiness rules and the wire envelope;
    // a gate keyed on the literal name would just stop applying.
    const renamed = { attachment: { concept: "native.Document", content: { url: "/etc/passwd" } } };
    expect(checkFileInputs(renamed, opts)?.kind).toBe("bad_request");

    const oversized = {
      attachment: {
        concept: "native.Document",
        content: { url: `data:application/pdf;base64,${"A".repeat(16 * 1024 * 1024)}` },
      },
    };
    expect(checkFileInputs(oversized, opts)?.kind).toBe("file_too_large");
  });

  it("ignores inputs that carry no url, and checks every one that does", () => {
    const mixed = {
      text: { concept: "native.Text", content: { text: "not a file" } },
      first: { concept: "native.Document", content: { url: "https://example.com/a.pdf" } },
      second: { concept: "native.Document", content: { url: "/etc/passwd" } },
    };
    expect(checkFileInputs(mixed, opts)?.details).toBe("unsupported_scheme: second");
  });

  it("rejects a data URL of the wrong type, naming the file", () => {
    const error = checkFileInputs(enveloped("data:image/png;base64,AAAA", "logo.png"), opts);
    expect(error?.kind).toBe("unsupported_file_type");
    expect(error?.details).toContain("logo.png");
  });

  // The gate reads `content.url`, one level down. `prepareInputs` walks the
  // method's whole signature, so it resolves a file inside a list or nested in a
  // structured concept — positions this never sees. Both shapes below reached
  // `readLocalPath` with the path intact when an unreachable `url` was a pass.
  // Refusing keeps the "keyed on values, not names" property true through a
  // routine bundle edit, instead of quietly reopening the local-file read.
  describe("a file position it cannot reach", () => {
    it("refuses a file inside a list", () => {
      const plural = {
        documents: {
          concept: "native.Document",
          content: [{ url: "/etc/passwd", filename: "x.pdf" }],
        },
      };
      expect(checkFileInputs(plural, opts)?.details).toBe("unverifiable_file_position: documents");
    });

    it("refuses a file nested in a structured concept", () => {
      const nested = {
        packet: {
          concept: "d.Packet",
          content: { note: "hi", attachment: { url: "/etc/passwd", filename: "x.pdf" } },
        },
      };
      expect(checkFileInputs(nested, opts)?.details).toBe("unverifiable_file_position: packet");
    });

    it("refuses a nested file hiding beside an outer url it can read", () => {
      // The refusal must not be reachable only when `content.url` is missing:
      // `url` is a key the caller supplies, so guarding on it lets an attacker
      // switch the check off by pasting a perfectly good https:// URL beside
      // the nested one. `prepareInputs` still walks to `attachment`.
      const decoy = {
        packet: {
          concept: "d.Packet",
          content: {
            url: "https://example.com/metadata",
            attachment: { url: "/etc/passwd", filename: "x.pdf" },
          },
        },
      };
      expect(checkFileInputs(decoy, opts)?.details).toBe("unverifiable_file_position: packet");
    });

    it("still lets a plural text input through — an array is not by itself a file", () => {
      const pages = { pages: { concept: "native.Text", content: [{ text: "first" }] } };
      expect(checkFileInputs(pages, opts)).toBeNull();
    });

    it("refuses rather than recurses forever on a self-referential payload", () => {
      const loop: Record<string, unknown> = { note: "hi" };
      loop.self = loop;
      const cyclic = { packet: { concept: "d.Packet", content: loop } };
      expect(checkFileInputs(cyclic, opts)?.details).toBe("unverifiable_file_position: packet");
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
