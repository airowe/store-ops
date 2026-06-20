import { test, expect, type Page } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * #47 — the run/audit page renders the app's REAL App Store screenshots in a
 * before.click-style gallery, next to the screenshot grade + findings + "Fix
 * this" linkout. Two halves, both load-bearing:
 *
 *   1. when we hold real screenshot URLs → the gallery renders the actual <img>
 *      shots (full-bleed frames), framed as a conversion signal.
 *   2. when the set is UNREADABLE (the "?" grade / public-data honesty rule #41)
 *      → NO gallery renders; only the "couldn't read — connect ASC" state stands.
 */

async function latestRunId(page: Page, appId: string): Promise<string> {
  return await page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
    return detail.runs[0].id as string;
  }, appId);
}

test.describe("screenshot gallery (#47)", () => {
  test("renders the real App Store screenshots as images, inside the audit card, conversion-framed", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // A normal bundle → the mock returns a readable screenshot set with URLs.
    const id = await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The gallery lives inside the listing-audit card (next to the grade + findings).
    const card = page.locator(".audit-card");
    const gallery = card.locator(".shots-gallery");
    await expect(gallery).toBeVisible();

    // It renders REAL screenshot <img> elements (not an empty/placeholder frame).
    const imgs = gallery.locator(".shot-frame .shot-img");
    expect(await imgs.count()).toBeGreaterThan(0);
    // Each frame's img points at an actual App Store image URL we graded.
    const firstSrc = await imgs.first().getAttribute("src");
    expect(firstSrc).toMatch(/^https?:\/\/.*\.png/);

    // Framed as a conversion signal, not ranking (consistent with the impact chips).
    await expect(gallery.locator(".shots-note")).toContainText(/conversion/i);

    // The gallery sits next to the screenshot grade chip in the same card.
    await expect(card.locator(".grade-chip")).toBeVisible();
  });

  test("renders NO gallery when screenshots are unreadable from public data (the '?' honesty case)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // A bundle the public API can't read screenshots for → grade "?", no URLs.
    const id = await seedAppWithRun(page, { name: "Ghost", bundleId: "com.ghost.unreadable" });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".audit-card");
    await expect(card).toBeVisible();

    // Honesty rule (#41): no gallery, no stray screenshot <img>.
    await expect(card.locator(".shots-gallery")).toHaveCount(0);
    await expect(card.locator(".shot-img")).toHaveCount(0);

    // The existing "couldn't read — connect App Store Connect" state stands alone.
    await expect(card.locator(".grade-chip")).toContainText(/\?/);
    await expect(card).toContainText(/couldn't read screenshots from public data/i);
  });
});
