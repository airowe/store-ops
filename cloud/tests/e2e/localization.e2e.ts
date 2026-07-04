import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Localization review lane (#78 Phase 4) — the expansion card's generate →
 * edit → approve flow against the mock backend (deterministic
 * pseudo-translation mirroring the Worker's guardrails).
 *
 * Pins:
 *   • before run approval: NO generate button — the honest "approve the run
 *     first" note (drafts translate the copy you approved),
 *   • generate renders the editor with the verbatim machine-translated label
 *     and the brand token intact,
 *   • approve → "in handoff" chip; the run detail round-trips it; remove
 *     drops it (unapproved locales never claim handoff membership).
 */

const EM = "demo@store-ops.dev";

async function seedRun(page: import("@playwright/test").Page, opts: { approve: boolean }): Promise<string> {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, { asc: true });
  return await page.evaluate(
    async ({ id, approve, email }) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${id}`, null, email)).json();
      const runId = detail.runs[0].id as string;
      if (approve) await M.handle("POST", `/runs/${runId}/approve`, {}, email);
      return runId;
    },
    { id: appId, approve: opts.approve, email: EM },
  );
}

test.describe("localization review lane (#78)", () => {
  test("unapproved run → honest note, no generation", async ({ page }) => {
    const runId = await seedRun(page, { approve: false });
    await page.goto(`/index.html#/runs/${runId}`);
    const card = page.locator(".loc-card");
    await expect(card).toBeVisible();
    await expect(card.getByText(/Approve the run first/).first()).toBeVisible();
    await expect(card.locator(".loc-generate")).toHaveCount(0);
  });

  test("generate → MT label + brand survives → approve → in handoff → remove", async ({ page }) => {
    const runId = await seedRun(page, { approve: true });
    await page.goto(`/index.html#/runs/${runId}`);
    const card = page.locator(".loc-card");
    await expect(card).toBeVisible();
    // honest framing on the card itself
    await expect(card.getByText(/only locales you approve join the handoff/)).toBeVisible();

    const firstLane = card.locator(".loc-lane").first();
    await firstLane.locator(".loc-generate").click();

    // the editor renders the draft with the verbatim MT label
    const editor = firstLane.locator(".loc-editor");
    await expect(editor.getByText("draft — machine-translated, review before shipping")).toBeVisible();
    // brand token survived (mock app name "Calm" → brand "Calm")
    await expect(editor.locator('.loc-field[data-field="name"]')).toHaveValue(/Calm/);

    await editor.locator(".loc-approve").click();
    await expect(firstLane.locator(".loc-inhandoff")).toBeVisible();

    // round-trips: reload the run page — the chip re-renders from the stored map
    await page.goto(`/index.html#/`);
    await page.goto(`/index.html#/runs/${runId}`);
    const laneAfter = page.locator(".loc-card .loc-lane").first();
    await expect(laneAfter.locator(".loc-inhandoff")).toBeVisible();

    // remove → chip gone, generate available again
    await laneAfter.getByRole("button", { name: "Remove" }).click();
    await expect(laneAfter.locator(".loc-inhandoff")).toHaveCount(0);
    await expect(laneAfter.locator(".loc-generate")).toBeVisible();
  });

  test("free-pick locale generates a lane beyond the recommendations", async ({ page }) => {
    const runId = await seedRun(page, { approve: true });
    await page.goto(`/index.html#/runs/${runId}`);
    const card = page.locator(".loc-card");
    await card.locator("#locFreePick").fill("nl-NL");
    await card.locator("#locFreeGo").click();
    const lane = card.locator('.loc-lane[data-locale="nl-NL"]');
    await expect(lane.locator(".loc-editor")).toBeVisible();
    await expect(lane.getByText(/machine-translated/)).toBeVisible();
  });
});
