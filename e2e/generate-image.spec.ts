import { test, expect } from "@playwright/test";

// This test hits the live Pipelex API configured by PIPELEX_API_URL +
// PIPELEX_API_KEY in `.env.local`, and costs an image-generation call.
// Image generation is slow, so the timeout is generous.
test("generates an image from a prompt", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByRole("tab", { name: /image generation/i }).click();

  await page.getByLabel("Image prompt").fill("A simple red circle on a plain white background.");
  await page.getByRole("button", { name: /generate image/i }).click();

  const result = page.getByRole("region", { name: "Generated image" });
  await expect(result).toBeVisible({ timeout: 150_000 });

  const image = result.getByRole("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /\S/);
});
