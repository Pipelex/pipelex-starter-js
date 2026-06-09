#!/usr/bin/env node
/**
 * Rename the pipelex-starter-js template placeholders to a real project.
 *
 * This is the deterministic engine behind the `/bootstrap` skill. It does the
 * mechanical, error-prone part — substituting the template name in its two
 * spellings across config, docs, UI and skills, resetting the version and
 * changelog, and applying the license choice — so the skill (and the human)
 * can focus on collecting good inputs and verifying the result.
 *
 * Why a script instead of a pile of Edit calls: the same name appears in two
 * forms (npm slug / display title) scattered across many files, and the
 * license choice touches four places (LICENSE, package.json, README, and the
 * changelog reset adds a fifth file). Doing that by hand once is fine; doing
 * it reliably every time someone clones the template is exactly what a script
 * is for. It is also safe to run with --dry-run, which is what makes it
 * testable.
 *
 * The script only transforms files. It does NOT touch git, run `npm install`,
 * run the checks, or remove the bootstrap skill — the SKILL.md orchestrates
 * those so each step stays reviewable and the script stays a pure, idempotent
 * transform. Zero dependencies; runs on the same Node 22+ the project needs.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// The template's placeholders, in their two spellings. Everything the script
// does is ultimately "turn these into the user's chosen name".
const TEMPLATE_NAME = "pipelex-starter-js"; // npm package name / repo slug
const TEMPLATE_TITLE = "Pipelex Starter"; // human-facing display name (page H1, <title>)

// The two long-form description placeholders. README and CLAUDE.md carry the
// same sentence modulo the leading article, so anchor each exactly.
const README_DESCRIPTION =
  "A minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`mthds`](https://www.npmjs.com/package/mthds) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.";
const CLAUDE_DESCRIPTION =
  "Minimal Next.js 16 starter that calls the [Pipelex](https://pipelex.com) API via the [`mthds`](https://www.npmjs.com/package/mthds) SDK to run AI methods (`.mthds` bundles) from a TypeScript app.";
const LAYOUT_DESCRIPTION = "Minimal Next.js app calling Pipelex via the mthds SDK.";

// npm package name rules (legacy-strict subset: new packages must be lowercase
// URL-safe, optionally scoped). Anything else breaks `npm install` later.
const NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.error(`warning: ${message}`);
}

function validateName(name) {
  if (!NAME_RE.test(name) || name.length > 214 || name.startsWith(".") || name.startsWith("_")) {
    fail(
      `invalid package name ${JSON.stringify(name)}: use lowercase letters, digits, '-', '.', '_',` +
        ` optionally scoped (e.g. 'invoice-extractor' or '@acme/invoice-extractor').`,
    );
  }
}

/** Today's date in the machine's local timezone (toISOString would give UTC,
 * which can lag a day behind for anyone east of Greenwich). */
function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function titleFromName(name) {
  const bare = name.includes("/") ? name.split("/")[1] : name;
  return bare
    .split(/[-._]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// License handling
// ---------------------------------------------------------------------------

const PROPRIETARY_LICENSE = `Copyright (c) {year} {holder}

All rights reserved.

This software and its associated documentation (the "Software") are the
proprietary and confidential property of {holder}. Unauthorized copying,
distribution, modification, public display, or use of the Software, in whole or
in part, via any medium, is strictly prohibited without the express prior
written permission of {holder}.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
`;

const OTHER_LICENSE = `Copyright (c) {year} {holder}

This project is licensed under the {spdx} license.

Replace this file with the full text of the {spdx} license — you can obtain it
from https://spdx.org/licenses/{spdx}.html
`;

/**
 * Resolve the license choice into the forms the call-sites need: `kind` drives
 * the LICENSE body, `npmField` is the value for package.json's `license` field
 * (npm's convention for closed-source is the literal "UNLICENSED"), and
 * `holder`/`year` fill the copyright notice.
 */
function resolveLicense(value, holder, year) {
  const norm = (value || "mit").trim().toLowerCase();
  if (norm === "" || norm === "mit") {
    return { kind: "mit", npmField: "MIT", holder, year };
  }
  if (["proprietary", "all-rights-reserved", "all rights reserved", "unlicensed"].includes(norm)) {
    return { kind: "proprietary", npmField: "UNLICENSED", holder, year };
  }
  // Anything else is treated as a raw SPDX id (e.g. Apache-2.0). We set the
  // field and write a stub, but can't author arbitrary license text for them.
  return { kind: "other", npmField: value.trim(), holder, year };
}

// ---------------------------------------------------------------------------
// File transforms
// ---------------------------------------------------------------------------

/** Escape a value for a double-quoted JS/TSX string literal. */
function jsString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Substitute both spellings of the template name with the new ones. */
function applyNameTokens(text, names) {
  return text.replaceAll(TEMPLATE_NAME, names.name).replaceAll(TEMPLATE_TITLE, names.title);
}

/**
 * Soften the template's self-references in prose ("the starter ...") — these
 * appear in user-facing error messages (errors.ts), a Makefile comment, and an
 * e2e spec comment. A bootstrapped project is not a starter, and the
 * errors.ts strings are shown to the app's end users at runtime.
 */
function applyStarterProse(text) {
  return text
    .replaceAll('"I just cloned the starter"', '"I just cloned the repo"')
    .replaceAll("The starter", "This app")
    .replaceAll("the starter", "this app");
}

/**
 * package.json is structured data, so transform it as data rather than text.
 * New keys (license / author / repository) are inserted right after
 * `description` to keep the file tidy, since plain assignment would append
 * them at the bottom.
 */
function transformPackageJson(text, names, opts) {
  const pkg = JSON.parse(text);
  const inserted = {};
  inserted.license = opts.lic.npmField;
  if (opts.authorName && opts.authorEmail) {
    inserted.author = `${opts.authorName} <${opts.authorEmail}>`;
  } else if (opts.authorName) {
    inserted.author = opts.authorName;
  } else if (opts.authorEmail) {
    inserted.author = `<${opts.authorEmail}>`;
  }
  if (opts.repoUrl) {
    inserted.repository = opts.repoUrl;
  }

  const out = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (key in inserted) continue; // re-inserted in order below
    out[key] = value;
    if (key === "description") {
      Object.assign(out, inserted);
    }
  }
  out.name = names.name;
  out.version = "0.1.0"; // fresh project, fresh semver — CHANGELOG.md is reset to match
  out.description = opts.description;
  return JSON.stringify(out, null, 2) + "\n";
}

function transformReadme(text, names, opts) {
  if (text.includes(README_DESCRIPTION)) {
    text = text.replace(README_DESCRIPTION, opts.description);
  } else {
    warn("README.md: template description paragraph not found; left as-is.");
  }

  // License line: reflect the chosen license in the README's License section.
  if (opts.lic.kind === "proprietary") {
    text = text.replace(
      "This project is licensed under the [MIT license](LICENSE). Runtime dependencies are distributed under their own licenses via npm.",
      "This project is proprietary — all rights reserved. See the [LICENSE](LICENSE) file. Runtime dependencies are distributed under their own licenses via npm.",
    );
  } else if (opts.lic.kind === "other") {
    text = text.replace("[MIT license](LICENSE)", `[${opts.lic.npmField} license](LICENSE)`);
  }

  return applyNameTokens(text, names);
}

/**
 * Remove CLAUDE.md's template-only paragraph (the "reference template" charter)
 * when --clean is passed: a bootstrapped project is no longer a template, and
 * keeping the paragraph would steer every future Claude session toward
 * template-maintainer behavior instead of building the user's app.
 */
function stripTemplateParagraph(text) {
  const marker = "This repo is a **reference template**.";
  const start = text.indexOf(marker);
  if (start === -1) return text; // already stripped (e.g. re-run) — nothing to do
  const end = text.indexOf("\n\n", start);
  if (end === -1) return text;
  return text.slice(0, start) + text.slice(end + 2);
}

function transformClaudeMd(text, names, opts) {
  if (text.includes(CLAUDE_DESCRIPTION)) {
    text = text.replace(CLAUDE_DESCRIPTION, opts.description);
  } else {
    warn("CLAUDE.md: template description line not found; left as-is.");
  }
  if (opts.clean) {
    text = stripTemplateParagraph(text);
  }
  return applyNameTokens(text, names);
}

function transformLayout(text, names, opts) {
  text = text.replace(
    `description: "${LAYOUT_DESCRIPTION}"`,
    `description: "${jsString(opts.description)}"`,
  );
  return text.replaceAll(`"${TEMPLATE_TITLE}"`, `"${jsString(names.title)}"`);
}

function transformLicense(text, opts) {
  const lic = opts.lic;
  if (lic.kind === "mit") {
    // Keep the MIT text; only refresh the copyright line when we have a
    // holder to put there (don't silently bump the template holder's year).
    if (lic.holder) {
      text = text.replace(/Copyright \(c\) \d{4} .*/, `Copyright (c) ${lic.year} ${lic.holder}`);
    }
    return text;
  }
  const holder = lic.holder || "<COPYRIGHT HOLDER>";
  if (!lic.holder) {
    warn("no --license-holder given; wrote a placeholder into LICENSE.");
  }
  if (lic.kind === "proprietary") {
    return PROPRIETARY_LICENSE.replaceAll("{year}", String(lic.year)).replaceAll(
      "{holder}",
      holder,
    );
  }
  warn(
    `wrote a LICENSE stub for '${lic.npmField}'. Replace it with the full ${lic.npmField} license text.`,
  );
  return OTHER_LICENSE.replaceAll("{year}", String(lic.year))
    .replaceAll("{holder}", holder)
    .replaceAll("{spdx}", lic.npmField);
}

/**
 * The template's changelog chronicles the template, not the user's project.
 * Start the new project's history at v0.1.0 (matching the package.json reset)
 * in the same `## [vX.Y.Z] - date` format the release skill expects.
 */
function resetChangelog(_text, opts) {
  return `# Changelog

## [v0.1.0] - ${opts.date}

### Added

- Initial project, bootstrapped from the [pipelex-starter-js](https://github.com/Pipelex/pipelex-starter-js) template
`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const TARGETS = [
  { rel: "package.json", transform: transformPackageJson },
  { rel: "README.md", transform: transformReadme },
  { rel: "CLAUDE.md", transform: transformClaudeMd },
  { rel: "LICENSE", transform: (text, _names, opts) => transformLicense(text, opts) },
  { rel: "CHANGELOG.md", transform: (text, _names, opts) => resetChangelog(text, opts) },
  { rel: "src/app/layout.tsx", transform: transformLayout },
  { rel: "src/app/page.tsx", transform: (text, names) => applyNameTokens(text, names) },
  { rel: ".claude/skills/release/SKILL.md", transform: (text, names) => applyNameTokens(text, names) },
  { rel: "src/lib/errors.ts", transform: (text) => applyStarterProse(text) },
  { rel: "e2e/error-display.spec.ts", transform: (text) => applyStarterProse(text) },
  { rel: "Makefile", transform: (text) => applyStarterProse(text) },
];

function run(root, names, opts) {
  // Guard: confirm this actually is the unbootstrapped template before we
  // start rewriting things. Cheap check, saves a confusing half-applied state.
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fail(`no package.json found in ${root} — run this from the project root.`);
  }
  const pkgText = fs.readFileSync(pkgPath, "utf8");
  if (!pkgText.includes(`"name": "${TEMPLATE_NAME}"`)) {
    warn(
      `package.json does not contain "name": "${TEMPLATE_NAME}". This repo may already be bootstrapped; proceeding anyway.`,
    );
  }

  console.log(`Bootstrapping template -> ${JSON.stringify(names.title)}`);
  console.log(`  name=${names.name}  title=${names.title}  license=${opts.lic.npmField}`);
  if (opts.dryRun) {
    console.log("  (dry run — no files will be modified)");
  }
  console.log("");
  console.log("Edits:");

  let changed = 0;
  for (const target of TARGETS) {
    const filePath = path.join(root, target.rel);
    if (!fs.existsSync(filePath)) {
      warn(`${target.rel}: not found, skipped.`);
      continue;
    }
    const original = fs.readFileSync(filePath, "utf8");
    const updated = target.transform(original, names, opts);
    if (updated === original) continue;
    if (opts.dryRun) {
      console.log(`  edit    ${target.rel}`);
    } else {
      fs.writeFileSync(filePath, updated, "utf8");
      console.log(`  edited  ${target.rel}`);
    }
    changed += 1;
  }
  if (changed === 0) {
    console.log("  (no content changes)");
  }
  console.log("");
  console.log(`Done. ${changed} file(s) ${opts.dryRun ? "would be " : ""}edited.`);
  if (!opts.dryRun) {
    console.log("\nNext: sync the lock file (npm ci in CI validates its name/version) and run the gates:");
    console.log("  npm install --package-lock-only && make all");
    console.log("Then review with `git status` and `git diff` before committing.");
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const FLAGS = {
  "--name": "name",
  "--title": "title",
  "--description": "description",
  "--author-name": "authorName",
  "--author-email": "authorEmail",
  "--repo-url": "repoUrl",
  "--license": "license",
  "--license-holder": "licenseHolder",
  "--license-year": "licenseYear",
  "--root": "root",
};
const SWITCHES = { "--clean": "clean", "--dry-run": "dryRun" };

function parseArgs(argv) {
  const args = { clean: false, dryRun: false, root: "." };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg in SWITCHES) {
      args[SWITCHES[arg]] = true;
    } else if (arg in FLAGS) {
      const value = argv[i + 1];
      if (value === undefined) fail(`missing value for ${arg}`);
      args[FLAGS[arg]] = value;
      i += 1;
    } else {
      fail(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (!args.name) fail("--name is required (npm package name, e.g. 'invoice-extractor')");
  if (!args.description) fail("--description is required (one-line project description)");
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const name = args.name.trim();
  validateName(name);
  const title = (args.title || titleFromName(name)).trim();
  const names = { name, title };

  const year = args.licenseYear ? Number.parseInt(args.licenseYear, 10) : new Date().getFullYear();
  if (Number.isNaN(year)) fail(`invalid --license-year ${JSON.stringify(args.licenseYear)}`);
  const lic = resolveLicense(args.license, (args.licenseHolder || "").trim() || null, year);

  const opts = {
    description: args.description.trim(),
    authorName: (args.authorName || "").trim() || null,
    authorEmail: (args.authorEmail || "").trim() || null,
    repoUrl: (args.repoUrl || "").trim().replace(/\/+$/, "") || null,
    lic,
    clean: args.clean,
    dryRun: args.dryRun,
    date: localDate(),
  };
  run(path.resolve(args.root), names, opts);
}

main(process.argv.slice(2));
