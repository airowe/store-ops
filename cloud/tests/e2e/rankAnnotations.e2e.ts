import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Rank-timeline annotations (#62 T1) — the app page's rank trend overlays
 * observed changes: ▲ your approved pushes, ◆ competitor visible diffs.
 *
 * Pins:
 *   • no observed changes → NO markers and NO legend (honest silence),
 *   • an approved run + a confirmed competitor produce their markers,
 *   • the legend carries the honesty caveats (partial visibility,
 *     correlation-not-causation, tracked-only history).
 */

async function approveFirstRun(page: import("@playwright/test").Page, appId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const EM = "demo@store-ops.dev";
    const detail = await (await M.handle("GET", `/apps/${id}`, null, EM)).json();
    await M.handle("POST", `/runs/${detail.runs[0].id}/approve`, {}, EM);
  }, appId);
}

async function confirmACompetitor(page: import("@playwright/test").Page, appId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const EM = "demo@store-ops.dev";
    const r = await (await M.handle("POST", `/apps/${id}/competitors/discover`, null, EM)).json();
    const first = r.competitors[0];
    await M.handle("POST", `/apps/${id}/competitors/${first.key}/confirm`, null, EM);
  }, appId);
}

test.describe("rank timeline annotations (#62)", () => {
  test("no observed changes → no markers, no legend", async ({ page }) => {
    await gotoMockDashboard(page);
    const appId = await seedAppWithRun(page, { asc: true });
    await page.goto(`/index.html#/apps/${appId}`);
    await expect(page.locator("svg.spark")).toBeVisible();
    await expect(page.locator("svg.spark .anno")).toHaveCount(0);
    await expect(page.locator(".anno-legend")).toHaveCount(0);
  });

  test("approved push + competitor change render their markers and the honest legend", async ({ page }) => {
    await gotoMockDashboard(page);
    const appId = await seedAppWithRun(page, { asc: true });
    await approveFirstRun(page, appId);
    await confirmACompetitor(page, appId);
    await page.goto(`/index.html#/apps/${appId}`);

    await expect(page.locator("svg.spark")).toBeVisible();
    await expect(page.locator("svg.spark .anno-push")).toHaveCount(1);
    await expect(page.locator("svg.spark .anno-competitor")).toHaveCount(1);

    const legend = page.locator(".anno-legend");
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("your approved pushes");
    await expect(legend).toContainText(/keyword fields aren't public/);
    await expect(legend).toContainText(/Correlation, not causation/);
  });
});
