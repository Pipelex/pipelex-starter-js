import { describe, it, expect } from "vitest";
import type { RunField } from "@pipelex/mthds-form";
import { isRenderableResultUrl, scrubResultUrls } from "./resultUrls";
import { requireResultField } from "./resultField";
import { requireContract } from "./runInputs";
import { OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/generate-image/contracts";

const IMAGE_FIELD: RunField = { kind: "image", name: "output", required: true };

const DOCUMENT_FIELD: RunField = { kind: "document", name: "output", required: true };

describe("isRenderableResultUrl", () => {
  it.each([
    "https://s3.example/x.png?sig=1",
    "data:image/png;base64,AAA",
    "data:image/jpeg;base64,AAA",
    "data:image/webp,AAA",
  ])("accepts %s", (url) => {
    expect(isRenderableResultUrl(url)).toBe(true);
  });

  it.each([
    // The case the whole module exists for: an active-content payload that the
    // kernel would frame in an unsandboxed iframe if its filename says "pdf".
    "data:text/html,<script>alert(1)</script>",
    // Renders as a picture and executes as a document, so it is refused even
    // though its media type begins with `image/`.
    "data:image/svg+xml,<svg/>",
    "http://insecure.example/x.png",
    "blob:https://app.example/2f1c",
    "/etc/passwd",
    "",
  ])("refuses %s", (url) => {
    expect(isRenderableResultUrl(url)).toBe(false);
  });

  it("refuses a non-string, so an object at a url property cannot pass for one", () => {
    expect(isRenderableResultUrl({ url: "https://x/y.png" })).toBe(false);
    expect(isRenderableResultUrl(null)).toBe(false);
  });
});

describe("scrubResultUrls", () => {
  it("returns the value by identity when nothing is refused", () => {
    // The overwhelmingly common case, and worth pinning by identity rather than
    // by equality: a hosted run's payload must not be rebuilt on every render.
    const value = { url: "https://s3.example/a.png", caption: "A robot" };
    const result = scrubResultUrls(IMAGE_FIELD, value);

    expect(result.value).toBe(value);
    expect(result.refused).toEqual([]);
  });

  it("leaves a storage reference verbatim, because the kernel never acts on it", () => {
    // `pipelex-storage://` reaches no sink — the kernel's own gate refuses it —
    // so removing it would strip the JSON receipt of a reference that was never
    // dangerous. The signed URL beside it is what actually paints.
    const value = {
      url: "pipelex-storage://org/assets/abc.bin",
      public_url: "https://s3.example/abc.png?sig=1",
    };

    expect(scrubResultUrls(IMAGE_FIELD, value).value).toBe(value);
  });

  it("drops a refused property and names its path, keeping the rest of the payload", () => {
    const { value, refused } = scrubResultUrls(DOCUMENT_FIELD, {
      url: "data:text/html,<script>alert(1)</script>",
      filename: "report.pdf",
      mime_type: "application/pdf",
    });

    // Dropped, not blanked: `JSON.stringify` omits the key, so the JSON view
    // shows the payload minus exactly what was refused.
    expect(value).toEqual({ filename: "report.pdf", mime_type: "application/pdf" });
    expect(refused).toEqual(["output.url"]);
  });

  it("refuses cleartext http and a blob reference", () => {
    const { value, refused } = scrubResultUrls(IMAGE_FIELD, {
      public_url: "http://insecure.example/x.png",
      url: "blob:https://app.example/2f1c",
    });

    expect(value).toEqual({});
    expect(refused).toEqual(["output.public_url", "output.url"]);
  });

  it("trims an accepted URL so the kernel judges the same string this did", () => {
    // The divergence this closes: `new URL(" https://…")` strips the space and
    // passes, the kernel's own `/^https?:/` does not — so the kernel skipped the
    // validated `public_url` and silently painted the unvalidated `url`.
    const { value, refused } = scrubResultUrls(IMAGE_FIELD, {
      public_url: " https://cdn.example/pub.png",
      url: "https://storage.example/raw.png",
    });

    expect(value).toEqual({
      public_url: "https://cdn.example/pub.png",
      url: "https://storage.example/raw.png",
    });
    // A normalization is not a refusal — nothing was withheld from the reader.
    expect(refused).toEqual([]);
  });

  it("handles a bare URL string at a file position", () => {
    expect(scrubResultUrls(IMAGE_FIELD, "https://s3.example/a.png").value).toBe(
      "https://s3.example/a.png",
    );

    const { value, refused } = scrubResultUrls(IMAGE_FIELD, "data:text/html,<script></script>");
    expect(value).toBeUndefined();
    expect(refused).toEqual(["output"]);
  });

  it("descends a structured concept's declared fields and nothing else", () => {
    const field: RunField = {
      kind: "object",
      name: "output",
      required: true,
      fields: [
        { kind: "text", name: "title", required: true },
        { kind: "image", name: "cover", required: true },
      ],
    };
    const { value, refused } = scrubResultUrls(field, {
      title: "data:text/html,<script></script>",
      cover: { url: "data:text/html,<script></script>" },
      extra: { url: "data:text/html,<script></script>" },
    });

    // The DESCRIPTOR classifies, never the value's shape: `title` is text even
    // though it holds a URL-shaped string, and `extra` is not declared at all.
    expect(value).toEqual({
      title: "data:text/html,<script></script>",
      cover: {},
      extra: { url: "data:text/html,<script></script>" },
    });
    expect(refused).toEqual(["output.cover.url"]);
  });

  it("descends every element of a plural output", () => {
    const field: RunField = {
      kind: "list",
      name: "output",
      required: true,
      item: { kind: "image", name: "item", required: true },
    };
    const { value, refused } = scrubResultUrls(field, [
      { url: "https://ok.example/1.png" },
      { url: "data:image/svg+xml,<svg/>" },
    ]);

    expect(value).toEqual([{ url: "https://ok.example/1.png" }, {}]);
    expect(refused).toEqual(["output.1.url"]);
  });

  it("unwraps a content model before walking it", () => {
    // A scalar concept's payload sits under the property the schema names, and
    // the kernel unwraps by that name at render — so the walk has to as well, or
    // a file inside its content model is skipped.
    const field: RunField = {
      kind: "image",
      name: "output",
      required: true,
      contentKey: "content",
    };
    const { value, refused } = scrubResultUrls(field, {
      content: { url: "data:text/html,<script></script>" },
    });

    expect(value).toEqual({ content: {} });
    // The reported path skips the wrapper segment, matching how the kernel
    // presents the value: `content` is a wire detail the reader never sees.
    expect(refused).toEqual(["output.url"]);
  });

  it("leaves a value whose shape disagrees with its node alone", () => {
    // This gate refuses URLs; it does not adjudicate shapes. A scalar at an
    // object node is the binder's problem, and the kernel renders what it can.
    expect(
      scrubResultUrls({ kind: "object", name: "output", required: true, fields: [] }, 42),
    ).toMatchObject({ value: 42, refused: [] });
    expect(scrubResultUrls(IMAGE_FIELD, null)).toMatchObject({ value: null, refused: [] });
  });

  it("runs over the real generated image field", () => {
    // The committed contract, not a hand-built descriptor: this is the field the
    // Image tab actually renders, so a codegen change that moved the node's kind
    // would show up here rather than only in production.
    const contract = requireContract(PIPE_IO_CONTRACTS, "generate_image", "generate_image");
    const field = requireResultField(OUTPUT_FORM, contract, "generate_image", "generate_image");
    const { value, refused } = scrubResultUrls(field, {
      url: "pipelex-storage://org/a.bin",
      public_url: "data:text/html,<script></script>",
      mime_type: "image/png",
    });

    expect(value).toEqual({ url: "pipelex-storage://org/a.bin", mime_type: "image/png" });
    expect(refused).toEqual(["output.public_url"]);
  });
});
