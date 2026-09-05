import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { JsonResult, imageUrlsOf, isWebRenderableImageUrl } from "./JsonResult";

describe("isWebRenderableImageUrl", () => {
  it.each(["https://s3.example/x.png?sig=1", "data:image/png;base64,AAA", "data:image/webp,AAA"])(
    "accepts %s",
    (url) => {
      expect(isWebRenderableImageUrl(url)).toBe(true);
    },
  );

  it.each([
    // The case this predicate exists for: the runtime returns a storage URI
    // beside the signed URL, and an <img> would render it broken.
    "pipelex-storage://org/assets/abc.bin",
    "http://insecure.example/x.png",
    "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml,<svg/>",
    "",
  ])("refuses %s", (url) => {
    expect(isWebRenderableImageUrl(url)).toBe(false);
  });

  it("refuses a non-string, so a shape with a url object cannot reach an img", () => {
    expect(isWebRenderableImageUrl({ url: "https://x/y.png" })).toBe(false);
    expect(isWebRenderableImageUrl(null)).toBe(false);
  });
});

describe("imageUrlsOf", () => {
  it("prefers public_url over url, the way the runtime returns them", () => {
    expect(
      imageUrlsOf({
        url: "pipelex-storage://org/assets/abc.bin",
        public_url: "https://s3.example/abc.png?sig=1",
      }),
    ).toEqual(["https://s3.example/abc.png?sig=1"]);
  });

  it("finds every image of a plural output, which the narrower hands over as an array", () => {
    expect(
      imageUrlsOf([{ url: "https://a.example/1.png" }, { url: "https://a.example/2.png" }]),
    ).toEqual(["https://a.example/1.png", "https://a.example/2.png"]);
  });

  it("finds none in an output that carries no image", () => {
    expect(imageUrlsOf({ text: "a summary", key_points: ["a", "b"] })).toEqual([]);
    expect(imageUrlsOf("just a string")).toEqual([]);
    expect(imageUrlsOf(null)).toEqual([]);
  });

  it("does not go hunting below the top level or the items", () => {
    // A `url` nested inside a field is somebody else's data, and picking it as
    // "the picture" is exactly the design decision this component avoids.
    expect(imageUrlsOf({ nested: { url: "https://deep.example/x.png" } })).toEqual([]);
    // Nor inside a field that happens to be called `items`: the wire envelope
    // is unwrapped by the narrower, so here it is just a field.
    expect(imageUrlsOf({ items: [{ url: "https://deep.example/y.png" }] })).toEqual([]);
  });
});

describe("JsonResult", () => {
  it("renders the value as formatted JSON under a named section", () => {
    render(<JsonResult value={{ word_count: 12, text: "hi" }} />);

    const section = screen.getByRole("region", { name: "Run output" });
    expect(section).toHaveTextContent('"word_count": 12');
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("takes a label for the section's accessible name", () => {
    render(<JsonResult value={{}} label="Text stats output" />);

    expect(screen.getByRole("region", { name: "Text stats output" })).toBeVisible();
  });

  it("shows the image above the JSON when the output carries a renderable one", () => {
    render(
      <JsonResult
        value={{ url: "pipelex-storage://org/a.bin", public_url: "https://s3.example/a.png" }}
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute("src", "https://s3.example/a.png");
    // The JSON is still shown in full — the image is an addition, not a swap.
    expect(screen.getByRole("region")).toHaveTextContent("pipelex-storage://org/a.bin");
  });

  it("shows no image for a storage URL alone, rather than a broken one", () => {
    render(<JsonResult value={{ url: "pipelex-storage://org/a.bin" }} />);

    expect(screen.queryByRole("img")).toBeNull();
  });
});
