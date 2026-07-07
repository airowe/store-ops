import { describe, it, expect } from "vitest";
// Pure ESM (Node-CI-importable, no TS loader) — same file the middleware uses.
import {
  isNavigationRequest,
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

  it("rewrites an owned navigation path to the new app entry", () => {
    expect(serveDecision({ method: "GET", pathname: "/settings", accept: "text/html" }, resolve)).toBe(
      "rewrite-web",
    );
    expect(serveDecision({ method: "GET", pathname: "/", accept: "text/html" }, resolve)).toBe(
      "rewrite-web",
    );
  });

  it("passes through a legacy navigation path (not owned)", () => {
    expect(serveDecision({ method: "GET", pathname: "/apps", accept: "text/html" }, resolve)).toBe(
      "passthrough",
    );
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
