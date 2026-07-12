import { test, expect } from "@playwright/test";
import { installMocks } from "./mocks.js";

/**
 * The redesign's happy path, driven against the built app with a deterministic
 * mock backend (mocks.ts). This is the first full-app E2E for the TanStack
 * redesign that was cut over to prod — component tests cover the cards in
 * isolation; this proves the real router + shell + data-fetching render the
 * money screens end to end.
 */
test.beforeEach(async ({ page }) => {
  await installMocks(page);
});

test("dashboard lists connected apps", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your apps" })).toBeVisible();
  await expect(page.getByTestId("app-card-app1")).toContainText("Weatherly");
  await expect(page.getByTestId("app-card-app1").getByTestId("rank")).toContainText("12");
});

test("app detail renders the rank trend + tool cards + run history", async ({ page }) => {
  await page.goto("/apps/app1");
  await expect(page.getByRole("heading", { name: "Weatherly" })).toBeVisible();
  await expect(page.getByTestId("rank-trend")).toBeVisible();
  await expect(page.getByTestId("competitors-card")).toBeVisible();
  await expect(page.getByTestId("locale-keywords-card")).toBeVisible();
  await expect(page.getByTestId("rejection-assistant-card")).toBeVisible();
  await expect(page.getByTestId("run-run1")).toBeVisible();
});

test("run detail renders the proposal diff, findings, and measured cards", async ({ page }) => {
  await page.goto("/runs/run1");
  await expect(page.getByRole("heading", { name: "Proposed changes" })).toBeVisible();
  await expect(page.getByTestId("findings-card")).toContainText("Subtitle underuses");
  await expect(page.getByTestId("opportunities-card")).toContainText("hourly forecast");
  await expect(page.getByTestId("coverage-card")).toContainText("72");
  await expect(page.getByTestId("localization-expansion-card")).toContainText("es-MX");
  await expect(page.getByTestId("ppo-treatment-card")).toContainText("free A/B test");
  await expect(page.getByTestId("approve")).toBeVisible();
});

test("approving a run reveals the handoff without shipping", async ({ page }) => {
  // approve returns the slim decision; the app merges it and shows 'ready to push'
  await page.route("https://api.shipaso.com/runs/run1/approve", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "run1", status: "approved", pushCommands: [] }),
    }),
  );
  await page.goto("/runs/run1");
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("run-status")).toContainText("Approved");
  await expect(page.getByTestId("run-status")).not.toContainText("Shipped");
});

test("clicking an app is CLIENT-SIDE navigation (no full page reload)", async ({ page }) => {
  await page.goto("/");
  // stamp the live document; a full reload clears this, client-side nav preserves it
  await page.evaluate(() => ((window as unknown as { __spa?: boolean }).__spa = true));
  await page.getByTestId("app-card-app1").click();
  await expect(page.getByRole("heading", { name: "Weatherly" })).toBeVisible();
  const survived = await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa === true);
  expect(survived, "navigating to the app detail should be an in-SPA route change, not a full reload").toBe(true);
});
