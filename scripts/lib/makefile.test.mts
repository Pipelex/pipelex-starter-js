// @vitest-environment node
//
// Pins how the Makefile hands a gesture's variables to its script: only what
// the command line gives, never a blank, and always exactly as typed. `make -n`
// prints the command a target would run without running it, so each case reads
// the npm line `add-method` would execute.

import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./shared.mts";

// Every test here spawns `make`, some of them several times over, and a spawn
// is slow on a busy machine, so vitest's 5-second default would fail a loaded
// run: the block takes a budget sized for that.
const SPAWNS = { timeout: 60_000 };

/** Run make in the repo with a clean make environment, plus `env`. */
function make(args: readonly string[], env: Record<string, string> = {}) {
  // A parent make (`make all NAME=x`) passes its own command-line variables
  // down through MAKEFLAGS, which would make them "given" here too.
  const { MAKEFLAGS: _flags, MAKELEVEL: _level, MFLAGS: _mflags, ...inherited } = process.env;
  const result = spawnSync("make", ["--no-print-directory", ...args], {
    cwd: REPO_ROOT,
    env: { ...inherited, ...env },
    encoding: "utf-8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The npm line `make add-method <vars>` would run, with its spacing collapsed. */
function npmLine(vars: readonly string[], env: Record<string, string> = {}): string {
  const { status, stdout, stderr } = make(["-n", "add-method", ...vars], env);
  expect(status, stderr).toBe(0);
  const line = stdout.split("\n").find((printed) => printed.startsWith("npm run add-method"));
  expect(line, stdout).toBeDefined();
  return line!.replace(/\s+/g, " ").trim();
}

describe("the Makefile's gesture arguments", SPAWNS, () => {
  it("passes the values given on the command line, as flags", () => {
    expect(npmLine(["METHOD=bundles/cv", "NAME=cv", "PIPE=screen", "DRY_RUN=1"])).toBe(
      "npm run add-method -- 'bundles/cv' --pipe 'screen' --name 'cv' --dry-run",
    );
  });

  it("treats a blank value, and a 0 switch, as not given", () => {
    expect(npmLine(["METHOD=cv", "NAME=", "PIPE=", "LABEL= ", "DRY_RUN="])).toBe(
      "npm run add-method -- 'cv'",
    );
    expect(npmLine(["METHOD=cv", "DRY_RUN=0"])).toBe("npm run add-method -- 'cv'");
  });

  it("ignores a variable the shell exports", () => {
    expect(npmLine(["METHOD=cv"], { NAME: "from-shell", DRY_RUN: "1" })).toBe(
      "npm run add-method -- 'cv'",
    );
  });

  it("hands a value over exactly as typed, quotes, $ and commas included", () => {
    expect(npmLine(["METHOD=$(touch pwned)", `LABEL=Bob's "$5" app, really`])).toBe(
      `npm run add-method -- '$(touch pwned)' --label 'Bob'\\''s "$5" app, really'`,
    );
  });

  it("refuses a missing or blank METHOD before running anything", () => {
    for (const vars of [[], ["METHOD="], ["METHOD=  "]]) {
      const { status, stdout } = make(["add-method", ...vars]);
      expect(status).toBe(2);
      expect(stdout).toContain("usage: make add-method METHOD=");
      expect(stdout).not.toContain("npm run");
    }
  });
});
