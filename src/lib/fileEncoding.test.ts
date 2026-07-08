import { describe, it, expect } from "vitest";
import {
  MAX_PDF_BYTES,
  buildDocumentInput,
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
});

describe("buildDocumentInput", () => {
  it("builds a Document envelope with url, filename, and mime_type", () => {
    expect(buildDocumentInput(PDF_DATA_URL, "invoice.pdf")).toEqual({
      concept: "Document",
      content: {
        url: PDF_DATA_URL,
        filename: "invoice.pdf",
        mime_type: "application/pdf",
      },
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
    expect(result.title).toBe("PDF too large");
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
