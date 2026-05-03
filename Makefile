.PHONY: help run dev build start lint format format-check typecheck test test-watch test-e2e test-e2e-ui agent-test check clean install lock all use-local use-npm ul un

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

typecheck: ## Run TypeScript type checking
	npx tsc --noEmit

test: ## Run tests (single pass)
	npm run test

test-watch: ## Run tests in watch mode
	npm run test:watch

test-e2e: ## Run Playwright e2e tests (hits live Pipelex API — needs PIPELEX_API_KEY)
	npm run test:e2e

test-e2e-ui: ## Run Playwright e2e tests with the UI runner
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

# ── Local mthds SDK development ────────────────────────────────────────────
# By default, `make install` fetches the published `mthds` package from npm.
# `make use-local` symlinks the sibling ../mthds-js into node_modules so you
# can develop the SDK and the starter side-by-side. `make use-npm` restores
# the npm version. (Mirrors playroom's use-local / use-github pattern.)

use-local: ## Symlink ../mthds-js into node_modules for local SDK development
	@if [ ! -d ../mthds-js ]; then \
		echo "ERROR: ../mthds-js not found — expected as a sibling directory."; exit 1; \
	fi
	@echo "Building ../mthds-js so dist/ is up-to-date..."
	cd ../mthds-js && npm run build
	rm -rf node_modules/mthds
	ln -s ../../mthds-js node_modules/mthds
	@echo "Now using local ../mthds-js (symlink). Run 'make use-npm' to switch back."

use-npm: ## Restore the npm-published mthds package
	rm -rf node_modules/mthds
	npm install mthds
	@echo "Restored npm-published mthds. Run 'make use-local' to switch back."

ul: use-local ## Alias for use-local
un: use-npm ## Alias for use-npm
