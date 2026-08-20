import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImageResult } from "./ImageResult";

describe("ImageResult", () => {
  it("prefers public_url for the image src and download link", () => {
    render(
      <ImageResult
        image={{
          url: "https://storage.example/raw.png",
          public_url: "https://cdn.example/pub.png",
          mime_type: "image/png",
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

  it("falls back to url and a default alt when there is no public_url or caption", () => {
    render(
      <ImageResult
        image={{
          url: "data:image/png;base64,AAAA",
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
  });

  it("uses the default alt when the caption is an empty string", () => {
    render(<ImageResult image={{ url: "data:image/png;base64,AAAA", caption: "" }} />);
    expect(screen.getByRole("img", { name: "Generated image" })).toBeInTheDocument();
  });
});
