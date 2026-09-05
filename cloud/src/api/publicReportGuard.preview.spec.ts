import { describe, expect, it, vi } from "vitest";
import { cachedByKey, previewCacheKey, reportCacheKey } from "./publicReportGuard.js";

/**
 * The anonymous MCP `preview_app` reuses the /report guard, but its identity is
 * a bundle id + country, not a numeric App Store id — so it needs its own key
 * in the same namespace, and the cache helper needs to take a key rather than
 * assume the report shape.
 */
describe("previewCacheKey", () => {
  it("keys on bundle id and country", () => {
    expect(previewCacheKey("com.a", "US")).not.toBe(previewCacheKey("com.a", "GB"));
    expect(previewCacheKey("com.a", "US")).not.toBe(previewCacheKey("com.b", "US"));
  });

  it("never collides with a report key for the same text", () => {
    expect(previewCacheKey("123", "US")).not.toBe(reportCacheKey("123", "US"));
  });

  it("is a url and a hostile bundle id cannot escape its path", () => {
    const key = previewCacheKey("../../evil", "US");
    expect(() => new URL(key)).not.toThrow();
    expect(new URL(key).pathname).not.toContain("../");
  });
});

describe("cachedByKey", () => {
  it("computes once per key and serves the hit thereafter", async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
      put: vi.fn(async (req: Request, res: Response) => { store.set(req.url, res.clone()); }),
    };
    const compute = vi.fn(async () => ({ n: 1 }));
    expect(await cachedByKey("https://cache.shipaso.internal/x", cache, compute)).toEqual({ n: 1 });
    expect(await cachedByKey("https://cache.shipaso.internal/x", cache, compute)).toEqual({ n: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not cache a thrown compute", async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
      put: vi.fn(async (req: Request, res: Response) => { store.set(req.url, res.clone()); }),
    };
    await expect(cachedByKey("https://cache.shipaso.internal/y", cache, async () => { throw new Error("upstream"); })).rejects.toThrow("upstream");
    expect(cache.put).not.toHaveBeenCalled();
  });
});
