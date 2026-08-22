import { describe, expect, it, vi } from "vitest";
import { cachedReport, reportCacheKey, allowReport, defaultReportCache } from "./publicReportGuard.js";

/**
 * GET /report/:appId is public, unauthenticated, and each miss runs the agent —
 * which calls the Anthropic API on our key. Three concurrent requests for
 * unrelated apps (WhatsApp, Facebook, Google Maps) were all served in a live
 * check, so the exposure is a stranger spending our inference budget in a loop.
 *
 * The cache is the real fix. The limiter is a damper: Cloudflare's own docs say
 * the binding is "permissive, eventually consistent, and intentionally designed
 * to not be used as an accurate accounting system", and that limits are per
 * location — so it must never be relied on as a spend cap.
 */

const REPORT = { preview: { appName: "X", score: 90 }, appId: "1", bundleId: "b", country: "US" };

describe("reportCacheKey", () => {
  it("keys on the app and country, which is what changes the answer", () => {
    expect(reportCacheKey("123", "US")).not.toBe(reportCacheKey("123", "GB"));
    expect(reportCacheKey("123", "US")).not.toBe(reportCacheKey("124", "US"));
  });

  it("is a url, because that is what the Cache API stores against", () => {
    expect(() => new URL(reportCacheKey("123", "US"))).not.toThrow();
  });

  it("never lets a hostile id escape the key's path", () => {
    // appId reaches here from the URL. A stray slash must not invent a segment.
    const key = reportCacheKey("../../evil", "US");
    expect(new URL(key).pathname).not.toContain("../");
  });
});

describe("cachedReport", () => {
  const fakeCache = () => {
    const store = new Map<string, Response>();
    return {
      store,
      match: vi.fn(async (req: Request) => {
        const hit = store.get(req.url);
        return hit === undefined ? undefined : hit.clone();
      }),
      put: vi.fn(async (req: Request, res: Response) => {
        store.set(req.url, res.clone());
      }),
    };
  };

  it("computes on a miss and serves the same value on a hit", async () => {
    const cache = fakeCache();
    const compute = vi.fn(async () => REPORT);

    const first = await cachedReport("123", "US", cache as never, compute);
    const second = await cachedReport("123", "US", cache as never, compute);

    expect(first).toEqual(REPORT);
    expect(second).toEqual(REPORT);
    // The whole point: the agent — and its Anthropic call — runs once.
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not serve one app's report for another", async () => {
    const cache = fakeCache();
    const compute = vi.fn(async (id: string) => ({ ...REPORT, appId: id }));

    await cachedReport("123", "US", cache as never, () => compute("123"));
    const other = await cachedReport("999", "US", cache as never, () => compute("999"));

    expect(other).toMatchObject({ appId: "999" });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure, so a blip is not frozen in for hours", async () => {
    const cache = fakeCache();
    const failing = vi.fn(async () => {
      throw new Error("itunes down");
    });

    await expect(cachedReport("123", "US", cache as never, failing)).rejects.toThrow();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("still answers when the cache itself is broken", async () => {
    // A cache that throws must degrade to computing, never to a 500: this
    // endpoint is the public funnel.
    const broken = {
      match: vi.fn(async () => {
        throw new Error("cache exploded");
      }),
      put: vi.fn(async () => {
        throw new Error("cache exploded");
      }),
    };
    await expect(cachedReport("123", "US", broken as never, async () => REPORT)).resolves.toEqual(
      REPORT,
    );
  });

  it("stores with a max-age, so a stale audit expires on its own", async () => {
    const cache = fakeCache();
    await cachedReport("123", "US", cache as never, async () => REPORT);
    const stored = cache.store.get(reportCacheKey("123", "US"));
    expect(stored?.headers.get("cache-control")).toMatch(/max-age=\d+/);
  });
});

describe("defaultReportCache", () => {
  it("returns undefined where the Workers cache global does not exist", () => {
    // `caches` is absent under plain vitest. Reading it unguarded threw a
    // ReferenceError that turned the whole public route into a 500.
    expect(defaultReportCache()).toBeUndefined();
  });

  it("computes normally when there is no cache to use", async () => {
    const compute = vi.fn(async () => REPORT);
    await expect(cachedReport("123", "US", undefined, compute)).resolves.toEqual(REPORT);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe("allowReport", () => {
  const limiter = (success: boolean) => ({ limit: vi.fn(async () => ({ success })) });

  it("allows when the limiter says so", async () => {
    expect(await allowReport(limiter(true) as never, "123")).toBe(true);
  });

  it("refuses when the limiter says so", async () => {
    expect(await allowReport(limiter(false) as never, "123")).toBe(false);
  });

  it("keys on the app id, not the caller's address", async () => {
    // Cloudflare's docs advise against IP keys — they are shared by many valid
    // users. Keying on the app also caps the abuse that actually costs money:
    // hammering one app.
    const l = limiter(true);
    await allowReport(l as never, "123");
    expect(l.limit).toHaveBeenCalledWith({ key: expect.stringContaining("123") as unknown as string });
  });

  it("allows when no limiter is bound, rather than closing the funnel", async () => {
    // Absent in local dev and in tests. A missing binding must not 429 everyone.
    expect(await allowReport(undefined, "123")).toBe(true);
  });

  it("allows when the limiter throws, because it is a damper not a gate", async () => {
    const broken = {
      limit: vi.fn(async () => {
        throw new Error("binding exploded");
      }),
    };
    expect(await allowReport(broken as never, "123")).toBe(true);
  });
});
