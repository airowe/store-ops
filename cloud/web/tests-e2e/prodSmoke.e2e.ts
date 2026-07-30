/**
 * Does app.shipaso.com actually RENDER? Asked of the real site, in a real browser.
 *
 * Every other check we had said production was healthy while it served a blank
 * page for hours (2026-07-28). The deploy was green, 578 unit tests passed, and
 * `scripts/smoke.mjs` fetched the bundle and got `application/javascript`, 200.
 * The page was still blank.
 *
 * The reason nothing caught it: `fetch` and a browser send DIFFERENT requests.
 * index.html loads its bundles with `crossorigin`, so a browser attaches an
 * `Origin` header; curl and node-fetch do not. Cloudflare had cached an HTML
 * error response under the `Origin`-bearing cache key, with the `_headers` rule
 * `/assets/* → max-age=31536000, immutable`. So:
 *
 *   curl  (no Origin) → cached GOOD copy → application/javascript ✓
 *   Chrome  (Origin)  → cached HTML      → "Refused to apply style…" ✗
 *
 * A checker that does not send what a browser sends is not checking the product.
 * Hence Playwright against the live origin rather than another fetch assertion:
 * the browser is the part under test.
 *
 * Scope: READ-ONLY and unauthenticated — a public GET of the shell. No session,
 * no writes, no credentials. It asserts the app MOUNTED, deliberately not what
 * it rendered; signed-out content is the auth suite's job, and coupling this to
 * copy would make the one check that must stay trustworthy the flakiest.
 *
 * Not a deploy gate (it runs after deploy; gating would be circular) — see the
 * post-deploy step in .github/workflows/deploy.yml.
 *
 * Run: PROD_SMOKE=1 npx playwright test -c playwright.prod.config.ts
 */
import { expect, test } from "@playwright/test";

const BASE = (process.env.DASHBOARD_URL ?? "https://app.shipaso.com").replace(/\/$/, "");

test.describe("production renders in a real browser", () => {
  test("the app mounts — #root is not empty", async ({ page }) => {
    /**
     * The precise signature of the outage. A module script or stylesheet
     * rejected for its MIME type never executes, so React never mounts and
     * #root stays empty — with NO page error, which is why "no console errors"
     * read as healthy.
     */
    const blocked: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error" && /MIME type|Failed to load module script/i.test(text)) {
        blocked.push(text);
      }
    });
    const failed: string[] = [];
    page.on("requestfailed", (req) => failed.push(`${req.method()} ${req.url()}`));

    const res = await page.goto(BASE + "/", { waitUntil: "networkidle" });
    expect(res?.status(), `GET ${BASE}/ should be 200`).toBe(200);

    // Assert the causes first: they name WHY the page is blank. Asserting only
    // on #root would report "empty" and leave the reader to re-derive the rest.
    expect(blocked, "browser refused an asset (MIME type) — see the header docstring").toEqual([]);
    expect(failed, "a request the browser needed did not load").toEqual([]);

    const root = page.locator("#root");
    await expect(root, "#root missing from the shell").toHaveCount(1);
    // Toal wait, not a fixed sleep: mount is async and the box may be empty for
    // a frame. `toHaveCount` above already proved the element exists.
    await expect
      .poll(async () => (await root.innerHTML()).length, {
        message: "#root never received any markup — the app did not mount",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  });

  test("the stylesheet applied — the page is not unstyled HTML", async ({ page }) => {
    /**
     * The CSS and the JS failed independently in the outage (two separate cache
     * entries). A check that only proved the app mounted would have gone green
     * on a page rendering as unstyled black-on-white text.
     *
     * Asserted via a computed style rather than the stylesheet's presence:
     * `<link>` resolving is not the same as the browser APPLYING it, and it was
     * exactly the applying step that got refused.
     */
    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    const sheets = await page.evaluate(
      () => [...document.styleSheets].filter((s) => (s.href ?? "").includes("/assets/")).length,
    );
    expect(sheets, "no /assets/ stylesheet was accepted by the browser").toBeGreaterThan(0);

    // app.css paints a dark surface; an unstyled document is transparent/white.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg, "body has no background — the stylesheet did not apply").not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(bg).not.toBe("rgb(255, 255, 255)");
  });

  test("assets survive a browser-shaped (crossorigin) request", async ({ page, request }) => {
    /**
     * The regression test for the cache-poisoning itself, pinned to the header
     * that distinguishes the two: `Origin`. This would have been RED throughout
     * the outage while an identical request without `Origin` was green.
     *
     * It reads the asset URLs out of the live HTML rather than hardcoding a
     * hash, so it keeps working across deploys.
     */
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const urls = await page.evaluate(() =>
      [
        ...[...document.querySelectorAll("script[src]")].map((s) => (s as HTMLScriptElement).src),
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (l) => (l as HTMLLinkElement).href,
        ),
      ].filter((u) => u.includes("/assets/")),
    );
    expect(urls.length, "index.html referenced no /assets/ bundles").toBeGreaterThan(0);

    for (const url of urls) {
      const res = await request.get(url, { headers: { Origin: BASE } });
      expect(res.status(), `${url} (with Origin)`).toBe(200);
      const type = res.headers()["content-type"] ?? "";
      const expected = url.endsWith(".css") ? /text\/css/ : /javascript|ecmascript/;
      expect(
        type,
        `${url} served as "${type}" to a crossorigin request — cache poisoning, see the header docstring`,
      ).toMatch(expected);
    }
  });
});
