import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * SPA freshness (#54) — E2E. A tab left open across a deploy keeps running the
 * OLD app.<hash>.js until a full reload; we nudge (never auto-reload) with a
 * dismissible banner. The local public/ is UN-HASHED (bare app.js), so the
 * feature is dormant by default — we simulate a "deploy" two ways:
 *   1. inject CFG.SELF_SCRIPT = app.<OLD>.js (the running, hashed bundle), and
 *      set API_BASE so the prod-only gate (API_BASE + hashed bundle) opens;
 *   2. intercept the no-store re-fetch of /index.html (resourceType "fetch",
 *      NOT the initial "document" navigation) to return HTML referencing a
 *      different app.<NEW>.js.
 * The banner then appears on a focus event. The whole probe is isolated from
 * api()/liveMode, so a probe failure must stay silent.
 */

const OLD = "fa044e53"; // the stale tab's bundle (mirrors #54)
const NEW = "919d95b3"; // the freshly-deployed bundle (mirrors #47/#48)
const API_BASE = "http://127.0.0.1:8793"; // point "live" at the test server itself

function indexHtmlReferencing(appName: string): string {
  return [
    "<!doctype html><html><head><title>ShipASO</title></head><body>",
    '<div id="view"></div>',
    '<div class="toast" id="toast"></div>',
    '<div class="freshness-banner" id="freshness" role="status" aria-live="polite"></div>',
    '<script src="config.js"></script>',
    '<script src="mock.js"></script>',
    `<script src="${appName}"></script>`,
    "</body></html>",
  ].join("\n");
}

/**
 * Boot the dashboard with the freshness feature ARMED: API_BASE set + a hashed
 * running bundle (so the prod-only gate opens). `selfScript` defaults to the
 * hashed OLD bundle; pass undefined to leave it un-hashed (dormant). The live
 * /index.html re-fetch is stubbed to reference `liveApp`.
 */
async function gotoArmed(
  page: Page,
  opts: { selfScript?: string; liveApp?: string; abortProbe?: boolean } = {},
): Promise<void> {
  const selfScript = "selfScript" in opts ? opts.selfScript : `${API_BASE}/app.${OLD}.js`;
  const liveApp = opts.liveApp ?? `app.${NEW}.js`;

  // Force live mode + inject the test-only SELF_SCRIPT seam via config.js.
  await page.route("**/config.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.STORE_OPS = { API_BASE: ${JSON.stringify(API_BASE)}${
        selfScript === undefined ? "" : `, SELF_SCRIPT: ${JSON.stringify(selfScript)}`
      } };`,
    }),
  );

  // The freshness probe re-fetches /index.html with cache:no-store. Intercept
  // ONLY that fetch (resourceType "fetch"), never the initial document load,
  // and return HTML referencing `liveApp` (or abort to test the silent path).
  await page.route("**/index.html", (route: Route) => {
    if (route.request().resourceType() === "fetch") {
      if (opts.abortProbe) return route.abort();
      return route.fulfill({ status: 200, contentType: "text/html", body: indexHtmlReferencing(liveApp) });
    }
    // The initial document navigation must serve the REAL public/index.html
    // (with the #freshness element); only the no-store probe fetch is stubbed.
    return route.continue();
  });

  // Keep boot quiet: /auth/me and any api() call return benign shapes so the
  // page settles without a live Worker (the freshness probe is what we test).
  await page.route(`${API_BASE}/auth/me`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authed: false }) }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

  await page.goto("/index.html#/");
  await page.waitForFunction(() => !!(window as any).STORE_OPS_MOCK);
}

const banner = (page: Page) => page.locator("#freshness");

test.describe("SPA freshness banner (#54)", () => {
  test("appears on a new deploy after a focus event, with copy + Refresh", async ({ page }) => {
    await gotoArmed(page); // running app.OLD.js, live index references app.NEW.js
    await expect(banner(page)).toBeHidden();

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText(/A new version of ShipASO is available/i);
    await expect(banner(page).locator("#freshnessReload")).toHaveText("Refresh");
    await expect(banner(page).locator("#freshnessDismiss")).toBeVisible();
  });

  test("Refresh reloads the page", async ({ page }) => {
    await gotoArmed(page);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(banner(page)).toBeVisible();

    let navigated = false;
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigated = true;
    });
    await page.locator("#freshnessReload").click();
    await page.waitForLoadState("load");
    expect(navigated).toBe(true);
  });

  test("Dismiss hides it and does NOT re-nag the same version", async ({ page }) => {
    await gotoArmed(page);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(banner(page)).toBeVisible();

    await page.locator("#freshnessDismiss").click();
    await expect(banner(page)).toBeHidden();

    // Same NEW bundle still referenced → focusing again must keep it hidden.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(200);
    await expect(banner(page)).toBeHidden();
  });

  test("no false positive: live HTML references the SAME running bundle → never shows", async ({ page }) => {
    // Running app.OLD.js and the live index also references app.OLD.js (no deploy).
    await gotoArmed(page, { liveApp: `app.${OLD}.js` });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(200);
    await expect(banner(page)).toBeHidden();
  });

  test("inert in local/dev default: un-hashed bare app.js never shows the banner", async ({ page }) => {
    // No SELF_SCRIPT seam → the running basename is bare app.js → dormant even
    // though the live index references a different app.NEW.js.
    await gotoArmed(page, { selfScript: undefined });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(200);
    await expect(banner(page)).toBeHidden();
  });

  test("silent on probe failure: aborted /index.html re-fetch shows no banner, no toast", async ({ page }) => {
    await gotoArmed(page, { abortProbe: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(200);
    await expect(banner(page)).toBeHidden();
    // The freshness probe is isolated from api()/liveMode — it must never toast.
    await expect(page.locator("#toast")).not.toHaveClass(/show/);
  });
});
