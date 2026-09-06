import { test, expect } from "@playwright/test";
import { ctaLabel } from "./designedPage";
import { requireLiveApi } from "./liveApi";

// The designed view, end to end against the live API — the one spec that runs a
// method through the page a model laid out rather than through the kernel's
// plain form. It costs an LLM call and skips cleanly with no key, like its
// siblings.
requireLiveApi();

test("runs the method from its designed page and shows the result in the slot", async ({
  page,
}) => {
  // Read out of the committed layout rather than spelled here, so a re-produced
  // design moves this spec with it instead of breaking it.
  const label = ctaLabel("extract-entities");

  await page.goto("/");
  await page.getByRole("tab", { name: /text entities/i }).click();

  // The page opens designed, seeded with the example's sample text — the store
  // the page binds to is the one the form seeded, which is the whole point.
  await expect(page.getByRole("radio", { name: "Designed" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: label }).click();

  // `ResultSlotProvider` hands the page the same fragment the plain view renders
  // under its form, so the result is found by the region the app names — not by
  // anything the layout says.
  const result = page.getByRole("region", { name: "Extracted entities" });
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(result.getByText(/tim cook/i)).toBeVisible();

  // One store: the value the page ran with is the value the plain form shows.
  await page.getByRole("radio", { name: "Plain form" }).click();
  await expect(page.getByRole("textbox", { name: "Text" })).toHaveValue(/Tim Cook/);
});
