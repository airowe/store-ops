import { test, expect, type Page } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * #55 — next to the screenshot gallery (#47), the audit card renders an
 * IMPROVEMENT PANEL: the dead-end grade turned into prioritized, quantified,
 * grade-aware levers ("Add a 6th screenshot → +10 pts · C → B"), sorted
 * biggest-win-first, with the make-it skill linkout. Honest by construction:
 *
 *   1. readable, sub-A listing → the panel renders ≥1 lever with a +delta badge,
 *      a grade transition, and the ParthJadhav/app-store-screenshots linkout.
 *   2. conversion framing only — never a ranking claim.
 *   3. the unreadable "?" set (honesty rule #41) → NO panel.
 *   4. an A-grade listing (no headroom) → NO panel (never over-sell).
 */

const SHOTS_SKILL = "https://github.com/ParthJadhav/app-store-screenshots";

async function latestRunId(page: Page, appId: string): Promise<string> {
  return await page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
    return detail.runs[0].id as string;
  }, appId);
}

test.describe("screenshot improvement panel (#55)", () => {
  test("renders quantified levers next to the gallery for a readable, sub-A listing", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // com.demo.subB → 3 iPhone + 2 iPad, tall → grade C with real headroom: a
    // count lever (+20, C → B). Readable (real URLs) so the gallery + panel show.
    const id = await seedAppWithRun(page, { name: "SubB", bundleId: "com.demo.subB" });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".audit-card");
    const panel = card.locator(".shot-levers");
    await expect(panel).toBeVisible();

    // At least one quantified lever row.
    const rows = panel.locator(".lever-row");
    expect(await rows.count()).toBeGreaterThan(0);

    // A point-delta badge with a "+".
    await expect(panel.locator(".lever-delta").first()).toContainText("+");

    // A grade transition element (e.g. "C → B").
    await expect(panel.locator(".lever-grade").first()).toContainText(/[A-F?]\s*→\s*[A-F]/);

    // The make-it skill linkout points at the ParthJadhav repo.
    const link = panel.locator(".lever-link a").first();
    await expect(link).toHaveAttribute("href", SHOTS_SKILL);

    // The panel sits beside the gallery + grade chip in the same card.
    await expect(card.locator(".shots-gallery")).toBeVisible();
    await expect(card.locator(".grade-chip")).toBeVisible();
  });

  test("frames levers as conversion, never ranking", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { name: "SubB", bundleId: "com.demo.subB" });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const note = page.locator(".audit-card .shot-levers .lever-note");
    await expect(note).toContainText(/conversion/i);
    await expect(note).not.toContainText(/\brank/i);
  });

  test("renders NO panel when screenshots are unreadable (the '?' honesty case #41)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // Reuse the unreadable bundle from the gallery E2E → grade "?", no URLs, no levers.
    const id = await seedAppWithRun(page, { name: "Ghost", bundleId: "com.ghost.unreadable" });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".audit-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".shot-levers")).toHaveCount(0);
  });

  test("renders NO panel for an A-grade listing (no headroom → no over-selling)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // com.full.tallapp → 7 iPhone + 4 iPad, tall → grade A: shotLevers yields [].
    const id = await seedAppWithRun(page, { name: "FullA", bundleId: "com.full.tallapp" });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".audit-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".grade-chip")).toContainText("A");
    await expect(card.locator(".shot-levers")).toHaveCount(0);
  });
});
