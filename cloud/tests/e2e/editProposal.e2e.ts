import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Editable proposals on the run page (#39 Part 1). The "Proposed" side of the
 * diff is editable; an over-limit / rule-breaking edit blocks Approve (the server
 * is authoritative, but the client mirror stops a doomed click); a valid edit is
 * what SHIPS (handoff renders the edited value, not the agent's original); and a
 * per-field "Reset to agent's proposal" restores it. A no-op edit (back to the
 * live value) keeps the honest "nothing to push" path.
 *
 * Runs against the deterministic mock backend (mock.js), which mirrors the
 * Worker's merge + re-validate + reflect-back flow.
 */

async function runIdFor(page: import("@playwright/test").Page, appId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const M = (window as any).STORE_OPS_MOCK;
    const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
    return detail.runs[0].id as string;
  }, appId);
}

test.describe("editable proposals (#39 Part 1)", () => {
  test("an over-limit subtitle blocks Approve; fixing it re-enables and ships the edited value", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // asc:true → a keyed run, so subtitle/keywords are PROPOSED (and thus editable).
    const appId = await seedAppWithRun(page, { asc: true });
    const runId = await runIdFor(page, appId);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();

    const subtitle = page.locator('.diff-edit[data-field="subtitle"]');
    await expect(subtitle).toBeVisible();
    const approve = page.getByRole("button", { name: /approve & reveal commands/i });
    await expect(approve).toBeEnabled();

    // Edit the subtitle to 31 chars (over the 30 limit) → Approve disabled + msg.
    await subtitle.fill("x".repeat(31));
    await expect(approve).toBeDisabled();
    await expect(page.locator(".diff-invalid-msg")).toContainText(/subtitle/i);
    // the input flags invalid + the char bar warns
    await expect(subtitle).toHaveClass(/invalid/);

    // Fix to a valid, distinctive value → Approve re-enabled.
    const edited = "Sleep better every night";
    await subtitle.fill(edited);
    await expect(approve).toBeEnabled();
    await expect(subtitle).not.toHaveClass(/invalid/);

    // Approve → the handoff renders the EDITED subtitle, not the agent's original.
    await approve.click();
    await expect(page.getByText(/Hand the metadata to your build pipeline/i)).toBeVisible({
      timeout: 10_000,
    });
    // the raw asc command (revealed post-approval) carries the edited subtitle.
    await page.getByText(/Or run the commands manually/i).click();
    await expect(page.locator(".rawcmds pre").first()).toContainText(edited);
  });

  test("Reset to agent's proposal restores the field and re-enables Approve", async ({ page }) => {
    await gotoMockDashboard(page);
    const appId = await seedAppWithRun(page, { asc: true });
    const runId = await runIdFor(page, appId);
    await page.goto(`/index.html#/runs/${runId}`);

    const subtitle = page.locator('.diff-edit[data-field="subtitle"]');
    await expect(subtitle).toBeVisible();
    const original = await subtitle.inputValue();
    const approve = page.getByRole("button", { name: /approve & reveal commands/i });

    // break it → reset button appears in the subtitle row → click → restored.
    await subtitle.fill("y".repeat(40));
    await expect(approve).toBeDisabled();
    const subtitleRow = page.locator('.diffrow:has(.diff-edit[data-field="subtitle"])');
    await subtitleRow.getByRole("button", { name: /reset/i }).click();

    await expect(subtitle).toHaveValue(original);
    await expect(approve).toBeEnabled();
  });

  test("editing a field back to the live value is an honest no-op (nothing to push)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // emptyLive keeps the live subtitle/keywords blank but READ — so editing the
    // proposed subtitle/keywords back to "" is a clean, valid no-op vs the live
    // listing (no title/subtitle keyword-dup foot-gun from canned sample copy).
    const appId = await seedAppWithRun(page, { asc: true, emptyLive: true });
    const runId = await runIdFor(page, appId);

    // read the run's current (live) copy so we can edit every proposed field to it.
    const current = await page.evaluate(async (id) => {
      const M = (window as any).STORE_OPS_MOCK;
      const run = await (await M.handle("GET", `/runs/${id}`, null, "demo@store-ops.dev")).json();
      return run.result.currentCopy as Record<string, string>;
    }, runId);

    await page.goto(`/index.html#/runs/${runId}`);
    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();

    // set every editable field to its live value (empty where the live listing is
    // blank) → the proposal is now a no-op vs the current copy.
    for (const field of ["name", "subtitle", "keywords", "promo"]) {
      const input = page.locator(`.diff-edit[data-field="${field}"]`);
      if (await input.count()) {
        await input.fill(current[field] == null ? "" : current[field]);
      }
    }

    // approve → the gate honestly reports "nothing worth pushing" rather than a
    // fabricated change handoff.
    await page.getByRole("button", { name: /approve & reveal commands/i }).click();
    await expect(page.getByText(/already well-optimized|no changes worth pushing/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
