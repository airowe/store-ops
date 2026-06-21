import { test, expect } from "@playwright/test";
import { gotoMockDashboard } from "./helpers.js";

/**
 * #51 — the dashboard agent banner reflects REAL pause state and can toggle it.
 *
 * The bug this fixes: the banner used to hard-code "active" with no control. So
 * two load-bearing assertions:
 *   1. fresh state → banner says "active" with a Pause control.
 *   2. clicking Pause → banner flips to "paused" (and the honest copy: no new
 *      checks / manual runs still work), button becomes Resume, WITHOUT a reload.
 *      Clicking Resume flips it back.
 *
 * Honesty pin: a paused banner must NEVER claim "active" (a future refactor can't
 * silently re-hardcode it).
 */
test.describe("agent pause/resume banner (#51)", () => {
  test("banner reads active, toggles to paused and back, no reload", async ({ page }) => {
    await gotoMockDashboard(page);

    const banner = page.locator(".agentline").first();
    await expect(banner).toBeVisible();
    // Fresh partition → autonomy is ON.
    await expect(banner).toContainText("active");
    await expect(banner).not.toContainText("paused");

    const toggle = banner.locator("button");
    await expect(toggle).toHaveText(/pause agent/i);

    // Pause → banner becomes paused, button becomes Resume (no full reload).
    await toggle.click();
    await expect(banner).toContainText("paused");
    // Honesty: a paused banner never claims "active".
    await expect(banner.locator("b", { hasText: "active" })).toHaveCount(0);
    // The paused copy is honest about what stopped.
    await expect(banner).toContainText(/no new/i);
    await expect(banner).toContainText(/manual runs still work/i);
    await expect(banner.locator("button")).toHaveText(/resume agent/i);

    // Resume → back to active.
    await banner.locator("button").click();
    await expect(banner).toContainText("active");
    await expect(banner.locator("button")).toHaveText(/pause agent/i);
  });
});
