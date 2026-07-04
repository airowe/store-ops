import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * ASC key acquisition walkthrough (#67, launch half) — the credential panel
 * carries an in-app guide to MINT a key. Custody unchanged (per-run, never
 * stored) and the copy says so.
 */

test("the key walkthrough opens inline: exact ASC path, limited role, revocation note", async ({ page }) => {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, {});
  await page.goto(`/index.html#/apps/${appId}`);

  const toggle = page.locator("#keyGuideToggle");
  await expect(toggle).toBeVisible();
  await expect(page.locator(".key-guide")).toBeHidden();

  await toggle.click();
  const guide = page.locator(".key-guide");
  await expect(guide).toBeVisible();
  // the unguessable path + the least-privilege recommendation
  await expect(guide).toContainText("Integrations");
  await expect(guide).toContainText("Developer");
  await expect(guide).toContainText("don't grant Admin");
  // honest custody + revocation line
  await expect(guide).toContainText(/never stores it/);
  await expect(guide).toContainText(/revoke/);

  await toggle.click();
  await expect(guide).toBeHidden();
});
