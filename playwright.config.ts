import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Load .env.local (and friends) exactly like Next does, so the live-API specs
// can detect PIPELEX_API_KEY and skip cleanly when it's missing (see
// e2e/liveApi.ts). Silent logger keeps `make test-e2e` output uncluttered.
loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const isCI = !!process.env.CI;

// The dev-server port. `APP_PORT` is the single declaration — the Makefile
// exports it, package.json's `dev` and `start` scripts default to the same
// 4300, and this reads it so `make test-e2e APP_PORT=4301` stays coherent with
// the server it starts. The variable is deliberately not the ambient `PORT`,
// which hosts and other tools set for their own reasons and would silently
// move this server.
//
// Deliberately NOT 4100: the pipelex-server local stack publishes its sandbox
// container (the MTHDS build chatbot) on 127.0.0.1:4100, and that collision is
// silent rather than loud. Docker holds IPv4 loopback, so Next still binds the
// port on IPv6 and prints "Ready", while every webServer health check resolves
// to IPv4 and reaches the container's 404 instead — until `timeout` below
// expires with "Timed out waiting 120000ms from config.webServer". If that ever
// happens again, the first thing to run is `lsof -nP -iTCP:4300 -sTCP:LISTEN`.
const PORT = Number(process.env.APP_PORT ?? 4300);
const BASE_URL = `http://localhost:${PORT}`;

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
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: isCI ? "npm run build && npm start" : "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
