.PHONY: help run dev build start lint format format-check typecheck test test-watch test-e2e test-e2e-ui confirm-live-e2e agent-test check clean install lock all use-local use-npm ul un

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

typecheck: ## Run TypeScript type checking (app + e2e specs)
	npm run typecheck
	npm run typecheck:e2e

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

check: lint format-check typecheck ## Run lint, format check, and type check

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
