import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * E2E for the "Expand to more markets" card (PRD 04 localization expansion),
 * driving the REAL app.js against the deterministic mock backend. A Mode-A (ASC)
 * run emits `localizationExpansion`; the run page renders the card below the
 * findings card with ROI-sorted locale rows, honest rationale (no install
 * numbers), an effort badge, and the "Draft this locale's metadata" affordance.
 */

async function latestRunId(
  page: import("@playwright/test").Page,
  appId: string,
): Promise<string> {
  return await page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
    return detail.runs[0].id as string;
  }, appId);
}

test.describe("run page — Expand to more markets card (PRD 04)", () => {
  test("an ASC run renders the card with locale rows, rationale, and effort badges", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, {
      asc: true,
      name: "LocCardA",
      bundleId: "com.test.loccarda",
    });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".loc-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: /expand to more markets/i })).toBeVisible();

    // At least 3 locale recommendations render (UI shows top 3–5).
    const rows = card.locator(".loc-rec");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);

    // The first row carries a locale code + an honest, number-free rationale.
    const first = rows.first();
    await expect(first.locator(".loc-rec-code")).toContainText(/[a-z]{2}-[A-Z]/);
    const rationale = (await first.locator(".loc-rec-rationale").textContent()) ?? "";
    expect(rationale).toMatch(/market|storefront|audience|language/i);
    expect(rationale).not.toMatch(/\d/); // no fabricated install/revenue numbers

    // Each row has an effort badge (Translate for a single-locale app).
    await expect(first.locator(".loc-effort-badge")).toBeVisible();
    await expect(first.locator(".loc-effort-badge")).toHaveText(/translate/i);

    // The honesty disclaimer (static heuristic, not live install data) is present.
    await expect(card.locator(".loc-rec-note")).toContainText(/heuristic|not live install data/i);
  });

  test('the "Draft this locale\'s metadata" button routes to the ASC run panel', async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, {
      asc: true,
      name: "LocCardB",
      bundleId: "com.test.loccardb",
    });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".loc-card");
    await expect(card).toBeVisible();
    const draftBtn = card.getByRole("button", { name: /draft .* metadata/i }).first();
    await expect(draftBtn).toBeVisible();
    await draftBtn.click();

    // Routes to the app page with the ?asc flag (reuses the existing ASC panel).
    await expect(page).toHaveURL(new RegExp(`#/apps/${id}\\?asc=1`));
  });

  test("a no-key run does NOT render the card (no fabricated recommendations)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, {
      asc: false,
      name: "LocCardC",
      bundleId: "com.test.loccardc",
    });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The findings card still renders, but the localization card must be absent —
    // without an ASC read we never saw the locale set, so we make no claim.
    await expect(page.locator(".audit-card").first()).toBeVisible();
    await expect(page.locator(".loc-card")).toHaveCount(0);
  });
});
