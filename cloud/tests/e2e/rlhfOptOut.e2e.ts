import { test, expect } from "@playwright/test";
import { gotoMockDashboard } from "./helpers.js";

/**
 * RLHF capture opt-out toggle (#39 Part 2). Capture is ON by default; a signed-in
 * user can opt OUT from the header. This pins that the toggle:
 *   • renders ON by default,
 *   • flips to OFF on click (and back),
 *   • PERSISTS — the new state survives a reload (the backend recorded it, and the
 *     toggle re-reads it from /auth/me on boot).
 *
 * Drives the deterministic mock backend (mock.js), which mirrors the Worker's
 * users.rlhf_opt_out write + /auth/me reflect-back.
 */

test.describe("RLHF opt-out toggle (#39 Part 2)", () => {
  test("defaults ON; flipping persists to the backend", async ({ page }) => {
    await gotoMockDashboard(page);

    const toggle = page.locator("#rlhfToggleLink");
    await expect(toggle).toBeVisible();
    // Capture is ON by default (opt-out OFF).
    await expect(toggle).toHaveText(/Improve ShipASO: on/i);

    // Opt OUT.
    await toggle.click();
    await expect(toggle).toHaveText(/Improve ShipASO: off/i);

    // The backend recorded the opt-out (the Worker writes users.rlhf_opt_out;
    // the mock mirrors it) — verified through /auth/me.
    const persisted = await page.evaluate(async () => {
      const M = (window as any).STORE_OPS_MOCK;
      const me = await (await M.handle("GET", "/auth/me", null, "demo@store-ops.dev")).json();
      return me.rlhf_opt_out as boolean;
    });
    expect(persisted).toBe(true);

    // Opt back IN — flips the label and the persisted state.
    await toggle.click();
    await expect(toggle).toHaveText(/Improve ShipASO: on/i);
    const optedBackIn = await page.evaluate(async () => {
      const M = (window as any).STORE_OPS_MOCK;
      const me = await (await M.handle("GET", "/auth/me", null, "demo@store-ops.dev")).json();
      return me.rlhf_opt_out as boolean;
    });
    expect(optedBackIn).toBe(false);
  });

  test("the disclosure copy is honest about the anonymized + encrypted design", async ({ page }) => {
    await gotoMockDashboard(page);
    const toggle = page.locator("#rlhfToggleLink");
    await expect(toggle).toBeVisible();
    // The title attribute carries the honest disclosure (no account/app identifiers).
    await expect(toggle).toHaveAttribute(
      "title",
      /anonymized, encrypted edits.*No account or app identifiers are stored.*opt out/i,
    );
  });
});
