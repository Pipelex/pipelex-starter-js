import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImageResult } from "./ImageResult";

describe("ImageResult", () => {
  it("prefers publicUrl for the image src and download link", () => {
    render(
      <ImageResult
        image={{
          url: "https://storage.example/raw.png",
          publicUrl: "https://cdn.example/pub.png",
          mimeType: "image/png",
          caption: "A robot",
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "A robot" })).toHaveAttribute(
      "src",
      "https://cdn.example/pub.png",
    );
    expect(screen.getByRole("link", { name: /download image/i })).toHaveAttribute(
      "href",
      "https://cdn.example/pub.png",
    );
  });

  it("falls back to url and a default alt when there is no publicUrl or caption", () => {
    render(
      <ImageResult
        image={{
          url: "data:image/png;base64,AAAA",
          publicUrl: null,
          mimeType: null,
          caption: null,
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
  });
});
