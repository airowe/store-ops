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
  await page.goto("/dashboard");
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

test("run detail: the master-detail shell reaches the diff + every measured card", async ({ page }) => {
  await page.goto("/runs/run1");
  // The pending shell: heading + status bar + the sticky decision, always present.
  await expect(page.getByRole("heading", { name: "Proposed changes" })).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("Weatherly");
  await expect(page.getByTestId("approve")).toBeVisible();

  // Master-detail: exactly one section shows at a time. The default is the diff;
  // each measured card is reachable by selecting its rail item. Assert one-at-a-
  // time by checking the prior card is gone after each switch.
  await expect(page.getByTestId("diff-name")).toBeVisible();

  await page.getByRole("button", { name: "Audit" }).click();
  await expect(page.getByTestId("findings-card")).toContainText("Subtitle underuses");
  await expect(page.getByTestId("diff-name")).toHaveCount(0);

  await page.getByRole("button", { name: "Keywords" }).click();
  await expect(page.getByTestId("opportunities-card")).toContainText("hourly forecast");

  await page.getByRole("button", { name: "Metadata" }).click();
  await expect(page.getByTestId("coverage-card")).toContainText("72");

  await page.getByRole("button", { name: "Markets" }).click();
  await expect(page.getByTestId("localization-expansion-card")).toContainText("es-MX");

  await page.getByRole("button", { name: "PPO test" }).click();
  await expect(page.getByTestId("ppo-treatment-card")).toContainText("free A/B test");
});

test("approving a run reveals the handoff without shipping", async ({ page }) => {
  // approve returns the slim decision; the app merges it and shows 'ready to push'.
  // Path-matched (host-agnostic) + registered after the general mock so it wins.
  await page.route(
    (url) => url.pathname === "/runs/run1/approve",
    (route) =>
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
  await page.goto("/dashboard");
  // stamp the live document; a full reload clears this, client-side nav preserves it
  await page.evaluate(() => ((window as unknown as { __spa?: boolean }).__spa = true));
  await page.getByTestId("app-card-app1").click();
  await expect(page.getByRole("heading", { name: "Weatherly" })).toBeVisible();
  const survived = await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa === true);
  expect(survived, "navigating to the app detail should be an in-SPA route change, not a full reload").toBe(true);
});

test("the landing page at / renders the hero and audits inline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-hero")).toBeVisible();
  // the acquisition front door must not title its tab "dashboard"
  await expect(page).toHaveTitle("ShipASO");
  await expect(page.getByTestId("how-it-works")).toContainText("Approve");
  // real measured proof from the mock aggregate
  await expect(page.getByTestId("stat-total wins")).toContainText("9");
  // inline audit returns a real grade without leaving the page
  await page.getByTestId("preview-query").fill("weatherly");
  await page.getByTestId("preview-search").click();
  await expect(page.getByTestId("preview-grade")).toContainText("B");
  await expect(page.getByTestId("preview-summary")).toContainText("#12");
});

test("the dashboard is reachable at /dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your apps" })).toBeVisible();
  await expect(page).toHaveTitle("ShipASO · dashboard");
});
