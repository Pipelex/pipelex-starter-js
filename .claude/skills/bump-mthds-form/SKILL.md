---
name: bump-mthds-form
description: Bump the @pipelex/mthds-form dependency in pipelex-starter-js to a newer published version. Reads the form kernel's CHANGELOG.md for the versions in between, checks the changes against the seams this repo consumes (the gate, readiness, the wire format, the React controls, the Tailwind token mirror), applies mechanical renames, updates package.json/package-lock.json, runs the checks, and prepares a commit. Use when the user says "bump mthds-form", "bump the form kernel", "update @pipelex/mthds-form", "upgrade the form package", "is there a new mthds-form version", or asks to pull in a newer @pipelex/mthds-form release.
---

# Bump @pipelex/mthds-form

`@pipelex/mthds-form` is pre-1.0, so its `^0.x.y` range in `package.json` only auto-resolves patch bumps (npm treats the leading `0` as the major for caret purposes) — a new minor like `0.2.0 → 0.3.0` needs this repo's `package.json` edited by hand. This skill does that deliberately: read what changed, apply what can be applied mechanically, verify, then hand the user a reviewable commit.

This repo is a **reference template** — treat it as if the sibling `../mthds-form` checkout this workspace happens to have might not exist for whoever runs this skill. Always have a working fallback that only needs the published npm package and the public GitHub repo.

This is the sibling of the `bump-sdk` skill, with the same shape and the same staged-confirmation style: every step that changes files or runs `npm install` should be visible to the user before moving on, and the interesting judgment calls are in reading the changelog and deciding what's safe to auto-fix — lean on explaining rather than just executing. What differs is the surface: the form kernel touches this repo through more seams than the SDK does (both package entry points, a CSS import, a Tailwind token mirror, and the generated `contracts.ts` trees), and its changelog flags impact differently.

## Step 1 — Gather State

Show the user:

1. The current range in `package.json`: `node -p "require('./package.json').dependencies['@pipelex/mthds-form']"`
2. What's actually installed: `node -p "require('./node_modules/@pipelex/mthds-form/package.json').version"`
3. The latest published version: `npm view @pipelex/mthds-form version`
4. Working tree status (`git status --short`)

**If the installed version doesn't match the `package.json` range**, this repo is very likely on a local tarball install from `make use-local`, which covers this package alongside the SDK (see the Makefile / this repo's `CLAUDE.md` § "Local package development"). A bump should target the _published_ package, not whatever's on disk from local development — tell the user and offer to run `make use-npm` first to get back to a clean baseline. Note that `make use-npm` restores **both** `@pipelex/mthds-form` and `@pipelex/sdk` to their latest published versions and re-pins `package.json` for both — if the user wants only this package restored, offer `npm install @pipelex/mthds-form@latest` instead. (`@latest` on purpose — the bare name would just re-resolve the stale caret range already in `package.json`.)

If the working tree is dirty, don't stop — this repo's checks (`make all`) don't require a clean tree — but note it, since the diff you produce at the end will sit alongside whatever else is already staged/unstaged. Ask before touching `package.json`/`package-lock.json` if either is already dirty, since your edit will land on top of unrelated in-flight changes to the same files.

## Step 2 — Determine Target Version

If current already equals latest, tell the user there's nothing to bump and stop (unless they explicitly want to re-pin a specific older/newer version).

Otherwise use `AskUserQuestion` to confirm the target:

- **Latest (`{npm view version}`)** — the default, recommended path.
- **A specific version** — let the user type one (e.g. pinning to a version between current and latest, or ahead of latest if they published something not yet indexed).

Store the result as `TARGET_VERSION` (no `v` prefix, e.g. `0.3.0`). Warn if it's a downgrade from what's installed and confirm that's intended.

## Step 3 — Read What Changed

You need the kernel's `CHANGELOG.md` entries for every version strictly after the current one, up to and including `TARGET_VERSION`. Get it from whichever source is available, in this order:

1. **Local sibling checkout**, if this workspace has one: `../mthds-form/CHANGELOG.md`. Fast, no network, and it's the canonical source when present.
2. **GitHub raw**, otherwise: fetch `https://raw.githubusercontent.com/Pipelex/mthds-form/main/CHANGELOG.md` (the repo is `Pipelex/mthds-form`, confirmed via `npm view @pipelex/mthds-form repository.url`). Don't assume the npm tarball ships a `CHANGELOG.md`.

Extract the entries between `## [v{CURRENT}]` (exclusive) and `## [v{TARGET_VERSION}]` (inclusive) and present them to the user, grouped by version, newest first.

**This changelog does not use a "Breaking —" bullet convention** (unlike the SDK's). It writes `### Added` / `### Changed` / `### Fixed` sections with a bold lead phrase per bullet, and flags impact in prose — "visible on the wire", a renamed export, a changed default. So instead of scanning for a marker, read each bullet against the seams this repo actually consumes, and call out every bullet that touches one:

- **The gate and readiness** — `src/lib/runInputs.ts` (`getPipeIOContract`, `fieldsForContract`, `buildRunInputsSchema`, `prepareRunInputs`, `validateRunInputs`, `mustBeFilled`, `fieldFilled`, `describeValidationError`) and `src/hooks/useRunInputs.ts` (`computeReadiness`, `rjsfDataFromRunValues`). A semantics change here is what the browser/server invariant test (`src/lib/runInputs.test.ts`) exists to catch.
- **The wire format** — anything the changelog marks "visible on the wire" changes what the Server Action sends to the API. Unit tests mock the SDK, so only e2e sees this (Step 6).
- **The React controls** — `src/components/RunInputsForm.tsx` (`FieldRenderer` and friends from `@pipelex/mthds-form/react`, `isFilled`, `RunField`) and the `setValueAtPath` file seam in `PdfForm.tsx`. Rendering changes can also break test selectors: labels come from `humanizeFieldName`, and this repo's tests query by role plus name.
- **Theming and Tailwind** — `src/app/layout.tsx` imports `@pipelex/mthds-form/theme.css`, and `tailwind.config.ts` keeps a **mirror of the kernel's own `tailwind.config.cjs` token block** (the shadcn semantic colors and radii) plus the `./node_modules/@pipelex/mthds-form/dist/**/*.js` content glob. A release that adds tokens or moves the CSS entry points needs that mirror re-synced by hand — nothing automated catches it.
- **The generated contracts type** — every `src/generated/*/contracts.ts` imports `type PipeIOContracts` from the kernel. Those files are generated and **never hand-edited** (see "Generated types" in this repo's `CLAUDE.md`): if a release renames or reshapes that type, the fix routes through the emitter upstream and `npm run codegen`, not through an edit to `src/generated/`.

Everything else (internal refactors, non-breaking additions, docs) is FYI only — mention briefly, don't dwell.

## Step 4 — Apply What's Mechanical

For each bullet that renames an identifier written as `` `oldName` `` → `` `newName` `` (an export, an option, a CSS entry point):

1. Grep the **whole repo** for the old name — don't scope this to `src/` only. Kernel names leak into `README.md`, `CLAUDE.md`, `docs/input-form.md`, `docs/adopt-in-an-existing-project.md`, test files, and `tailwind.config.ts` comments, not just the runtime import sites. Two places to leave alone: `CHANGELOG.md`'s **already-dated release entries** (`## [vX.Y.Z] - YYYY-MM-DD` — a historical record; Step 7 adds this change's entry), and **anything under `src/generated/`** — if the old name appears there, that tree needs `npm run codegen` after the bump (Step 6), never an edit.
2. **If found**: this repo needs the migration. Apply it with `Edit`, then show the diff. This matches the workspace's "no backward-compatibility shims — just change it" principle.
3. **If not found**: say so and move on — this repo is already using the new name (or never used the old surface), nothing to do.
4. **Run `make format` right after any rename**, before moving on. A literal find-and-replace changes string lengths, and this repo's Prettier config re-flows Markdown tables to keep columns aligned — a raw rename inside a `README.md` table will fail `make format-check` purely on column padding, which reads as a confusing false alarm if you hit it without knowing the rename caused it.

Not every impactful change is a mechanical rename — most of this kernel's changelog is behavior: a gate that prunes differently, a wire shape that changed, a control that renders differently. **Never guess at those.** List them clearly as a "needs manual review" checklist and let the user decide how (or whether) to adapt this repo's code before continuing. If any of these are unresolved and would break `make all`, say so explicitly — better to surface that now than have Step 6 fail with a confusing error.

## Step 5 — Apply the Version Bump

1. Edit the `"@pipelex/mthds-form"` line in `package.json` to `"^{TARGET_VERSION}"` — keep the existing caret-pin style, don't switch to an exact pin.
2. Run `npm install` (not `--package-lock-only` — this needs the actual new package contents in `node_modules`: the Tailwind content glob and the CSS imports read the installed `dist/`, not the manifest).
3. Confirm it landed: `node -p "require('./node_modules/@pipelex/mthds-form/package.json').version"` should now read `TARGET_VERSION`.

## Step 6 — Run Checks

Run `make all` (lint + format-check + typecheck + unit tests + build, per this repo's `CLAUDE.md`). The unit suite includes the browser/server invariant table (`src/lib/runInputs.test.ts`) and the form/hook tests over the kernel's real derivation — this is where a readiness or gate semantics change surfaces.

- **On success**: report and continue.
- **On failure**: show the errors. If they trace back to one of the "needs manual review" items from Step 4, connect the dots for the user rather than just dumping the error. Ask how to proceed (fix, skip, abort) — don't guess at a fix for a behavior change you flagged as needing human judgment.

Then, conditionally:

- **If any changelog entry is wire-visible or touches the gate**, offer `make test-e2e`. The wire shape a run submits only travels form → Server Action → live API on the e2e path; unit tests mock the SDK and can pass while the API rejects the new shape. It costs an LLM call per run and needs `PIPELEX_API_KEY`, so only run it with explicit user approval.
- **If any changelog entry touches the controls, `styles.css`/`theme.css`, or Tailwind classes**, run the deterministic purge check from `docs/input-form.md` (diff the built stylesheet with and without the kernel's content glob — the with-glob build must be strictly larger), and offer `make dev` for a visual pass over the four example forms. A styling regression here is silent: the form still renders, just subtly unstyled.
- **If any changelog entry renames or reshapes `PipeIOContracts`** (or anything else `contracts.ts` carries), run `npm run codegen` (needs `PIPELEX_API_KEY`) and commit the regenerated trees with the bump — never patch `src/generated/` by hand.

## Step 7 — Update This Repo's CHANGELOG.md

This repo keeps an `## [Unreleased]` section at the top of `CHANGELOG.md` (see existing entries for the format). Add or extend a `### Changed` bullet under it, e.g.:

```markdown
- Bumped `@pipelex/mthds-form` to `{TARGET_VERSION}` (was `{OLD_VERSION}`).
```

If the bump changes something a consumer of this template would notice — a form control rendering differently, a wire shape their own API logs would show, a token they may have overridden — add a bullet describing it in this repo's own terms. Don't copy the kernel's changelog wording verbatim; restate it for someone reading _this_ repo's changelog who has never looked at the kernel's.

## Step 8 — Review & Commit

Present a full summary:

- `@pipelex/mthds-form`: `{OLD_VERSION} → {TARGET_VERSION}`
- Files changed: `package.json`, `package-lock.json`, `CHANGELOG.md`, plus any files touched by Step 4's migrations, plus any regenerated `src/generated/` trees from Step 6
- Any unresolved "needs manual review" items from Step 4

Ask the user to confirm. On confirmation:

1. Stage only the files actually touched by this bump — never `git add .` or `git add -A`. If the working tree already had unrelated changes to one of these files (flagged in Step 1), stage hunks carefully or ask the user how to separate them rather than bundling unrelated work into this commit.
2. Commit with message: `Bump @pipelex/mthds-form to {TARGET_VERSION}` (add a short body line if Step 4 applied migrations or Step 6 regenerated trees, naming them).
3. Show the commit result.

Then offer (but do not automatically execute) pushing and opening a PR, same as the `release` skill — target branch `dev` per this repo's `CLAUDE.md`. Wait for explicit approval before either.

## Rules

- Never use `git add .` or `git add -A` — stage only the files this bump actually touches.
- Never push or create PRs without explicit user approval.
- Never guess at a fix for a non-mechanical change (gate semantics, wire shapes, rendering) — flag it and let the user decide.
- Never edit `src/generated/` — a kernel change that reaches those trees goes through `npm run codegen`.
- Don't assume the sibling `../mthds-form` checkout exists — always have the GitHub-raw fallback ready.
- If any step fails or the user wants to abort, stop immediately — do not continue the workflow.
