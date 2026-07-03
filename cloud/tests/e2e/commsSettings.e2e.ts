import { test, expect } from "@playwright/test";
import { gotoMockDashboard } from "./helpers.js";

/**
 * Communication settings (comms-prefs Phase 3) — the web's first settings page.
 * Drives the deterministic mock backend (mock.js mirrors the Worker's
 * /account/notifications + /account/rank-cadence + the /auth/me carry-through).
 *
 * Pins:
 *   • the header Settings link routes to #/settings,
 *   • the digest toggle round-trips and PERSISTS across a reload,
 *   • the cadence control round-trips and persists,
 *   • the push line is informational only (no toggle the web can't honor),
 *   • honest copy: turning the digest off says the agent keeps working.
 */

test.describe("communication settings (comms-prefs)", () => {
  test("settings link routes; digest toggle flips and persists", async ({ page }) => {
    await gotoMockDashboard(page);

    await page.locator("#settingsLink").click();
    await expect(page.locator("h2")).toHaveText("Settings");

    const digest = page.locator("#digestToggle");
    await expect(digest).toBeVisible();
    await expect(digest).toHaveText("On"); // default = weekly

    // honest copy is on the page
    await expect(page.getByText(/the agent keeps working/i)).toBeVisible();

    await digest.click();
    await expect(digest).toHaveText("Off");

    // persists in the BACKEND: navigate away and back — viewSettings re-fetches
    // /auth/me on every render, so this re-reads the recorded state (a full
    // page.reload() would fight the harness's deliberate hermetic-wipe of the
    // mock DB in gotoMockDashboard's init script).
    await page.locator(".backlink").click();
    await page.locator("#settingsLink").click();
    await expect(page.locator("#digestToggle")).toHaveText("Off");

    // and back on
    await page.locator("#digestToggle").click();
    await expect(page.locator("#digestToggle")).toHaveText("On");
  });

  test("rank-check cadence flips weekly↔daily and persists", async ({ page }) => {
    await gotoMockDashboard(page);
    await page.locator("#settingsLink").click();

    const weekly = page.locator("#cadenceWeekly");
    const daily = page.locator("#cadenceDaily");
    await expect(weekly).toBeVisible();
    // default: weekly selected (full opacity), daily dimmed
    await expect(weekly).toHaveCSS("opacity", "1");

    await daily.click();
    await expect(daily).toHaveCSS("opacity", "1");
    await expect(weekly).toHaveCSS("opacity", "0.5");

    // same away-and-back persistence check (see the digest test for why not reload)
    await page.locator(".backlink").click();
    await page.locator("#settingsLink").click();
    await expect(page.locator("#cadenceDaily")).toHaveCSS("opacity", "1");
  });

  test("push is informational only — no interactive control", async ({ page }) => {
    await gotoMockDashboard(page);
    await page.locator("#settingsLink").click();

    await expect(page.getByText("Run-ready push")).toBeVisible();
    await expect(page.getByText(/managed in the mobile app/i)).toBeVisible();
    // exactly the two comms controls exist — no push toggle
    await expect(page.locator("#digestToggle")).toHaveCount(1);
    await expect(page.locator("button#pushToggle")).toHaveCount(0);
  });
});
