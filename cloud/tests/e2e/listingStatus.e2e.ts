import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Status vs fixes separation (#71-C) + suggestion-carrying findings (#71-B).
 *
 * Pins:
 *   • context findings (live version, pricing, confirmed category, single
 *     locale) render in the compact "Listing status" strip, NOT the fix list,
 *   • the category row reads as CONFIRMED (read from ASC), not a go-check chore,
 *   • suggestion copy is app-derived: the preview finding scripts from the
 *     run's real tracked keywords; the secondary-category finding names
 *     concrete adjacent categories.
 */

async function openKeyedRun(page: import("@playwright/test").Page): Promise<void> {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, { asc: true });
  const runId = await page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
    return detail.runs[0].id as string;
  }, appId);
  await page.goto(`/index.html#/runs/${runId}`);
  await expect(page.getByRole("heading", { name: /listing audit/i })).toBeVisible();
}

test.describe("listing status strip (#71-C)", () => {
  test("context findings render in the status strip, not the fix list", async ({ page }) => {
    await openKeyedRun(page);

    const strip = page.locator("#listingStatus");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Live version");
    await expect(strip).toContainText("Category confirmed:");
    await expect(strip).toContainText("Live in 1 locale");

    // the actionable fix list must NOT carry the status rows
    const fixes = page.locator(".findings");
    await expect(fixes.getByText("Live version 1.4.2")).toHaveCount(0);
    await expect(fixes.getByText(/Category confirmed/)).toHaveCount(0);
  });

  test("suggestion copy is app-derived (#71-B): preview script + category fits", async ({ page }) => {
    await openKeyedRun(page);
    const fixes = page.locator(".findings");
    // preview finding scripts from the run's first tracked keyword
    await expect(fixes.getByText(/Script it from your targets/)).toBeVisible();
    await expect(fixes.getByText(/first 3 seconds/)).toBeVisible();
    // secondary category carries concrete adjacent-category fits
    await expect(fixes.getByText(/the closest fits are/)).toBeVisible();
  });
});
