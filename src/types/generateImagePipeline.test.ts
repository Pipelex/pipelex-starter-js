import { describe, it, expect } from "vitest";
import type { RunResults } from "@pipelex/sdk";
import { parseGeneratedImage } from "./generateImagePipeline";
import { BadImageOutputError } from "./pipelineError";

/** Both paths deliver the resolved output on `main_stuff` (the SDK digs it out on the blocking path too). */
function mainStuff(content: unknown): RunResults {
  return { pipeline_run_id: "run-123", main_stuff: content };
}

describe("parseGeneratedImage", () => {
  it("extracts an image with a remote URL and web public_url", () => {
    const result = parseGeneratedImage(
      mainStuff({
        url: "https://storage.pipelex.com/generated/abc.png",
        public_url: "https://cdn.pipelex.com/abc.png",
        mime_type: "image/png",
        caption: "A robot",
      }),
    );
    expect(result).toEqual({
      url: "https://storage.pipelex.com/generated/abc.png",
      public_url: "https://cdn.pipelex.com/abc.png",
      mime_type: "image/png",
      caption: "A robot",
    });
  });

  it("extracts the durable hosted shape verbatim: non-web url, web public_url, explicit nulls", () => {
    // Captured live from api-dev: `url` is a non-web pipelex-storage URI,
    // `public_url` a signed S3 URL, and every unset optional field arrives as
    // an explicit `null` (pydantic serializes `None`, it does not omit the
    // key). The generated schema models those as `.optional()`, so this case is
    // the one that proves `dropWireNulls` is load-bearing rather than cosmetic.
    const result = parseGeneratedImage(
      mainStuff({
        url: "pipelex-storage://org/runs/run_1/generated/abc.png",
        public_url: "https://s3.us-west-2.amazonaws.com/bucket/abc.png?X-Amz-Signature=abc",
        source_prompt: "A simple red circle on a plain white background.",
        source_negative_prompt: null,
        caption: null,
        mime_type: "image/png",
        width: 1024,
        height: 1024,
        filename: null,
      }),
    );
    expect(result.url).toBe("pipelex-storage://org/runs/run_1/generated/abc.png");
    expect(result.public_url).toContain("https://s3");
    expect(result.mime_type).toBe("image/png");
    expect(result.width).toBe(1024);
    // A dropped null reads as absent, which is what `.optional()` means.
    expect(result.caption).toBeUndefined();
    expect(result.filename).toBeUndefined();
  });

  it("extracts an image delivered as a base64 data URL", () => {
    const result = parseGeneratedImage(mainStuff({ url: "data:image/png;base64,AAAA" }));
    expect(result.url).toBe("data:image/png;base64,AAAA");
    expect(result.public_url).toBeUndefined();
    expect(result.mime_type).toBeUndefined();
    expect(result.caption).toBeUndefined();
  });

  it("throws BadImageOutputError when no entry carries a URL", () => {
    expect(() => parseGeneratedImage(mainStuff({ caption: "no url here" }))).toThrow(
      BadImageOutputError,
    );
  });

  it("throws BadImageOutputError when the URL is an empty string", () => {
    expect(() => parseGeneratedImage(mainStuff({ url: "" }))).toThrow(BadImageOutputError);
  });

  it.each(["file:///tmp/storage/abc.png", "pipelex-storage://anonymous/uuid/abc.png"])(
    "rejects a non-web image URL with no web public_url: %s",
    (url) => {
      try {
        parseGeneratedImage(mainStuff({ url }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadImageOutputError);
        expect((err as BadImageOutputError).nonWebUrl).toBe(url);
      }
    },
  );

  it("rejects a file:// public_url even when url is web-renderable", () => {
    // <ImageResult> displays public_url ?? url, so a bad public_url wins.
    try {
      parseGeneratedImage(
        mainStuff({
          url: "https://storage.pipelex.com/abc.png",
          public_url: "file:///tmp/storage/abc.png",
        }),
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BadImageOutputError);
      expect((err as BadImageOutputError).nonWebUrl).toBe("file:///tmp/storage/abc.png");
    }
  });

  it("throws when main_stuff is not the expected object (a list output / scalar)", () => {
    expect(() => parseGeneratedImage(mainStuff(null))).toThrow(BadImageOutputError);
    expect(() => parseGeneratedImage(mainStuff([{ url: "https://x" }]))).toThrow(
      BadImageOutputError,
    );
  });
});
