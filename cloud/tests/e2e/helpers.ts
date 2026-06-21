import type { Page } from "@playwright/test";

/**
 * Force the dashboard into mock-backend mode regardless of what public/config.js
 * ships with, by intercepting the config.js request and returning an empty
 * API_BASE (which flips app.js's `liveMode` off → all api() calls route to
 * window.STORE_OPS_MOCK). This keeps the real config.js untouched on disk and
 * guarantees the E2E run never reaches a live Worker/D1/network.
 */
export async function gotoMockDashboard(page: Page, hash = "#/"): Promise<void> {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: 'window.STORE_OPS = { API_BASE: "" };',
    }),
  );
  // Fonts are remote (Google Fonts) — block them so the run is hermetic + fast.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

  // Hermetic state: clear the mock DB (localStorage) BEFORE the page boots so no
  // app/run a prior test connected leaks into this one. Tests that need state
  // seed it explicitly via seedAppWithRun.
  await page.addInitScript(() => {
    try { localStorage.removeItem("store-ops:mockdb:v1"); } catch { /* no-op */ }
  });

  await page.goto(`/index.html${hash}`);
  // app.js boots after config.js + mock.js; wait for the mock to be installed.
  await page.waitForFunction(() => !!(window as any).STORE_OPS_MOCK);
}

/**
 * Seed an app directly through the mock backend (same partition the UI uses:
 * email() defaults to "demo@store-ops.dev"), run the agent once so it has a real
 * audit + ranks, and return its id. Used by tests that want to start ON an app
 * rather than re-drive the connect funnel every time.
 */
export async function seedAppWithRun(
  page: Page,
  opts: { name?: string; bundleId?: string; keywords?: string[]; asc?: boolean; emptyLive?: boolean } = {},
): Promise<string> {
  const name = opts.name ?? "Calm";
  const bundleId = opts.bundleId ?? "com.calm.calmapp";
  const asc = opts.asc ?? false;
  // emptyLive: simulate an app whose live ASC subtitle + keyword field are BLANK
  // (read-but-empty) — to assert the gauge shows "empty" (an opportunity), never
  // the false "unseen" (which means unread). Only meaningful with asc:true.
  const emptyLive = opts.emptyLive ?? false;
  const keywords =
    opts.keywords ??
    ["meditation", "sleep sounds", "breathing exercises", "anxiety relief", "focus music", "habit tracker"];

  return await page.evaluate(
    async ({ name, bundleId, keywords, asc, emptyLive }) => {
      const M = (window as any).STORE_OPS_MOCK;
      const EM = "demo@store-ops.dev";
      // Seeding is a test fixture, not a paywall scenario — lift the partition to
      // the top tier so seeding N apps never trips the free-tier connect gate
      // (#27). Tests that exercise the 402 paywall set the tier explicitly.
      await M.handle("POST", "/_tier", { tier: "fleet" }, EM);
      // emptyLive pins the live ASC subtitle/keyword field to "" via the connect
      // body's test-only fixture hooks, so the keyed run reads them as read-but-
      // blank (mirrors a real app with no subtitle/keyword field set).
      const connectBody: Record<string, unknown> = { bundle_id: bundleId, name, keywords };
      if (emptyLive) {
        connectBody._liveSubtitle = "";
        connectBody._liveKeywords = "";
      }
      const conn = await M.handle("POST", "/apps", connectBody, EM);
      const id = (await conn.json()).id as string;
      // asc:true seeds a Mode-A (keyed) run so the full findings set is produced
      // (appInfo/previews/locales etc.); the default plain run yields the thin set.
      if (asc) {
        await M.handle("POST", `/apps/${id}/run-asc`, {
          issuerId: "11111111-2222-3333-4444-555555555555",
          keyId: "ABC123DEFG",
          p8: "-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----",
        }, EM);
      } else {
        await M.handle("POST", `/apps/${id}/run`, {}, EM);
      }
      return id;
    },
    { name, bundleId, keywords, asc, emptyLive },
  );
}

/**
 * Set the mock backend's billing tier for the demo partition (drives the #27
 * tier-limit paywall deterministically). The mock mirrors src/billing.ts:
 * free/launch = 1 app, autopilot = 3, fleet = 50.
 */
export async function setMockTier(page: Page, tier: string): Promise<void> {
  await page.evaluate(async (t) => {
    const M = (window as any).STORE_OPS_MOCK;
    await M.handle("POST", "/_tier", { tier: t }, "demo@store-ops.dev");
  }, tier);
}

/** Read the rank-movement card's rows as {keyword, prev, cur, chip} for assertions. */
export async function readDeltaRows(
  page: Page,
): Promise<Array<{ keyword: string; prev: string; cur: string; chip: string }>> {
  return await page.$$eval(".deltarow", (rows) =>
    rows.map((r) => ({
      keyword: r.querySelector(".dkw")?.textContent?.trim() ?? "",
      prev: r.querySelector(".dprev")?.textContent?.trim() ?? "",
      cur: r.querySelector(".dcur")?.textContent?.trim() ?? "",
      chip: r.querySelector(".dchip")?.textContent?.trim() ?? "",
    })),
  );
}
