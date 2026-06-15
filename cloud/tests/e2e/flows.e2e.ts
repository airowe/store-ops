import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun } from "./helpers.js";

/**
 * Additional dashboard flows: the disconnect two-click confirm, the reject path
 * on the approval gate, the empty-dashboard state, multi-app rendering, and the
 * try-before-signup preview (which uses a raw fetch to /preview, so it's driven
 * with a route stub rather than the mock backend).
 */

test.describe("disconnect (two-click confirm)", () => {
  test("first click arms, second click deletes and returns to an empty dashboard", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    const btn = page.getByRole("button", { name: /disconnect app/i });
    await expect(btn).toBeVisible();

    // First click ARMS — it must not delete yet; the label changes to a confirm.
    await btn.click();
    await expect(page.getByRole("button", { name: /click again to confirm/i })).toBeVisible();

    // The app still exists at this point (arming is not a delete).
    const stillThere = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const r = await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev");
      return r.status;
    }, id);
    expect(stillThere).toBe(200);

    // Second click CONFIRMS — deletes and routes home.
    await page.getByRole("button", { name: /click again to confirm/i }).click();
    await expect(page.getByRole("heading", { name: /connect an app/i })).toBeVisible({
      timeout: 10_000,
    });

    // The app is gone from the backend.
    const afterStatus = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const r = await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev");
      return r.status;
    }, id);
    expect(afterStatus).toBe(404);
  });
});

test.describe("approval gate — reject path", () => {
  test("rejecting a run shows the rejected state and never reveals push commands", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();
    await page.getByRole("button", { name: /reject/i }).click();

    // Rejected state shown; the "approved" hand-off copy must NOT appear.
    await expect(page.getByText(/you rejected this proposal/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Hand the metadata to your build pipeline/i)).toHaveCount(0);
  });
});

test.describe("dashboard states", () => {
  test("empty dashboard shows the connect form when no apps exist", async ({ page }) => {
    await gotoMockDashboard(page);
    // Fresh mock partition → no apps. The connect form is the primary CTA.
    await expect(page.getByRole("heading", { name: /connect an app/i })).toBeVisible();
    await expect(page.locator(".appcard")).toHaveCount(0);
  });

  test("multiple connected apps each render a card with a rank summary", async ({ page }) => {
    await gotoMockDashboard(page);
    await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    await seedAppWithRun(page, { name: "Headspace", bundleId: "com.getsomeheadspace.headspace" });

    // Re-render the dashboard in-place via the SPA router (a full page.goto reload
    // would re-render before loadSession() settles — a boot race, not a real bug).
    await page.evaluate(() => { location.hash = "#/_"; location.hash = "#/"; });
    await expect(page.locator(".appcard")).toHaveCount(2);
    await expect(page.locator(".appcard", { hasText: "Calm" })).toBeVisible();
    await expect(page.locator(".appcard", { hasText: "Headspace" })).toBeVisible();
  });
});

test.describe("try-before-signup preview (logged-out, raw /preview fetch)", () => {
  test("a logged-out visitor sees a real audit + rank preview without signing up", async ({
    page,
  }) => {
    // The preview view triggers only when API_BASE is set AND the session is
    // logged-out, and it calls fetch(API_BASE + "/preview") directly. Drive it by
    // pointing API_BASE at the test origin, stubbing /auth/me (logged-out) and
    // /preview (a canned teaser), and intercepting the POST.
    await page.route("**/config.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: 'window.STORE_OPS = { API_BASE: location.origin };',
      }),
    );
    await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
    await page.route("https://fonts.gstatic.com/**", (r) => r.abort());

    // logged-out session so route() picks the preview view
    await page.route("**/auth/me", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authed: false }) }),
    );
    // the preview teaser the page renders
    await page.route("**/preview", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          preview: {
            appName: "Calm",
            auditGrade: "B",
            leadKeyword: "meditation",
            leadRank: 12,
            keywordsChecked: 6,
            inTop10: 2,
            sample: [
              { keyword: "meditation", rank: 12 },
              { keyword: "sleep sounds", rank: 24 },
            ],
          },
          bundleId: "com.calm.calmapp",
        }),
      }),
    );

    await page.goto("/index.html#/");
    await page.waitForFunction(() => !!(window as any).STORE_OPS_MOCK);

    // The try-before-signup hero is shown (logged-out preview view).
    await expect(page.getByRole("heading", { name: /where your app really ranks/i })).toBeVisible();

    // Run a preview — the canned teaser renders the app name + a rank.
    await page.getByPlaceholder(/app name, app store .* link, or bundle id/i).fill("Calm");
    await page.getByRole("button", { name: /^preview$/i }).click();

    await expect(page.getByText(/Calm/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/#12/).first()).toBeVisible();
  });
});
