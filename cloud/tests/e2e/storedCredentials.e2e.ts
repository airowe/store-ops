import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Stored credentials (#67 post-launch half) — the opt-in save flow and the
 * write-only management panel, against the mock backend (which enables storage
 * and mirrors the Worker's metadata-only responses).
 *
 * Pins:
 *   • the "Save this key" opt-in renders (storage enabled) and is OFF by default,
 *   • saving a key surfaces "Run with saved key" + a Settings entry,
 *   • the saved-key run needs no re-typed credential,
 *   • the management panel shows metadata only and delete is honest
 *     (never claims to revoke at Apple).
 */

const ASC = {
  issuer: "57246542-96fe-1a63-e053-0824d011072a",
  keyId: "ABC123DEFG",
  p8: "-----BEGIN PRIVATE KEY-----\nMOCKKEYBYTES\n-----END PRIVATE KEY-----",
};

async function openAppPanel(page: import("@playwright/test").Page): Promise<string> {
  await gotoMockDashboard(page);
  const appId = await seedAppWithRun(page, {});
  await page.goto(`/index.html#/apps/${appId}`);
  await expect(page.locator(".asc-run-panel")).toBeVisible();
  return appId;
}

async function fillAsc(panel: import("@playwright/test").Locator) {
  await panel.locator('input[placeholder*="Issuer ID"]').fill(ASC.issuer);
  await panel.locator('input[placeholder*="Key ID"]').fill(ASC.keyId);
  await panel.locator("textarea").fill(ASC.p8);
}

test.describe("stored credentials (#67)", () => {
  test("opt-in renders (off by default); saving surfaces the saved-key run", async ({ page }) => {
    await openAppPanel(page);
    const panel = page.locator(".asc-run-panel");

    const optIn = page.locator("#storeAscRow");
    await expect(optIn).toBeVisible(); // storage enabled in the mock
    await expect(optIn.locator('input[type="checkbox"]')).not.toBeChecked(); // off = today's behavior
    await expect(page.locator("#savedKeyRow")).toBeHidden(); // nothing saved yet

    await fillAsc(panel);
    await optIn.locator('input[type="checkbox"]').check();
    await panel.getByRole("button", { name: /Run with ASC read/ }).click();

    // the run navigates to the run page; go back to the app and the saved-key
    // button now appears (the credential was stored)
    await expect(page).toHaveURL(/#\/runs\//, { timeout: 10_000 });
    await page.goBack();
    await expect(page.locator("#runSavedKey")).toBeVisible();
    await expect(page.getByText(/Using your saved key/)).toContainText(ASC.keyId);
  });

  test("run with saved key needs no re-typed credential", async ({ page }) => {
    const appId = await openAppPanel(page);
    // seed a stored key + re-render the panel WITHOUT a full navigation (a
    // page.goto would trip the harness's hermetic mock-DB wipe). Hash routing
    // re-renders viewApp in the SPA, which re-fetches /account/credentials.
    await page.evaluate(
      async ({ id, keyId }) => {
        const M = (window as any).STORE_OPS_MOCK;
        await M.handle("POST", `/apps/${id}/run-asc`, { p8: "x", keyId, issuerId: "iss", store: true }, "demo@store-ops.dev");
        location.hash = "#/";
        location.hash = `#/apps/${id}`;
      },
      { id: appId, keyId: ASC.keyId },
    );
    const savedBtn = page.locator("#runSavedKey");
    await expect(savedBtn).toBeVisible();
    await savedBtn.click();
    // it runs straight to a run page — no credential form was filled
    await expect(page).toHaveURL(/#\/runs\//, { timeout: 10_000 });
  });

  test("Settings lists saved keys (metadata only) and deletes honestly", async ({ page }) => {
    const appId = await openAppPanel(page);
    await page.evaluate(
      async ({ id, keyId }) => {
        const M = (window as any).STORE_OPS_MOCK;
        await M.handle("POST", `/apps/${id}/run-asc`, { p8: "x", keyId, issuerId: "iss", store: true }, "demo@store-ops.dev");
        location.hash = "#/settings";
      },
      { id: appId, keyId: ASC.keyId },
    );
    const card = page.locator("#storedKeysCard");
    await expect(card).toBeVisible();
    await expect(card.getByText(/does not revoke the key at Apple/)).toBeVisible();
    const row = card.locator(".comp");
    await expect(row).toContainText(ASC.keyId);
    // metadata only — the panel never shows key material
    await expect(card).not.toContainText("PRIVATE KEY");
    await expect(card).not.toContainText("MOCKKEYBYTES");

    await row.getByRole("button", { name: "Delete" }).click();
    await expect(card.locator("#noSavedKeys")).toBeVisible();
  });
});
