import { describe, it, expect } from "vitest";
import type { RunResults } from "@pipelex/sdk";
import { findOutputContent } from "./runOutput";

const hasUrl = (c: Record<string, unknown>) => typeof c.url === "string";

describe("findOutputContent", () => {
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

  it("returns undefined for a non-object main_stuff (a list output renders to a top-level array)", () => {
    const results: RunResults = { pipeline_run_id: "r", main_stuff: [{ url: "https://x" }] };
    expect(findOutputContent(results, hasUrl)).toBeUndefined();
  });

  it("returns undefined for a falsy-but-present scalar main_stuff (0, false, empty string)", () => {
    for (const main_stuff of [0, false, ""] as const) {
      expect(findOutputContent({ pipeline_run_id: "r", main_stuff }, hasUrl)).toBeUndefined();
    }
  });

  it("reads only main_stuff — it never falls back to pipe_output", () => {
    // main_stuff fails the predicate; a matching entry in pipe_output must NOT rescue it
    // (the blocking path now resolves main_stuff, so pipe_output is no longer consulted).
    const results: RunResults = {
      pipeline_run_id: "r",
      main_stuff: { caption: "no url" },
      pipe_output: {
        working_memory: { root: { e: { content: { url: "https://ignored" } } } },
      },
    };
    expect(findOutputContent(results, hasUrl)).toBeUndefined();
  });
});
