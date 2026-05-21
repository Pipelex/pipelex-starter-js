import { test, expect } from "@playwright/test";

// This test hits the live Pipelex API configured by PIPELEX_API_URL +
// PIPELEX_API_KEY in `.env.local`. It will fail if those are unset or invalid.
test("extracts entities from sample text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /text entities/i }).click();

  const textarea = page.getByLabel("Input text");
  await textarea.fill(
    "Apple announced new products in Cupertino on March 5th, 2026, with Tim Cook presenting alongside Jony Ive.",
  );

  await page.getByRole("button", { name: /extract entities/i }).click();

  const results = page.getByRole("region", { name: "Extracted entities" });
  await expect(results).toBeVisible({ timeout: 90_000 });

  // Spot-check the obvious entities. The LLM may format slightly differently
  // (e.g. "Apple Inc." vs "Apple"), so we use partial matches.
  await expect(results.getByText(/tim cook/i)).toBeVisible();
  await expect(results.getByText(/apple/i)).toBeVisible();
  await expect(results.getByText(/march/i)).toBeVisible();
});
