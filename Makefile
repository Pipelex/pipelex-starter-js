.PHONY: help run dev build start lint format format-check typecheck codegen codegen-check codegen-verify test test-watch test-e2e test-e2e-ui confirm-live-e2e agent-test check clean install lock all use-local use-npm ul un

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

run: ## Start dev server
	npm run dev

dev: run ## Alias for run

build: ## Production build
	npm run build

start: ## Start production server
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

test-e2e: confirm-live-e2e ## Run OPTIONAL Playwright e2e (LIVE API — needs PIPELEX_API_KEY, costs an LLM call; auto-skips without a key)
	npm run test:e2e

test-e2e-ui: confirm-live-e2e ## Same as test-e2e, with the Playwright UI runner
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

# ── Local Pipelex SDK development ──────────────────────────────────────────
# By default, `make install` fetches the published `@pipelex/sdk` package from
# npm. `make use-local` packs and installs the sibling ../pipelex-sdk-js so you
# can develop the SDK and the starter side-by-side. `make use-npm` restores the
# latest published version and re-pins package.json to it.
#
# We use `npm pack` + tarball install rather than a symlink because Next.js
# 16's Turbopack does not follow symlinked workspace packages — `npm run dev`
# and `npm run build` both fail with "Module not found" against a symlinked
# node_modules entry. The tarball install gives us a real directory that
# Turbopack resolves correctly. Re-run `make use-local` after every SDK edit
# to pick up changes.

use-local: ## Pack and install ../pipelex-sdk-js into node_modules for local SDK development
	@if [ ! -d ../pipelex-sdk-js ]; then \
		echo "ERROR: ../pipelex-sdk-js not found — expected as a sibling directory."; exit 1; \
	fi
	@echo "Building ../pipelex-sdk-js so dist/ is up-to-date..."
	cd ../pipelex-sdk-js && npm run build
	@echo "Packing ../pipelex-sdk-js into a tarball..."
	@cd ../pipelex-sdk-js && rm -f pipelex-sdk-*.tgz && TARBALL=$$(npm pack --silent) && mv $$TARBALL /tmp/pipelex-sdk-local.tgz
	rm -rf node_modules/@pipelex/sdk
	npm install /tmp/pipelex-sdk-local.tgz --no-save --silent
	@rm -f /tmp/pipelex-sdk-local.tgz
	@echo "Now using local ../pipelex-sdk-js (tarball install). Re-run after every SDK edit. 'make use-npm' to switch back."

# The `@latest` tag is load-bearing. A bare `npm install @pipelex/sdk` re-resolves
# the range already in package.json, so coming off `make use-local` with a stale
# caret range restores that range's newest match rather than the current release —
# silently DOWNGRADING, since the SDK is pre-1.0 and `^0.a.b` will not cross a minor.
# `@latest` fetches the published release and rewrites the range to match it.
use-npm: ## Restore the latest npm-published @pipelex/sdk package
	rm -rf node_modules/@pipelex/sdk
	npm install @pipelex/sdk@latest
	@echo "Restored npm-published @pipelex/sdk $$(node -p "require('./node_modules/@pipelex/sdk/package.json').version"). Run 'make use-local' to switch back."

ul: use-local ## Alias for use-local
un: use-npm ## Alias for use-npm
