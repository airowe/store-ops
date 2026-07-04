import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Competitor watch list (#72-C) — the app page's Competitors card, against the
 * mock backend (which mirrors the Worker's list/discover/add/confirm/remove).
 *
 * Pins:
 *   • empty state is honest ("no competitors yet"),
 *   • Discover stores SUGGESTIONS (chip: "suggested") — never auto-watched,
 *   • confirming a suggestion flips it to "watched",
 *   • adding by name lands confirmed immediately,
 *   • Dismiss/Remove deletes the row.
 */

async function openApp(page: import("@playwright/test").Page): Promise<void> {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, { asc: true });
  await page.goto(`/index.html#/apps/${appId}`);
  await expect(page.getByRole("heading", { name: "Competitors" })).toBeVisible();
}

test.describe("competitor watch list (#72-C)", () => {
  test("discover → suggested chips → confirm → watched; nothing auto-watched", async ({ page }) => {
    await openApp(page);
    const panel = page.locator("#competitorsPanel");
    await expect(panel.getByText(/No competitors yet/)).toBeVisible();

    await page.locator("#discoverCompetitors").click();
    const suggested = panel.locator(".comp-row:has(.tag:text('suggested'))");
    await expect(suggested.first()).toBeVisible();
    // nothing is watched yet — discovery never silently tracks
    await expect(panel.locator(".tag", { hasText: "watched" })).toHaveCount(0);

    // confirm the first suggestion → becomes watched
    await suggested.first().getByRole("button", { name: "Watch" }).click();
    await expect(panel.locator(".tag", { hasText: "watched" })).toHaveCount(1);
  });

  test("add by name lands confirmed; Remove deletes it", async ({ page }) => {
    await openApp(page);
    const panel = page.locator("#competitorsPanel");

    await panel.getByPlaceholder(/Add by App Store name/).fill("Paprika Recipe Manager");
    await panel.getByRole("button", { name: "Add", exact: true }).click();

    const row = panel.locator(".comp-row", { hasText: "Paprika Recipe Manager" });
    await expect(row).toBeVisible();
    await expect(row.locator(".tag")).toHaveText("watched");

    await row.getByRole("button", { name: "Remove" }).click();
    await expect(panel.locator(".comp-row", { hasText: "Paprika Recipe Manager" })).toHaveCount(0);
  });

  test("dismissing a suggestion removes it without watching anything", async ({ page }) => {
    await openApp(page);
    const panel = page.locator("#competitorsPanel");
    await page.locator("#discoverCompetitors").click();

    const suggested = panel.locator(".comp-row:has(.tag:text('suggested'))");
    await expect(suggested.first()).toBeVisible(); // wait for discovery render
    const before = await suggested.count();
    expect(before).toBeGreaterThan(0);
    await suggested.first().getByRole("button", { name: "Dismiss" }).click();
    await expect(suggested).toHaveCount(before - 1);
    await expect(panel.locator(".tag", { hasText: "watched" })).toHaveCount(0);
  });
});
