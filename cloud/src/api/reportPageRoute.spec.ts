import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

/**
 * GET /r/:appId — the report as a PAGE, through the real router (loop 2,
 * criteria 1 and 4). Same data path as GET /report/:appId: same cache entry,
 * same damper, same error messages — but HTML, with per-app head tags.
 */

const LISTING = {
  bundleId: "com.acme.app",
  trackName: "Acme — Do The Thing",
  genres: ["Productivity"],
  description: "Acme helps you do the thing. ".repeat(40),
  averageUserRating: 4.6,
  userRatingCount: 2400,
  version: "2.0",
};

function itunesFake(lookupResult: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [lookupResult] }), { status: 200 });
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  });
}

/** A Cache API stand-in so a JSON call and an HTML call can share one entry. */
function fakeCaches() {
  const store = new Map<string, Response>();
  return {
    default: {
      match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
      put: vi.fn(async (req: Request, res: Response) => { store.set(req.url, res.clone()); }),
    },
  };
}

const get = (path: string, host = "https://api.shipaso.com") => new Request(`${host}${path}`, { method: "GET" });
const ENV = { DEFAULT_COUNTRY: "US" } as unknown as Env;

describe("GET /r/:appId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns an HTML page with the app's own head tags", async () => {
    vi.stubGlobal("fetch", itunesFake(LISTING));
    const res = await handleApi(get("/r/123456789"), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain("<title>Acme — Do The Thing — ASO report | ShipASO</title>");
    expect(html).toContain('<meta name="description" content="Acme — Do The Thing ASO report:');
    // No REPORT_PAGE_ORIGIN → the request origin is the canonical, honestly.
    expect(html).toContain('<link rel="canonical" href="https://api.shipaso.com/r/123456789">');
    expect(html).toContain("com.acme.app");
  });

  it("uses REPORT_PAGE_ORIGIN for the canonical when it is set", async () => {
    vi.stubGlobal("fetch", itunesFake(LISTING));
    const env = { ...ENV, REPORT_PAGE_ORIGIN: "https://shipaso.com" } as unknown as Env;
    const html = await (await handleApi(get("/r/123456789?country=gb"), env)).text();
    expect(html).toContain('<link rel="canonical" href="https://shipaso.com/r/123456789?country=gb">');
  });

  it("shares the JSON route's cache entry: one compute serves both", async () => {
    const fetchSpy = itunesFake(LISTING);
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("caches", fakeCaches());
    const json = await handleApi(get("/report/123456789?country=us"), ENV);
    expect(json.status).toBe(200);
    const calls = fetchSpy.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const html = await handleApi(get("/r/123456789?country=us"), ENV);
    expect(html.status).toBe(200);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it("negative control: with no cache, the second call does compute again", async () => {
    const fetchSpy = itunesFake(LISTING);
    vi.stubGlobal("fetch", fetchSpy);
    await handleApi(get("/report/123456789?country=us"), ENV);
    const calls = fetchSpy.mock.calls.length;
    await handleApi(get("/r/123456789?country=us"), ENV);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("GET /r/:appId error pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("non-numeric id → 400 HTML with the JSON route's message", async () => {
    vi.stubGlobal("fetch", itunesFake(LISTING));
    const res = await handleApi(get("/r/not-a-number"), ENV);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain("numeric App Store id");
  });

  it("App Store unreachable → 503 HTML with retry text, never a bare 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } })));
    const res = await handleApi(get("/r/123456789"), ENV);
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("try again in a moment");
    expect(html).not.toMatch(/internal error/i);
  });

  it("damper says no → 429 HTML, and the agent never runs", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const env = { DEFAULT_COUNTRY: "US", REPORT_LIMITER: { limit: async () => ({ success: false }) } } as unknown as Env;
    const res = await handleApi(get("/r/310633997"), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain("try again shortly");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no app for the id → 404 HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 })));
    const res = await handleApi(get("/r/999999999"), ENV);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No app found");
  });
});
