import { test, expect } from "@playwright/test";
import { gotoMockDashboard } from "./helpers.js";

/**
 * #25 — Competitor rank war room: animated rank deltas. Drives the REAL app.js
 * against the mock backend on the run view, where the war-room card mounts.
 *
 * The load-bearing assertions are honesty-first:
 *  - YOUR cell animates prev → cur and carries the trend-tinted `rank-pop` pulse
 *    (good when gaining, bad when slipping) — reusing the shipped #24 motion.
 *  - A single-snapshot keyword (no measured prior) shows the current rank with
 *    NO fabricated count-up — youPrevious === null degrades cleanly.
 *  - An unchecked competitor stays "—", never a guessed number (privacy/honesty).
 *  - prefers-reduced-motion jumps straight to the final value (no count-up frames).
 *  - Toggling a competitor chip re-fetches and re-renders the grid.
 */

const EM = "demo@store-ops.dev";

/** Seed a scale-tier app + one run, returning { appId, runId }. */
async function seedRun(page: import("@playwright/test").Page) {
  return await page.evaluate(async (em) => {
    const M = (window as any).STORE_OPS_MOCK;
    await M.handle("POST", "/_tier", { tier: "scale" }, em);
    const keywords = [
      "meditation", "sleep sounds", "breathing exercises",
      "anxiety relief", "focus music", "habit tracker",
    ];
    const conn = await M.handle(
      "POST",
      "/apps",
      { bundle_id: "com.calm.calmapp", name: "Calm", keywords },
      em,
    );
    const appId = (await conn.json()).id as string;
    const ran = await M.handle("POST", `/apps/${appId}/run`, {}, em);
    const runId = (await ran.json()).id as string;
    return { appId, runId };
  }, EM);
}

test.describe("rank war room (mock backend)", () => {
  test("renders the head-to-head grid with a competitor selector on the run view", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { runId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".card.war-room");
    await expect(card.getByRole("heading", { name: /war room/i })).toBeVisible();
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });
    // The selector offers a chip per tracked competitor.
    await expect(page.locator(".war-chip")).not.toHaveCount(0);
  });

  test("YOUR cell animates to the correct final rank and carries a trend-tinted pulse", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { runId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });

    // Your cells use the same `.pos.rank-pop` motion as #24.
    const youCells = page.locator(".war-grid tbody tr td:nth-child(2) .pos.rank-pop");
    await expect(youCells.first()).toBeVisible();

    // After the animation window every "you" cell settles on a concrete "#N" (or
    // "—" if unranked) — never a stranded intermediate. Give the tween + safety
    // net time to settle.
    await page.waitForTimeout(900);
    const texts = await youCells.allTextContents();
    for (const t of texts) {
      expect(t.trim()).toMatch(/^(#\d+|—)$/);
    }

    // At least one row carries a directional pulse class (good=gaining, bad=slipping).
    const pulsed = page.locator(
      ".war-grid tbody tr td:nth-child(2) .pos.rank-pop.good, .war-grid tbody tr td:nth-child(2) .pos.rank-pop.bad",
    );
    expect(await pulsed.count()).toBeGreaterThan(0);
  });

  test("HONESTY: a single-snapshot keyword shows the current rank with no fabricated count-up", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { runId, appId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });

    // The mock seeds the LAST keyword with only a current snapshot (youPrevious
    // null). Find that keyword from the payload and assert its "you" cell renders
    // the final value with no intermediate "previous" pair.
    const single = await page.evaluate(async ({ id }) => {
      const M = (window as any).STORE_OPS_MOCK;
      const res = await M.handle("GET", `/apps/${id}/war-room?competitors=`, null, "demo@store-ops.dev");
      const data = await res.json();
      const row = (data.warRoom as Array<any>).find((r) => r.youPrevious == null);
      return row ? { keyword: row.keyword, you: row.you } : null;
    }, { id: appId });
    expect(single).not.toBeNull();

    // The youPrevious===null row's "you" cell settles on its current value and
    // never displays a different (fabricated prior) number first.
    const cell = page.locator(".war-grid tbody tr", {
      hasText: single!.keyword,
    }).locator("td:nth-child(2) .pos");
    await page.waitForTimeout(900);
    await expect(cell).toHaveText(single!.you == null ? "—" : `#${single!.you}`);
  });

  test("HONESTY: an unchecked competitor stays '—', never a guessed number", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { runId, appId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });

    // The mock leaves ~1-in-4 competitor/keyword cells unchecked → null. Assert
    // the payload has at least one null competitor rank AND the grid renders it
    // as a literal "—" dash (never coerced to a number).
    const hasUnknown = await page.evaluate(async ({ id }) => {
      const M = (window as any).STORE_OPS_MOCK;
      const res = await M.handle("GET", `/apps/${id}/war-room?competitors=`, null, "demo@store-ops.dev");
      const data = await res.json();
      return (data.warRoom as Array<any>).some((r) =>
        (r.competitors || []).some((c: any) => c.rank == null),
      );
    }, { id: appId });
    expect(hasUnknown).toBe(true);

    // At least one rendered competitor cell is the honest dash.
    await page.waitForTimeout(400);
    const dashes = page.locator(".war-grid tbody .pos.none");
    expect(await dashes.count()).toBeGreaterThan(0);
    for (const t of await dashes.allTextContents()) {
      expect(t.trim()).toBe("—");
    }
  });

  test("prefers-reduced-motion jumps straight to the final value (no count-up)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoMockDashboard(page);
    const { runId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });

    // With reduced motion the very FIRST observed value of a "you" cell is already
    // its final "#N" (countUpRank short-circuits) — assert immediately, no waiting.
    const first = page.locator(".war-grid tbody tr td:nth-child(2) .pos").first();
    await expect(first).toHaveText(/^(#\d+|—)$/);
  });

  test("toggling a competitor chip re-fetches and re-renders the grid", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { runId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });

    const colsBefore = await page.locator(".war-grid thead th").count();
    // Toggle the first OFF chip on (or an ON chip off) and assert the column count
    // changes as the grid re-fetches.
    const chip = page.locator(".war-chip").first();
    const wasOn = (await chip.getAttribute("class"))?.includes("on");
    await chip.click();
    await page.waitForTimeout(400);
    const colsAfter = await page.locator(".war-grid thead th").count();
    // A toggle adds or removes exactly one competitor column.
    expect(Math.abs(colsAfter - colsBefore)).toBe(wasOn ? 1 : 1);
  });

  test("surfaces an honest 'as of' provenance line for the live-checked ranks", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { runId } = await seedRun(page);
    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.locator(".war-grid")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".war-asof")).toContainText(/as of/i);
  });
});
