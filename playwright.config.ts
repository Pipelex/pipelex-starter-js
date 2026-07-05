import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Load .env.local (and friends) exactly like Next does, so the live-API specs
// can detect PIPELEX_API_KEY and skip cleanly when it's missing (see
// e2e/liveApi.ts). Silent logger keeps `make test-e2e` output uncluttered.
loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? "github" : "list",
  // Pipeline runs hit a real LLM and can take a while; bump the per-test timeout.
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: isCI ? "npm run build && npm start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
