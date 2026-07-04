import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Sweep schedule controls (#52) — the Agent triggers card's schedule section,
 * against the mock backend (Worker-matching GET/POST /apps/:id/schedule).
 *
 * Pins:
 *   • the historical default renders (weekly, Monday, 09:00 UTC),
 *   • daily hides the day picker; edits save and persist across navigation,
 *   • the header no longer promises a hardcoded Monday for everyone.
 */

async function openApp(page: import("@playwright/test").Page): Promise<string> {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, { asc: true });
  await page.goto(`/index.html#/apps/${appId}`);
  await expect(page.getByRole("heading", { name: "Agent triggers" })).toBeVisible();
  return appId;
}

test.describe("sweep schedule (#52)", () => {
  test("default renders; daily hides the day picker; save persists", async ({ page }) => {
    const appId = await openApp(page);

    await expect(page.locator("#schCadence")).toHaveValue("weekly");
    await expect(page.locator("#schDay")).toHaveValue("1"); // Monday
    await expect(page.locator("#schHour")).toHaveValue("9");
    await expect(page.locator("#schDay")).toBeVisible();

    await page.locator("#schCadence").selectOption("daily");
    await expect(page.locator("#schDay")).toBeHidden(); // day is meaningless daily
    await page.locator("#schHour").selectOption("6");
    await page.locator("#schSave").click();
    await expect(page.getByText(/Saved — the agent sweeps this app/)).toBeVisible();

    // persists in the backend: away and back re-fetches
    await page.goto(`/index.html#/`);
    await page.goto(`/index.html#/apps/${appId}`);
    await expect(page.locator("#schCadence")).toHaveValue("daily");
    await expect(page.locator("#schHour")).toHaveValue("6");
  });

  test("the dashboard header no longer hardcodes Monday-for-everyone", async ({ page }) => {
    await gotoMockDashboard(page);
    await expect(page.getByText(/on each app's schedule/)).toBeVisible();
    await expect(page.getByText(/every Monday 09:00 UTC \(and any competitors/)).toHaveCount(0);
  });
});
