import { test, expect } from "@playwright/test";

// Verifies the developer-friendly error UX when the Pipelex API isn't reachable.
// Runs against whatever PIPELEX_API_URL the dev server is using; the default
// .env in this repo points at http://127.0.0.1:8081 with no API there, which
// is the "I just cloned the starter" failure mode this UX is designed for.
//
// Skip the whole suite if the API responds — we'd hit the live happy path
// instead, which is already covered by extract.spec.ts.
test.describe("offline-API error display", () => {
  test.beforeAll(async () => {
    const apiUrl = process.env.PIPELEX_API_URL ?? "http://127.0.0.1:8081";
    let reachable = false;
    try {
      const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    test.skip(
      reachable,
      `Pipelex API at ${apiUrl} is reachable; offline test would hit the live API`,
    );
  });

  test("renders structured error with title, recovery hint, and details", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Input text").fill("Apple announced new products today.");
    await page.getByRole("button", { name: /extract entities/i }).click();

    // Next.js renders its own role="alert" route announcer, so scope to ours
    // by filtering for the title text that ErrorDisplay always renders.
    const alert = page.getByRole("alert").filter({ hasText: "Pipelex API not reachable" });
    await expect(alert).toBeVisible({ timeout: 30_000 });

    // The recovery hint should include a runnable command pointing at the
    // sibling pipelex-api repo.
    await expect(alert).toContainText(/cd \.\.\/pipelex-api/);
    await expect(alert).toContainText("make run");

    // Technical details are collapsible but present in the DOM.
    await expect(alert.getByText("Technical details")).toBeVisible();
  });
});
