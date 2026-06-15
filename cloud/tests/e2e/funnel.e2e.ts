import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun, readDeltaRows } from "./helpers.js";

/**
 * End-to-end of the dashboard funnel, driving the REAL app.js against the
 * deterministic mock backend (mock.js). Covers: connect-by-name → first run →
 * app detail with the animated rank-movement card → the share-a-win button →
 * the approval gate (commands hidden until approved → revealed) → and the
 * prefers-reduced-motion path. No live Worker, D1, or network is touched.
 */

test.describe("dashboard funnel (mock backend)", () => {
  test("connect-by-name resolves a catalog app, runs the first audit, lands on the dashboard", async ({
    page,
  }) => {
    await gotoMockDashboard(page);

    // The connect form: search a name that resolves to a single catalog app
    // ("Calm" is unique in the mock catalog), which auto-connects + runs. Target
    // the connect search box by its placeholder (NOT input.first(), which is the
    // header "act as…" email field).
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);
    await search.fill("Calm");
    await page.getByRole("button", { name: /^search$/i }).click();

    // After connect + auto-run, the dashboard shows the app card with its name.
    await expect(page.locator(".appcard", { hasText: "Calm" })).toBeVisible({ timeout: 10_000 });
  });

  test("app detail renders the animated rank-movement card with numbers matching the data", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // The movement card heading is present.
    await expect(page.getByRole("heading", { name: /rank movement this week/i })).toBeVisible();

    // Rows render; wait past the count-up settle window so numbers are final.
    const rows = page.locator(".deltarow");
    await expect(rows.first()).toBeVisible();
    await page.waitForTimeout(1500);

    // Every displayed current rank must equal the mock's data (the count-up
    // safety-net guarantees it lands exactly, even if rAF is throttled).
    const dom = await readDeltaRows(page);
    expect(dom.length).toBeGreaterThan(0);

    const data = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const d = await (await M.handle("GET", `/apps/${appId}/deltas`, null, "demo@store-ops.dev")).json();
      return d.entries as Array<{ keyword: string; current: number | null }>;
    }, id);
    const byKw = Object.fromEntries(data.map((e) => [e.keyword, e]));

    for (const row of dom) {
      const expected = byKw[row.keyword];
      expect(expected, `data for keyword "${row.keyword}"`).toBeTruthy();
      const expectedCur = expected.current === null ? "—" : `#${expected.current}`;
      expect(row.cur, `current rank for "${row.keyword}"`).toBe(expectedCur);
    }
  });

  test("a climbing keyword shows an up chip and its current rank in the signal-green class", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // Keywords whose hash yields a climb exist in the default seed; assert at least
    // one row is a real 'up' move (green chip + .good current).
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);
    await page.waitForTimeout(1500);

    const upChips = page.locator(".dchip.up");
    await expect(upChips.first()).toBeVisible();
    // the up chip's row has a green current rank
    const goodCur = page.locator(".deltarow", { has: page.locator(".dchip.up") }).locator(".dcur.good");
    await expect(goodCur.first()).toBeVisible();
  });

  test("the share-a-win button appears when there is a real win", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // hasShareWin gates the button on a climb/strong-new — the default seed has one.
    const hasWin = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const d = await (await M.handle("GET", `/apps/${appId}/deltas`, null, "demo@store-ops.dev")).json();
      return (d.entries as Array<{ direction: string; current: number | null }>).some(
        (e) => (e.direction === "up" && e.current != null) || (e.direction === "new" && e.current != null && e.current <= 50),
      );
    }, id);

    const shareBtn = page.getByRole("button", { name: /share this win/i });
    if (hasWin) {
      await expect(shareBtn).toBeVisible();
    } else {
      await expect(shareBtn).toHaveCount(0);
    }
  });

  test("approval gate hides push commands until approved, then reveals them", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);

    // Open the latest run for this app.
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();

    // Pre-approval: the locked placeholder is shown, no live push commands.
    await expect(page.locator(".locked")).toBeVisible();

    // Approve → commands revealed.
    await page.getByRole("button", { name: /approve & reveal commands/i }).click();
    // After the decision the gate re-renders into the approved state.
    await expect(page.getByText(/Hand the metadata to your build pipeline/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("prefers-reduced-motion: the movement card renders fully (no stuck/invisible elements)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // With motion reduced, chips must be opacity:1 (the media guard) and the
    // current numbers must already equal the data (countUpRank short-circuits).
    await expect(page.locator(".deltarow").first()).toBeVisible();
    const chipOpacity = await page.locator(".dchip").first().evaluate((el) => getComputedStyle(el).opacity);
    expect(chipOpacity).toBe("1");

    const dom = await readDeltaRows(page);
    const data = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const d = await (await M.handle("GET", `/apps/${appId}/deltas`, null, "demo@store-ops.dev")).json();
      return d.entries as Array<{ keyword: string; current: number | null }>;
    }, id);
    const byKw = Object.fromEntries(data.map((e) => [e.keyword, e]));
    for (const row of dom) {
      const expectedCur = byKw[row.keyword].current === null ? "—" : `#${byKw[row.keyword].current}`;
      expect(row.cur).toBe(expectedCur);
    }
    await context.close();
  });
});
