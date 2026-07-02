import { test } from "@playwright/test";

/**
 * Mirrors the SDK's `DEFAULT_API_BASE_URL` — what a bare `PipelexApiClient`
 * falls back to when `PIPELEX_BASE_URL` is unset. Duplicated as a literal
 * because the published `@pipelex/sdk` is ESM-only (its `exports` map has no
 * `require`/`default` condition) and Playwright loads spec files as CJS, so
 * the constant can't be imported at runtime here. If the SDK ever ships a
 * `default` export condition, import `DEFAULT_API_BASE_URL` instead.
 */
export const HOSTED_API_BASE_URL = "https://api.pipelex.com";

/**
 * Guard for the live-API e2e specs (extract / summarize-pdf / generate-image).
 *
 * These hit the real Pipelex API — they cost an LLM call and need
 * PIPELEX_API_KEY. When the key is absent (e.g. a fresh fork that hasn't
 * configured credentials) the suite skips cleanly instead of failing with a
 * confusing auth error. `playwright.config.ts` loads `.env.local`, so a key set
 * there is visible here.
 *
 * The offline error-UX spec (error-display.spec.ts) is deliberately NOT
 * guarded — it needs no key and runs out of the box.
 */
export function requireLiveApi() {
  test.beforeEach(() => {
    test.skip(
      !process.env.PIPELEX_API_KEY,
      "Live-API e2e: set PIPELEX_API_KEY in .env.local to run (or delete e2e/).",
    );
  });
}
