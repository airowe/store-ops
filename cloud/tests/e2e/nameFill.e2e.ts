import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Name-fill suggestion (#59) — the diff card surfaces the engine's
 * `optimization.nameFill` note when the proposed name leaves spare characters
 * and a scored target genuinely fits.
 *
 * Pins:
 *   • the hint renders with the spare-char count and the full filled name,
 *   • it is a SUGGESTION line only — the proposed name input is NOT rewritten,
 *   • when no candidate fits, no hint renders (honest silence).
 */

async function runIdFor(page: import("@playwright/test").Page, appId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
    return detail.runs[0].id as string;
  }, appId);
}

test.describe("name-fill suggestion (#59)", () => {
  test("renders the hint with spare count + filled name; name input untouched", async ({ page }) => {
    await gotoMockDashboard(page);
    // Short name + short terms → plenty of spare chars; the long-tail term fits.
    const appId = await seedAppWithRun(page, {
      asc: true,
      name: "Zen",
      bundleId: "com.zen.mind",
      keywords: ["meditation", "sleep", "focus"],
    });
    const runId = await runIdFor(page, appId);
    await page.goto(`/index.html#/runs/${runId}`);

    const hint = page.locator("#nameFillHint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/unused characters/);
    await expect(hint).toContainText(/A relevant target that fits/);

    // The suggestion NEVER rewrites the proposed name — the diff's name value
    // is the agent's proposal, not the filled variant.
    const filled = (await hint.textContent()) ?? "";
    const m = filled.match(/“([^”]+)”/);
    expect(m).not.toBeNull();
    const nameRow = page.locator('.diffrow:has(.fname:text("App name"))');
    await expect(nameRow).not.toContainText(m![1] as string);
  });

  test("no fitting candidate → no hint (honest silence)", async ({ page }) => {
    await gotoMockDashboard(page);
    // A name hugging the 30-char limit leaves no room for any candidate.
    const appId = await seedAppWithRun(page, {
      asc: true,
      name: "Superlative Recipe Machine XL",
      bundleId: "com.superlative.recipes",
    });
    const runId = await runIdFor(page, appId);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /proposed changes/i })).toBeVisible();
    await expect(page.locator("#nameFillHint")).toHaveCount(0);
  });
});
