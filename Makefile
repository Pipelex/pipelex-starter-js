.PHONY: help run dev build start port-check lint format format-check typecheck codegen codegen-check codegen-verify add-method test test-watch test-e2e test-e2e-ui confirm-live-e2e agent-test check clean install lock all use-local use-npm ul un

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ── The app port ───────────────────────────────────────────────────────────
# Declared once here and exported, so package.json's `dev`/`start` scripts and
# playwright.config.ts all read the same number. Each of them still defaults to
# 4300 on its own, so `npm run dev` outside make keeps working. Override it to
# run this checkout beside one that already holds the port:
#
#     make run APP_PORT=4301
#
# The name is deliberately not `PORT`. That one is ambient — hosting platforms,
# other dev servers and shell profiles all export it — and inheriting it would
# move this server without saying so.
APP_PORT ?= 4300
export APP_PORT

# `next dev` refuses a taken port with a bare EADDRINUSE naming the port and
# nothing else. In this workspace every branch gets its own worktree and each
# one runs `make run` on the same port, so the holder is routinely ANOTHER
# checkout of this same app — which answers on http://localhost:4300 and looks
# entirely right in a browser. Name the holder rather than print a stack trace.
#
# ALLOW_OWN=1 accepts a server started from this directory and still refuses a
# foreign one. That is the e2e case: Playwright reuses an existing server
# (`reuseExistingServer` in playwright.config.ts), so without this check a
# stale worktree on the same port would run the whole suite against another
# branch's app and report it green.
port-check:
	@command -v lsof >/dev/null 2>&1 || exit 0; \
	pid=$$(lsof -nP -iTCP:$(APP_PORT) -sTCP:LISTEN -t 2>/dev/null | head -1); \
	if [ -z "$$pid" ]; then exit 0; fi; \
	cwd=$$(lsof -a -p $$pid -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1); \
	if [ "$$cwd" = "$(CURDIR)" ]; then \
		if [ -n "$(ALLOW_OWN)" ]; then exit 0; fi; \
		echo "Port $(APP_PORT) is already served by this checkout (pid $$pid)."; \
		echo "Open http://localhost:$(APP_PORT), or stop that server first."; \
		exit 1; \
	fi; \
	echo "Port $(APP_PORT) is held by pid $$pid, running in $${cwd:-an unknown directory}."; \
	echo "That is not this checkout ($(CURDIR)) — it is serving a different app."; \
	echo "Leave it alone and use another port, e.g. APP_PORT=4301 on this target."; \
	exit 1

run: port-check ## Start dev server
	npm run dev

dev: run ## Alias for run

build: ## Production build
	npm run build

start: port-check ## Start production server
	npm run start

lint: ## Run ESLint
	npm run lint

format: ## Format code with Prettier
	npm run format

format-check: ## Check formatting (CI)
	npm run format:check

typecheck: ## Run TypeScript type checking (app + e2e specs + scripts)
	npm run typecheck
	npm run typecheck:e2e
	npm run typecheck:scripts

# Regenerates src/generated/<method>/ from methods/<method>/. Needs PIPELEX_API_KEY
# and nothing else: POST /v1/codegen is served on the default hosted URL.
# Deliberately OUT of `make all`, for the same reason test-e2e is: key + network.
codegen: ## Regenerate the typed artifacts in src/generated/ from methods/ (needs PIPELEX_API_KEY)
	npm run codegen

# The CI half of the trust chain: pure hashing, no key, no network. Proves each
# committed tree still agrees with its own lock, and that the .mthds sources it
# was generated from have not changed since. Part of `make check`.
codegen-check: ## Verify src/generated/ is current, offline (no API key needed)
	npm run codegen:check

# The semantic gate the offline check deliberately cannot be: re-resolves each
# method live and compares crate fingerprints. Keyed and online, so it stays out
# of `make all` — run it before a release, or after touching methods/.
codegen-verify: ## Ask the engine whether the committed crates are still current (needs PIPELEX_API_KEY)
	npm run codegen:verify

# Scaffolds a method that lives on the platform (a catalog id) or in a published
# package (an address) into the app: the manifest, the generated tree, the action
# trio, the narrower, the form and a tab. One-shot — it never overwrites, and
# `npm run codegen` is the refresh. Keyed and online, so it stays out of `make all`.
add-method: ## Scaffold a method into the app from METHOD=<mt_… | github.com/owner/repo[/pkg][@tag]> (needs PIPELEX_API_KEY)
	@if [ -z "$(METHOD)" ]; then \
		echo "usage: make add-method METHOD=<mt_… | github.com/owner/repo[/pkg][@tag]> [PIPE=<pipe_code>] [NAME=<dir-name>] [LABEL=<tab label>] [DRY_RUN=1]"; \
		exit 2; \
	fi
	npm run add-method -- $(METHOD) $(if $(PIPE),--pipe $(PIPE)) $(if $(NAME),--name $(NAME)) $(if $(LABEL),--label "$(LABEL)") $(if $(DRY_RUN),--dry-run)

test: ## Run tests (single pass)
	npm run test

test-watch: ## Run tests in watch mode
	npm run test:watch

# OPTIONAL. The live-API specs hit the real Pipelex API (cost an LLM call, need
# PIPELEX_API_KEY) and auto-skip without a key. Confirmation gate guards against
# accidental spend; skipped in CI / non-interactive shells, or pass CONFIRM=1.
confirm-live-e2e:
	@if [ -z "$$CI" ] && [ -z "$$CONFIRM" ] && [ -t 0 ]; then \
		printf "⚠️  Playwright e2e runs against the LIVE Pipelex API and costs an LLM call per live spec.\n"; \
		printf "Continue? [y/N] "; \
		read ans; \
		case "$$ans" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac; \
	fi

# ALLOW_OWN is a target-specific variable, so it reaches the port-check
# prerequisite: Playwright reusing THIS checkout's dev server is the point,
# reusing another one silently is the bug.
test-e2e test-e2e-ui: ALLOW_OWN = 1

test-e2e: confirm-live-e2e port-check ## Run OPTIONAL Playwright e2e (LIVE API — needs PIPELEX_API_KEY, costs an LLM call; auto-skips without a key)
	npm run test:e2e

test-e2e-ui: confirm-live-e2e port-check ## Same as test-e2e, with the Playwright UI runner
	npm run test:e2e:ui

agent-test: ## Run tests, silent on success (for agents)
	@OUTPUT=$$(npm run test --silent 2>&1); STATUS=$$?; if [ $$STATUS -ne 0 ]; then echo "$$OUTPUT"; exit $$STATUS; fi

check: lint format-check typecheck codegen-check ## Run lint, format check, type check, and the offline codegen check

all: check test build ## Full validation: check + test + build (excludes e2e — see test-e2e)

install: ## Install dependencies
	npm install

lock: ## Regenerate package-lock.json without installing
	npm install --package-lock-only

clean: ## Remove build artifacts and caches
	rm -rf .next node_modules/.cache

# ── Local Pipelex package development ──────────────────────────────────────
# By default, `make install` fetches the published `@pipelex/sdk` and
# `@pipelex/mthds-form` packages from npm. `make use-local` packs and installs
# the siblings ../pipelex-sdk-js and ../mthds-form so you can develop them and
# the starter side-by-side. `make use-npm` restores the latest published
# versions and re-pins package.json to them.
#
# We use `npm pack` + tarball install rather than a symlink because Next.js
# 16's Turbopack does not follow symlinked workspace packages — `npm run dev`
# and `npm run build` both fail with "Module not found" against a symlinked
# node_modules entry. The tarball install gives us a real directory that
# Turbopack resolves correctly. Re-run `make use-local` after every edit
# to pick up changes.
#
# Both tarballs go through ONE `npm install` call on purpose: a second
# `--no-save` install re-reconciles node_modules against the lockfile and can
# silently revert the first tarball to the registry version.
#
# The pack steps pass `--ignore-scripts` on purpose: each sibling's `prepare`
# script re-runs its build during `npm pack`, and mthds-form's build (tsup)
# prints to stdout — which would corrupt the captured tarball filename. We
# build explicitly just before packing, so skipping `prepare` loses nothing.

use-local: ## Pack and install ../pipelex-sdk-js and ../mthds-form into node_modules for local development
	@if [ ! -d ../pipelex-sdk-js ]; then \
		echo "ERROR: ../pipelex-sdk-js not found — expected as a sibling directory."; exit 1; \
	fi
	@if [ ! -d ../mthds-form ]; then \
		echo "ERROR: ../mthds-form not found — expected as a sibling directory."; exit 1; \
	fi
	@echo "Building ../pipelex-sdk-js so dist/ is up-to-date..."
	cd ../pipelex-sdk-js && npm run build
	@echo "Packing ../pipelex-sdk-js into a tarball..."
	@cd ../pipelex-sdk-js && rm -f pipelex-sdk-*.tgz && TARBALL=$$(npm pack --silent --ignore-scripts) && mv $$TARBALL /tmp/pipelex-sdk-local.tgz
	@echo "Building ../mthds-form so dist/ is up-to-date..."
	cd ../mthds-form && npm run build
	@echo "Packing ../mthds-form into a tarball..."
	@cd ../mthds-form && rm -f pipelex-mthds-form-*.tgz && TARBALL=$$(npm pack --silent --ignore-scripts) && mv $$TARBALL /tmp/pipelex-mthds-form-local.tgz
	rm -rf node_modules/@pipelex/sdk node_modules/@pipelex/mthds-form
	npm install /tmp/pipelex-sdk-local.tgz /tmp/pipelex-mthds-form-local.tgz --no-save --silent
	@rm -f /tmp/pipelex-sdk-local.tgz /tmp/pipelex-mthds-form-local.tgz
	@echo "Now using local ../pipelex-sdk-js and ../mthds-form (tarball installs). Re-run after every edit. 'make use-npm' to switch back."

# The `@latest` tag is load-bearing. A bare `npm install @pipelex/sdk` re-resolves
# the range already in package.json, so coming off `make use-local` with a stale
# caret range restores that range's newest match rather than the current release —
# silently DOWNGRADING, since both packages are pre-1.0 and `^0.a.b` will not
# cross a minor. `@latest` fetches the published release and rewrites the range
# to match it.
use-npm: ## Restore the latest npm-published @pipelex/sdk and @pipelex/mthds-form packages
	rm -rf node_modules/@pipelex/sdk node_modules/@pipelex/mthds-form
	npm install @pipelex/sdk@latest @pipelex/mthds-form@latest
	@echo "Restored npm-published @pipelex/sdk $$(node -p "require('./node_modules/@pipelex/sdk/package.json').version") and @pipelex/mthds-form $$(node -p "require('./node_modules/@pipelex/mthds-form/package.json').version"). Run 'make use-local' to switch back."

ul: use-local ## Alias for use-local
un: use-npm ## Alias for use-npm
