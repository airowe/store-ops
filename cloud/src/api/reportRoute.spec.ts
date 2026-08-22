/**
 * GET /report/:appId (#287) — the PUBLIC shareable ASO report.
 *
 * A cold visitor hits a clean URL and gets a real, scored audit of any App Store
 * app by numeric id — no auth, no DB write. These assert the route resolves the
 * id via the public lookup, returns the teaser-safe preview (with the scored
 * breakdown), rejects a non-numeric id, and stays honest on an upstream failure.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { handleApi } from "./index.js";
import type { Env } from "../index.js";

function get(path: string): Request {
  return new Request(`https://api.shipaso.com${path}`, { method: "GET" });
}

const ENV = { DEFAULT_COUNTRY: "US" } as unknown as Env;

// A minimal iTunes fake: the lookup-by-id returns one app; the search calls
// (rank checks) return empty results (app not ranked) so the engine runs clean.
function itunesFake(lookupResult: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [lookupResult] }), { status: 200 });
    }
    // search → no results (unranked)
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("GET /report/:appId", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it("returns a scored public report for a numeric App Store id", async () => {
    globalThis.fetch = itunesFake({
      bundleId: "com.acme.app",
      trackName: "Acme — Do The Thing",
      genres: ["Productivity"],
      description: "Acme helps you do the thing. ".repeat(40),
      averageUserRating: 4.6,
      userRatingCount: 2400,
      version: "2.0",
    });

    const res = await handleApi(get("/report/123456789?country=us"), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appId: string; bundleId: string; preview: { score: number | null; breakdown: unknown[]; appName: string } };
    expect(body.appId).toBe("123456789");
    expect(body.bundleId).toBe("com.acme.app");
    // the scored breakdown rides through
    expect(Array.isArray(body.preview.breakdown)).toBe(true);
    expect(body.preview.breakdown.length).toBeGreaterThan(0);
    expect(typeof body.preview.score === "number" || body.preview.score === null).toBe(true);
  });

  it("rejects a non-numeric app id with a 400", async () => {
    globalThis.fetch = itunesFake({});
    const res = await handleApi(get("/report/not-a-number"), ENV);
    expect(res.status).toBe(400);
  });

  it("404s when the id resolves to no app", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const res = await handleApi(get("/report/999999999"), ENV);
    expect(res.status).toBe(404);
  });

  it("surfaces an upstream App Store failure as an honest 503, not a 500", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }),
    ) as unknown as typeof fetch;
    const res = await handleApi(get("/report/123456789"), ENV);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/internal error/i);
  });
});

describe("GET /report/:appId rate limiting", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("429s when the limiter refuses, rather than running the agent", async () => {
    // Each miss reasons with the Anthropic client, so the whole point is that a
    // refused request must not reach the agent at all.
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const env = {
      DEFAULT_COUNTRY: "US",
      REPORT_LIMITER: { limit: async () => ({ success: false }) },
    } as unknown as Env;

    const res = await handleApi(get("/report/310633997"), env);

    expect(res.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves normally when no limiter is bound", async () => {
    // Unset in local dev. A missing binding must not close the public funnel.
    const env = { DEFAULT_COUNTRY: "US" } as unknown as Env;
    const res = await handleApi(get("/report/not-numeric"), env);
    // 400 for the bad id proves it reached the handler rather than being 429'd.
    expect(res.status).toBe(400);
  });
});
