import { describe, it, expect } from "vitest";
// Pure ESM (Node-CI-importable, no TS loader) — same file the middleware uses.
import {
  isNavigationRequest,
  isAssetRequest,
  serveDecision,
  NEW_APP_ENTRY,
  extractOwnedArray,
} from "../../scripts/webEnable.mjs";

/**
 * The strangler middleware's pure decision: which requests get rewritten to the
 * new app's HTML entry vs. passed through to static (legacy pages, /assets/*).
 * `resolveSurface` itself is tested in cloud/web; here we stub its contract and
 * prove the request-shape gating + composition.
 */

/** A stub matching resolveSurface: owns "/" and "/settings" for these tests. */
const owns =
  (paths: string[]) =>
  (pathname: string): "web" | "legacy" => {
    const p = pathname.replace(/\/+$/, "") || "/";
    return paths.some((b) => {
      const base = b.replace(/\/+$/, "") || "/";
      return p === base || p.startsWith(base + "/");
    })
      ? "web"
      : "legacy";
  };

describe("isNavigationRequest", () => {
  it("treats a GET page path (html accept) as navigation", () => {
    expect(isNavigationRequest("GET", "/settings", "text/html")).toBe(true);
    expect(isNavigationRequest("GET", "/", "text/html,*/*")).toBe(true);
  });

  it("treats /assets/* and extension'd files as NOT navigation", () => {
    expect(isNavigationRequest("GET", "/assets/index-abc.js", "*/*")).toBe(false);
    expect(isNavigationRequest("GET", "/styles.css", "text/css")).toBe(false);
    expect(isNavigationRequest("GET", "/app.js", "*/*")).toBe(false);
  });

  it("rejects non-GET/HEAD and non-html accepts", () => {
    expect(isNavigationRequest("POST", "/settings", "text/html")).toBe(false);
    expect(isNavigationRequest("GET", "/settings", "application/json")).toBe(false);
  });

  it("a bare page path with no accept header still counts (curl / direct nav)", () => {
    expect(isNavigationRequest("GET", "/settings")).toBe(true);
  });
});

describe("serveDecision", () => {
  const resolve = owns(["/", "/settings", "/login"]);

  /**
   * #356 Phase 3: static pages that are NOT the SPA must survive the "every
   * navigation goes to the app" rule, or relocating them into the app's
   * public/ silently breaks them:
   *
   *  • /auth/m is the magic-link sign-in landing. It is deliberately framework-
   *    free (it runs before any bundle, from an email client, on an unknown
   *    device) and must NOT auto-redirect — that would consume the magic link
   *    before the app could hand off. Serving it the SPA shell breaks sign-in.
   *  • /.well-known/apple-app-site-association is extensionless, so it looks
   *    exactly like a page path — and Apple's CDN fetches it with no Accept
   *    header or `*​/*`, both of which pass the navigation sniff. Serving it
   *    HTML breaks iOS universal links.
   */
  it("never hijacks the static pages that are not the SPA", () => {
    for (const accept of ["text/html", "*/*", ""]) {
      expect(serveDecision({ method: "GET", pathname: "/auth/m", accept }, resolve)).toBe(
        "passthrough",
      );
      expect(
        serveDecision(
          { method: "GET", pathname: "/.well-known/apple-app-site-association", accept },
          resolve,
        ),
      ).toBe("passthrough");
    }
  });

  it("does not over-reach: /authorize and /auth-something are still the SPA's", () => {
    // The exclusion must match real paths, not any path merely starting "/auth".
    expect(serveDecision({ method: "GET", pathname: "/authorize", accept: "text/html" }, resolve)).toBe(
      "rewrite-web",
    );
    expect(
      serveDecision({ method: "GET", pathname: "/auth-something", accept: "text/html" }, resolve),
    ).toBe("rewrite-web");
  });

  it("rewrites an owned navigation path to the new app entry", () => {
    expect(serveDecision({ method: "GET", pathname: "/settings", accept: "text/html" }, resolve)).toBe(
      "rewrite-web",
    );
    expect(serveDecision({ method: "GET", pathname: "/", accept: "text/html" }, resolve)).toBe(
      "rewrite-web",
    );
  });

  /**
   * #356 Phase 3: an UNOWNED navigation now reaches the new app too, which
   * renders its 404. It used to pass through to dist/index.html — the legacy
   * dashboard — so a typo or a stale bookmark rendered a whole dashboard shell
   * as though the navigation had worked.
   *
   * Retiring cloud/public/ removes that fallback entirely, so the new app has
   * to answer for these paths or nothing does.
   */
  it("sends an unowned navigation path to the new app, which 404s it", () => {
    expect(serveDecision({ method: "GET", pathname: "/apps", accept: "text/html" }, resolve)).toBe(
      "rewrite-web",
    );
    expect(
      serveDecision({ method: "GET", pathname: "/old-bookmark", accept: "text/html" }, resolve),
    ).toBe("rewrite-web");
  });

  it("passes through the new app's OWN assets (owned prefix, but an asset request)", () => {
    // "/" is owned, but /assets/x.js must reach static, never the HTML rewrite.
    expect(serveDecision({ method: "GET", pathname: "/assets/index-abc.js", accept: "*/*" }, resolve)).toBe(
      "passthrough",
    );
  });

  it("passes through legacy static files even under an owned-looking path", () => {
    expect(serveDecision({ method: "GET", pathname: "/styles.css", accept: "text/css" }, resolve)).toBe(
      "passthrough",
    );
  });

  it("passes through a form POST to an owned path (only navigation GETs rewrite)", () => {
    expect(serveDecision({ method: "POST", pathname: "/settings", accept: "text/html" }, resolve)).toBe(
      "passthrough",
    );
  });

  it("serves the new-app shell via the EXTENSIONLESS path (Pages 308s *.html away)", () => {
    // Regression: the file is _web.html on disk, but Cloudflare Pages redirects
    // /_web.html → /_web, which broke the middleware rewrite. Must be /_web.
    expect(NEW_APP_ENTRY).toBe("/_web");
    expect(NEW_APP_ENTRY.endsWith(".html")).toBe(false);
  });
});

/**
 * #393: a missing /assets/* file must 404 as a FILE, never be handed the SPA
 * shell with a 200.
 *
 * This module's own docstring has claimed since #356 Phase 3 that "a genuinely
 * missing FILE still 404s as a file rather than being handed an HTML shell".
 * That was never true in production and nothing asserted it: `serveDecision`
 * correctly returns "passthrough", but Pages' asset store then falls back to
 * index.html with a 200, because the app build ships no 404.html.
 *
 * Why it matters beyond tidiness — a `200` is CACHEABLE. Under
 * `/assets/* → max-age=31536000, immutable`, one bad response gets stored as
 * though it were the real bundle. That is #392: app.shipaso.com served a blank
 * page for hours because an HTML error was cached under the bundle's URL, and
 * it would not have expired until 2027.
 *
 * A 404 makes that class of poisoning far harder: there is no successful
 * response to cache in the first place.
 */
describe("isAssetRequest (#393 — an asset miss must not become an HTML 200)", () => {
  /**
   * Path-shape only, deliberately — no Accept sniff. The Accept header is
   * exactly what proved unreliable in #392: browsers send `*​/*` for
   * `crossorigin` bundles and Apple's CDN sends none at all.
   */
  it("identifies /assets/* as an asset request", () => {
    expect(isAssetRequest("/assets/index-abc123.js")).toBe(true);
    expect(isAssetRequest("/assets/index-abc123.css")).toBe(true);
  });

  it("identifies any path with a file extension as an asset request", () => {
    expect(isAssetRequest("/favicon.ico")).toBe(true);
    expect(isAssetRequest("/config.js")).toBe(true);
    expect(isAssetRequest("/robots.txt")).toBe(true);
  });

  it("does NOT treat page paths as asset requests", () => {
    // These must keep reaching the SPA, which renders its own 404 (#356 Phase 3).
    expect(isAssetRequest("/")).toBe(false);
    expect(isAssetRequest("/settings")).toBe(false);
    expect(isAssetRequest("/runs/759ca698-5842-4152-9fe4-c42202bf56da")).toBe(false);
    expect(isAssetRequest("/old-bookmark")).toBe(false);
  });

  /**
   * The extensionless static pages are the trap here: /auth/m and the Apple
   * association file have no extension, so an extension-only rule keeps them
   * out — which is what we want, they are real files that must be served, not
   * 404'd. Guarding it so a future tightening of the rule cannot break sign-in
   * or iOS universal links.
   */
  it("leaves the extensionless static pages alone", () => {
    expect(isAssetRequest("/auth/m")).toBe(false);
    expect(isAssetRequest("/.well-known/apple-app-site-association")).toBe(false);
  });

  it("is the complement of a navigation for the paths that matter", () => {
    // Nothing may be BOTH: that would make the worker's branch order significant.
    for (const p of ["/assets/x.js", "/favicon.ico", "/", "/settings", "/auth/m"]) {
      const nav = isNavigationRequest("GET", p, "text/html");
      const asset = isAssetRequest(p);
      expect(nav && asset, `${p} classified as both navigation and asset`).toBe(false);
    }
  });
});

describe("extractOwnedArray (map never forks)", () => {
  it("extracts the full array including RegExp literals with ] inside char classes", () => {
    const src = `
      export const OWNED_PATHS = [
        "/settings",
        "/",
        // App detail — a comment with a ] bracket and a "quote"
        /^\\/apps\\/[^/]+$/,
        /^\\/runs\\/[^/]+$/,
      ];
      export function resolveSurface() {}
    `;
    const lit = extractOwnedArray(src);
    // eslint-disable-next-line no-eval
    const arr = eval(lit as string) as unknown[];
    expect(arr).toHaveLength(4);
    expect(arr[0]).toBe("/settings");
    expect(arr[2]).toBeInstanceOf(RegExp);
    // the regex must actually match a real app-detail path (proves it wasn't truncated)
    const appDetail = arr[2] as RegExp;
    expect(appDetail.test("/apps/abc")).toBe(true);
    expect(appDetail.test("/apps/abc/war-room")).toBe(false);
  });

  it("returns null when the marker is absent", () => {
    expect(extractOwnedArray("const NOPE = [1,2,3];")).toBeNull();
  });

  it("matches the ACTUAL edgeRoutes.ts map (integration — the real source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("../../web/src/shell/edgeRoutes.ts", import.meta.url)),
      "utf8",
    );
    const lit = extractOwnedArray(src);
    expect(lit).not.toBeNull();
    // eslint-disable-next-line no-eval
    const arr = eval(lit as string) as unknown[];
    // whatever the current map is, it must parse to a non-trivial array whose
    // dynamic entries are real RegExps (the truncation bug produced a broken one)
    expect(arr.length).toBeGreaterThanOrEqual(5);
    const dynamic = arr.filter((x: unknown) => x instanceof RegExp);
    expect(dynamic.length).toBeGreaterThanOrEqual(1);
    for (const re of dynamic) expect(() => (re as RegExp).test("/x")).not.toThrow();
  });
});
