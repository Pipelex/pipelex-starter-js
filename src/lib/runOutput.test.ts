import { describe, it, expect } from "vitest";
import type { RunResults } from "@pipelex/sdk";
import { findOutputContent } from "./runOutput";

const hasUrl = (c: Record<string, unknown>) => typeof c.url === "string";

describe("findOutputContent — main_stuff arm (durable hosted)", () => {
  it("returns main_stuff directly when the predicate matches (no search, no unwrap)", () => {
    const results: RunResults = {
      pipeline_run_id: "r",
      main_stuff: { url: "https://x/y.png", caption: "hi" },
    };
    expect(findOutputContent(results, hasUrl)).toEqual({ url: "https://x/y.png", caption: "hi" });
  });

  it("returns undefined when main_stuff is present but the predicate fails", () => {
    const results: RunResults = { pipeline_run_id: "r", main_stuff: { caption: "no url" } };
    expect(findOutputContent(results, hasUrl)).toBeUndefined();
  });

  it("returns undefined for a non-object main_stuff (e.g. a list output)", () => {
    const results: RunResults = { pipeline_run_id: "r", main_stuff: [{ url: "https://x" }] };
    expect(findOutputContent(results, hasUrl)).toBeUndefined();
  });

  it("prefers main_stuff over pipe_output when both are present", () => {
    const results: RunResults = {
      pipeline_run_id: "r",
      main_stuff: { url: "https://from-main-stuff" },
      pipe_output: {
        working_memory: { root: { e: { content: { url: "https://from-pipe-output" } } } },
      },
    };
    expect(findOutputContent(results, hasUrl)).toEqual({ url: "https://from-main-stuff" });
  });
});

describe("findOutputContent — pipe_output arm (blocking / bare)", () => {
  it("searches working_memory.root[*].content for the matching entry", () => {
    const results: RunResults = {
      pipeline_run_id: "r",
      pipe_output: {
        working_memory: {
          root: {
            text: { concept: "Text", content: { value: "ignore me" } },
            image: { concept: "Image", content: { url: "https://x/y.png" } },
          },
          aliases: {},
        },
      },
    };
    expect(findOutputContent(results, hasUrl)).toEqual({ url: "https://x/y.png" });
  });

  it("returns undefined when no root entry matches the predicate", () => {
    const results: RunResults = {
      pipeline_run_id: "r",
      pipe_output: { working_memory: { root: { text: { content: { value: "x" } } } } },
    };
    expect(findOutputContent(results, hasUrl)).toBeUndefined();
  });

  it("returns undefined when there is no working_memory root", () => {
    expect(findOutputContent({ pipeline_run_id: "r", pipe_output: {} }, hasUrl)).toBeUndefined();
  });
});

describe("findOutputContent — neither source", () => {
  it("returns undefined when RunResults carries no output", () => {
    expect(findOutputContent({ pipeline_run_id: "r" }, hasUrl)).toBeUndefined();
  });
});
