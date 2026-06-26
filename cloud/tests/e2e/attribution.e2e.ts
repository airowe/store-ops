import { test, expect } from "@playwright/test";
import { gotoMockDashboard } from "./helpers.js";

/**
 * PRD 02 — rank-attribution E2E. Drives the REAL app.js against the mock backend
 * through the proof flow:
 *   connect → run (ASC, proposes keywords) → APPROVE → re-check ranks →
 *   the rank-movement card shows "↳ after you added 'x' (date)" linked to the run.
 *
 * The honesty assertion is load-bearing: the attribution line must read
 * correlationally ("after you added") and never contain causal language.
 */

const EM = "demo@store-ops.dev";

/**
 * Seed a scale-tier app, run an ASC (Mode-A) pass so the proposal fills the
 * keyword field, APPROVE it (records the push), and return the app id + the
 * approved run id + the deltas payload (now carrying attribution).
 */
async function seedApprovedPush(page: import("@playwright/test").Page) {
  return await page.evaluate(async (em) => {
    const M = (window as any).STORE_OPS_MOCK;
    await M.handle("POST", "/_tier", { tier: "scale" }, em);
    const keywords = [
      "stoic", "meditation", "sleep sounds", "breathing exercises",
      "anxiety relief", "focus music",
    ];
    const conn = await M.handle(
      "POST",
      "/apps",
      { bundle_id: "app.airowe.clarity", name: "Heathen", keywords },
      em,
    );
    const id = (await conn.json()).id as string;

    const ran = await M.handle(`POST`, `/apps/${id}/run-asc`, {
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      p8: "-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----",
    }, em);
    const runId = (await ran.json()).id as string;

    await M.handle("POST", `/runs/${runId}/approve`, { decision: "approve" }, em);

    const deltas = await (await M.handle("GET", `/apps/${id}/deltas`, null, em)).json();
    return { id, runId, deltas };
  }, EM);
}

test.describe("rank attribution (mock backend)", () => {
  test("an approved push produces a linked, correlational attribution on a moved keyword", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { deltas, runId } = await seedApprovedPush(page);

    // At least one entry is now attributed + linked.
    const linked = (deltas.entries as Array<any>).filter(
      (e) => e.attributedChange && e.confidence === "linked",
    );
    expect(linked.length).toBeGreaterThan(0);

    const note = linked[0].attributedChange.note as string;
    // Correlational framing — and NEVER causal.
    expect(note.toLowerCase()).toContain("after you added");
    for (const causal of ["caused", "because", "due to", "thanks to", "drove", "led to"]) {
      expect(note.toLowerCase()).not.toContain(causal);
    }
    // The link points back at the approved run.
    expect(linked[0].attributedChange.runId).toBe(runId);
  });

  test("the rank-movement card renders the attribution line, clickable through to the run", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const { id, runId } = await seedApprovedPush(page);

    await page.goto(`/index.html#/apps/${id}`);
    await expect(
      page.getByRole("heading", { name: /rank movement this week/i }),
    ).toBeVisible();

    // The attribution line renders, reads correlationally, and links to the run.
    const attr = page.locator(".dattr.linked").first();
    await expect(attr).toBeVisible({ timeout: 10_000 });
    await expect(attr).toContainText(/after you added/i);
    await expect(attr).toHaveAttribute("href", `#/runs/${runId}`);

    // Clicking it navigates to the run page (the full push context).
    await attr.click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  });

  test("with no approved push, no attribution line is shown (honest degrade)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await page.evaluate(async (em) => {
      const M = (window as any).STORE_OPS_MOCK;
      await M.handle("POST", "/_tier", { tier: "scale" }, em);
      const conn = await M.handle(
        "POST",
        "/apps",
        { bundle_id: "com.calm.calmapp", name: "Calm", keywords: ["meditation", "sleep"] },
        em,
      );
      const appId = (await conn.json()).id as string;
      await M.handle("POST", `/apps/${appId}/run`, {}, em); // run, but never approve
      return appId;
    }, EM);

    await page.goto(`/index.html#/apps/${id}`);
    await expect(
      page.getByRole("heading", { name: /rank movement this week/i }),
    ).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator(".dattr")).toHaveCount(0);
  });
});
