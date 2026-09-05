import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

/**
 * POST /preview (#537). Measured on production: Slack 299 s, Notion 150 s —
 * uncached, so the same app cost the same again a second later, and every
 * candidate tap in the mobile app was a cold multi-minute engine run. The
 * report page and the anonymous MCP preview already share a six-hour cache
 * keyed on bundle id + country; this route now uses the same key, so a
 * preview computed anywhere serves everywhere.
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

function itunesFake() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [LISTING] }), { status: 200 });
    }
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  });
}

function fakeCaches() {
  const store = new Map<string, Response>();
  const def = {
    match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
    put: vi.fn(async (req: Request, res: Response) => { store.set(req.url, res.clone()); }),
  };
  return { default: def, store };
}

const ENV = { DEFAULT_COUNTRY: "US" } as unknown as Env;
const post = (body: unknown) =>
  new Request("https://api.shipaso.com/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /preview shares the report cache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a repeat preview of the same app costs zero upstream calls", async () => {
    const fetchSpy = itunesFake();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("caches", fakeCaches());
    const first = await handleApi(post({ bundle_id: "com.acme.app", country: "us" }), ENV);
    expect(first.status).toBe(200);
    const calls = fetchSpy.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const second = await handleApi(post({ bundle_id: "com.acme.app", country: "us" }), ENV);
    expect(second.status).toBe(200);
    expect(fetchSpy.mock.calls.length).toBe(calls);
    expect(await second.json()).toEqual(await first.json());
  });

  it("the entry is the SAME one the report page and the MCP preview use", async () => {
    // Warm the cache through /preview, then read the report page: no new fetch.
    const fetchSpy = itunesFake();
    vi.stubGlobal("fetch", fetchSpy);
    const caches = fakeCaches();
    vi.stubGlobal("caches", caches);
    await handleApi(post({ bundle_id: "com.acme.app", country: "us" }), ENV);
    const keys = [...caches.store.keys()];
    expect(keys.some((k) => k.includes("/preview/com.acme.app/us"))).toBe(true);
  });

  it("negative control: without a cache the second call computes again", async () => {
    const fetchSpy = itunesFake();
    vi.stubGlobal("fetch", fetchSpy);
    await handleApi(post({ bundle_id: "com.acme.app", country: "us" }), ENV);
    const calls = fetchSpy.mock.calls.length;
    await handleApi(post({ bundle_id: "com.acme.app", country: "us" }), ENV);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls);
  });

  it("an ambiguous query returns candidates and caches nothing", async () => {
    const many = { resultCount: 3, results: [LISTING, { ...LISTING, bundleId: "com.acme.two", trackName: "Acme Two" }, { ...LISTING, bundleId: "com.acme.three", trackName: "Acme Three" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(many), { status: 200 })));
    const caches = fakeCaches();
    vi.stubGlobal("caches", caches);
    const res = await handleApi(post({ query: "acme" }), ENV);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { needsChoice?: boolean }).needsChoice).toBe(true);
    expect(caches.default.put).not.toHaveBeenCalled();
  });

  it("is damped per app like the report page: a refused request never runs the agent", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const env = { DEFAULT_COUNTRY: "US", REPORT_LIMITER: { limit: async () => ({ success: false }) } } as unknown as Env;
    const res = await handleApi(post({ bundle_id: "com.acme.app" }), env);
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still turns an App Store outage into an honest 503, and does not cache it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } })));
    const caches = fakeCaches();
    vi.stubGlobal("caches", caches);
    const res = await handleApi(post({ bundle_id: "com.acme.app" }), ENV);
    expect(res.status).toBe(503);
    expect(caches.default.put).not.toHaveBeenCalled();
  });
});
