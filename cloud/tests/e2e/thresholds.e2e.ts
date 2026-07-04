import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Agent triggers card (#53) — the app page's run-threshold controls, against
 * the mock backend (Worker-matching GET/POST /apps/:id/thresholds).
 *
 * Pins:
 *   • defaults render (both triggers on, notify-only off, drop empty),
 *   • edits round-trip and PERSIST across away-and-back navigation,
 *   • honest copy: measuring never stops — triggers only gate the nag.
 */

async function openApp(page: import("@playwright/test").Page): Promise<string> {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, { asc: true });
  await page.goto(`/index.html#/apps/${appId}`);
  await expect(page.getByRole("heading", { name: "Agent triggers" })).toBeVisible();
  return appId;
}

test.describe("agent triggers (#53)", () => {
  test("defaults render; edits save and persist across navigation", async ({ page }) => {
    const appId = await openApp(page);

    const unranked = page.locator("#thUnranked");
    const notifyOnly = page.locator("#thNotifyOnly");
    await expect(unranked).toBeChecked(); // default = today's behavior
    await expect(page.locator("#thCompetitors")).toBeChecked();
    await expect(notifyOnly).not.toBeChecked();
    await expect(page.locator("#thRankDrop")).toHaveValue("");

    // honest copy on the card
    await expect(page.getByText(/still measures everything every sweep/i)).toBeVisible();

    // flip unranked off, set a drop threshold + muted keyword + notify-only
    await unranked.uncheck();
    await page.locator("#thRankDrop").fill("10");
    await page.locator("#thMutedKw").fill("Pantry, recipe");
    await notifyOnly.check();
    await page.locator("#thSave").click();
    await expect(page.getByText(/Saved\./)).toBeVisible();

    // persists in the backend: navigate away and back (re-fetches on render)
    await page.goto(`/index.html#/`);
    await page.goto(`/index.html#/apps/${appId}`);
    await expect(page.locator("#thUnranked")).not.toBeChecked();
    await expect(page.locator("#thRankDrop")).toHaveValue("10");
    // reconciled from the server: normalized lowercase list
    await expect(page.locator("#thMutedKw")).toHaveValue("pantry, recipe");
    await expect(page.locator("#thNotifyOnly")).toBeChecked();
  });

  test("an invalid drop threshold is rejected loudly, not silently defaulted", async ({ page }) => {
    await openApp(page);
    await page.locator("#thRankDrop").fill("999");
    await page.locator("#thSave").click();
    await expect(page.locator(".toast, #toast").first()).toContainText(/rankDropAtLeast/);
  });
});
