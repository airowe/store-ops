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
  opts: { name?: string; bundleId?: string; keywords?: string[] } = {},
): Promise<string> {
  const name = opts.name ?? "Calm";
  const bundleId = opts.bundleId ?? "com.calm.calmapp";
  const keywords =
    opts.keywords ??
    ["meditation", "sleep sounds", "breathing exercises", "anxiety relief", "focus music", "habit tracker"];

  return await page.evaluate(
    async ({ name, bundleId, keywords }) => {
      const M = (window as any).STORE_OPS_MOCK;
      const EM = "demo@store-ops.dev";
      const conn = await M.handle("POST", "/apps", { bundle_id: bundleId, name, keywords }, EM);
      const id = (await conn.json()).id as string;
      await M.handle("POST", `/apps/${id}/run`, {}, EM);
      return id;
    },
    { name, bundleId, keywords },
  );
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
