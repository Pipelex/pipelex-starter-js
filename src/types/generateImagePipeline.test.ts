import { describe, it, expect } from "vitest";
import { parseGeneratedImage } from "./generateImagePipeline";
import { BadImageOutputError } from "./pipelineError";

function makePipeOutput(content: unknown) {
  return {
    pipeline_run_id: "run-123",
    working_memory: {
      root: {
        image: { concept: "native.Image", content },
      },
      aliases: {},
    },
  };
}

describe("parseGeneratedImage", () => {
  it("extracts an image with a remote URL", () => {
    const result = parseGeneratedImage(
      makePipeOutput({
        url: "https://storage.pipelex.com/generated/abc.png",
        public_url: "https://cdn.pipelex.com/abc.png",
        mime_type: "image/png",
        caption: "A robot",
      }),
    );
    expect(result).toEqual({
      url: "https://storage.pipelex.com/generated/abc.png",
      publicUrl: "https://cdn.pipelex.com/abc.png",
      mimeType: "image/png",
      caption: "A robot",
    });
  });

  it("extracts an image delivered as a base64 data URL", () => {
    const result = parseGeneratedImage(makePipeOutput({ url: "data:image/png;base64,AAAA" }));
    expect(result.url).toBe("data:image/png;base64,AAAA");
    expect(result.publicUrl).toBeNull();
    expect(result.mimeType).toBeNull();
    expect(result.caption).toBeNull();
  });

  it("throws BadImageOutputError when no entry carries a URL", () => {
    expect(() => parseGeneratedImage(makePipeOutput({ caption: "no url here" }))).toThrow(
      BadImageOutputError,
    );
  });

  it("throws BadImageOutputError when the URL is an empty string", () => {
    expect(() => parseGeneratedImage(makePipeOutput({ url: "" }))).toThrow(BadImageOutputError);
  });

  it.each(["file:///tmp/storage/abc.png", "pipelex-storage://anonymous/uuid/abc.png"])(
    "rejects a non-web image URL: %s",
    (url) => {
      try {
        parseGeneratedImage(makePipeOutput({ url }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadImageOutputError);
        expect((err as BadImageOutputError).nonWebUrl).toBe(url);
      }
    },
  );

  it("rejects a file:// public_url even when url is web-renderable", () => {
    // <ImageResult> displays publicUrl ?? url, so a bad publicUrl wins.
    try {
      parseGeneratedImage(
        makePipeOutput({
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

  it("throws when pipe_output is malformed", () => {
    expect(() => parseGeneratedImage(null)).toThrow(BadImageOutputError);
    expect(() =>
      parseGeneratedImage({ pipeline_run_id: "x", working_memory: { aliases: {} } }),
    ).toThrow(/working_memory\.root/);
  });
});
