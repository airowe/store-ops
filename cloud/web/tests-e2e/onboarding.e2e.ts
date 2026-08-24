import { test, expect } from "@playwright/test";
import { installMocks } from "./mocks.js";
import type { Page } from "@playwright/test";

/**
 * A signed-in user with nothing connected. installMocks has no "/apps" override
 * key, so the empty list is registered as its own route first — page.route is
 * last-registered-wins, and installMocks' catch-all would otherwise answer with
 * the default one-app fixture.
 */
async function noApps(page: Page): Promise<void> {
  await installMocks(page);
  await page.route(/\/apps$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { apps: [] } });
  });
}

/**
 * The first-run flow, end to end (#329 cutover). Onboarding was built in the
 * 2026-07-24 redesign wave and never switched over: nothing routed to it,
 * nothing it collected was persisted, and it rendered a fabricated app and
 * grade. This proves the finished flow — a user with no apps is guided from
 * store choice through connect to a confirmed rival that actually persists.
 */

test("a user with no apps is sent to the guided setup", async ({ page }) => {
  await noApps(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByTestId("onboarding")).toBeVisible();
});

test("the guided setup never shows an app or grade it has not measured", async ({ page }) => {
  await noApps(page);
  await page.goto("/onboarding");
  // sampleState() used to seed these into a real user's screen.
  await expect(page.getByText("Cal AI")).toHaveCount(0);
  await expect(page.getByText(/Audited:/)).toHaveCount(0);
  await expect(page.getByTestId("onb-answer-app")).toHaveCount(0);
});

test("Google Play is shown as unavailable, not offered as a choice", async ({ page }) => {
  await noApps(page);
  await page.goto("/onboarding");
  await expect(page.getByTestId("onb-store-app-store")).toBeEnabled();
  await expect(page.getByTestId("onb-store-google-play")).toBeDisabled();
});

test("first run: store → connect → confirm a rival, each over the API", async ({ page }) => {
  await noApps(page);

  await page.route(/\/resolve$/, (r) =>
    r.fulfill({ json: { candidates: [{ bundle_id: "com.acme.app", name: "Acme" }] } }),
  );
  await page.route(/\/apps$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ json: { id: "app-new", name: "Acme", bundleId: "com.acme.app" } });
  });
  await page.route(/\/competitors\/discover$/, (r) =>
    r.fulfill({
      json: {
        competitors: [{ key: "k1", name: "Rival One", source: "itunes", status: "suggested" }],
        discovered: 1,
      },
    }),
  );
  let confirmed = false;
  await page.route(/\/competitors\/k1\/confirm$/, (r) => {
    confirmed = true;
    return r.fulfill({
      json: { competitors: [{ key: "k1", name: "Rival One", source: "itunes", status: "confirmed" }] },
    });
  });

  await page.goto("/onboarding");
  await page.getByTestId("onb-store-app-store").click();

  await page.getByTestId("connect-input").fill("acme");
  await page.getByTestId("connect-search").click();
  await page.getByTestId("cand-com.acme.app").click();

  // The collapsed answer row shows the real name — and still no grade.
  await expect(page.getByTestId("onb-answer-app")).toContainText("Acme");
  await expect(page.getByText(/Audited:/)).toHaveCount(0);

  await page.getByTestId("onb-suggest-k1").click();
  await expect(page.getByTestId("onb-rival-k1")).toBeVisible();
  expect(confirmed).toBe(true);
});

test("a freshly connected app says it has no suggestions yet, and invents none", async ({ page }) => {
  await noApps(page);
  await page.route(/\/resolve$/, (r) =>
    r.fulfill({ json: { candidates: [{ bundle_id: "com.acme.app", name: "Acme" }] } }),
  );
  await page.route(/\/apps$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ json: { id: "app-new", name: "Acme", bundleId: "com.acme.app" } });
  });
  await page.route(/\/competitors\/discover$/, (r) =>
    r.fulfill({
      json: { competitors: [], discovered: 0, note: "No tracked keywords yet — add a rival by name." },
    }),
  );

  await page.goto("/onboarding");
  await page.getByTestId("onb-store-app-store").click();
  await page.getByTestId("connect-input").fill("acme");
  await page.getByTestId("connect-search").click();
  await page.getByTestId("cand-com.acme.app").click();

  await expect(page.getByTestId("onb-rivals-empty")).toContainText("No tracked keywords yet");
  await expect(page.getByTestId("onb-rival-input")).toBeVisible();
});
