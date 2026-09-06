import { test, expect } from "@playwright/test";
import { showPlainForm } from "./designedPage";
import { requireLiveApi } from "./liveApi";

// This test hits the live Pipelex API configured by PIPELEX_BASE_URL +
// PIPELEX_API_KEY in `.env.local`, and costs an LLM call. It uses the sample
// PDF shipped in public/ — the "Use sample PDF" button runs it through the
// same encode→Server Action path as a real upload. It skips cleanly when no
// key is set (see e2e/liveApi.ts).
requireLiveApi();

// Runs in the default execution mode (durable: start + poll).
test("summarizes the sample PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /pdf summary/i }).click();
  // On the plain form, for `extract.spec.ts`'s reason: this tab is designed.
  await showPlainForm(page);

  await page.getByRole("button", { name: /use sample pdf/i }).click();

  // The sample is fetched and base64-encoded; submit enables once it's ready.
  const summarize = page.getByRole("button", { name: /summarize pdf/i });
  await expect(summarize).toBeEnabled();
  await summarize.click();

  const result = page.getByRole("region", { name: "Document summary" });
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(result.getByText("Key points")).toBeVisible();
});
