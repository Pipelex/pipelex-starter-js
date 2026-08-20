// @vitest-environment node
//
// The one thing in `codegenShared.mts` that is worth pinning by test: the
// source hash must not depend on how the checkout wrote its line endings.
//
// `codegen:check` is defined as the offline gate — no key, no network — but its
// only printed remedy is "Run `npm run codegen` to regenerate", which needs
// both. So a hash that disagrees with the committed sidecar over CRLF alone
// sends a whole platform to a keyed dead end on a check that promises neither.
// This is the same normalization the SDK's `runCodegenCheck` applies to
// artifacts and the lock, for the same reason.

import { describe, expect, it } from "vitest";

import { hashSource } from "./codegenShared.mts";

describe("hashSource", () => {
  it("hashes CRLF and LF sources identically", () => {
    expect(hashSource("a = 1\r\nb = 2\r\n")).toBe(hashSource("a = 1\nb = 2\n"));
  });

  it("folds a lone CR, like the SDK's artifact check", () => {
    expect(hashSource("a\rb")).toBe(hashSource("a\nb"));
  });

  it("still distinguishes sources that differ in more than line endings", () => {
    expect(hashSource("a = 1\n")).not.toBe(hashSource("a = 2\n"));
  });
});
