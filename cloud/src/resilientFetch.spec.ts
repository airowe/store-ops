import { describe, expect, it, vi } from "vitest";
import type { FetchFn } from "./engine/index.js";
import { makeFallbackFetch } from "./resilientFetch.js";

/** Build a fake FetchFn that always returns a response with the given status. */
function fakeOk(status: number, text = "..."): FetchFn {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  });
}

/** A fake FetchFn that always throws (simulates a transport-level failure). */
function fakeThrows(message = "boom"): FetchFn {
  return async () => {
    throw new Error(message);
  };
}

describe("makeFallbackFetch", () => {
  it("primary ok → returns primary, fallback NOT called", async () => {
    const fallback = vi.fn(fakeOk(200, "from-fallback"));
    const fetchFn = makeFallbackFetch(fakeOk(200, "from-primary"), fallback);

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");

    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("from-primary");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("primary 403 → fallback called, fallback's result returned", async () => {
    const fallback = vi.fn(fakeOk(200, "from-fallback"));
    const fetchFn = makeFallbackFetch(fakeOk(403, "apple-403"), fallback);

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("from-fallback");
  });

  it("primary throws → fallback called, fallback's result returned", async () => {
    const fallback = vi.fn(fakeOk(200, "from-fallback"));
    const fetchFn = makeFallbackFetch(fakeThrows("primary down"), fallback);

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("from-fallback");
  });

  it("both 403 → fallback's 403 returned (we tried both, caller still sees a result)", async () => {
    const fallback = vi.fn(fakeOk(403, "fallback-403"));
    const fetchFn = makeFallbackFetch(fakeOk(403, "primary-403"), fallback);

    const resp = await fetchFn("https://itunes.apple.com/search?term=calm");

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(403);
    expect(await resp.text()).toBe("fallback-403");
  });

  it("primary throws AND fallback throws → fallback's error is rethrown", async () => {
    const fallback = vi.fn(fakeThrows("fallback down"));
    const fetchFn = makeFallbackFetch(fakeThrows("primary down"), fallback);

    await expect(fetchFn("https://itunes.apple.com/search?term=calm")).rejects.toThrow(
      "fallback down",
    );
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("primary 404 (real not-found, not a transport failure) → returned as-is, fallback NOT called", async () => {
    const fallback = vi.fn(fakeOk(200, "from-fallback"));
    const fetchFn = makeFallbackFetch(fakeOk(404, "not-found"), fallback);

    const resp = await fetchFn("https://itunes.apple.com/lookup?id=0");

    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe("not-found");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("honors a custom retryStatuses set (and ignores the default)", async () => {
    // 418 is in the custom set → triggers fallback; 403 is NOT → returned as-is.
    const fallback = vi.fn(fakeOk(200, "from-fallback"));
    const custom = new Set([418]);

    const teapot = makeFallbackFetch(fakeOk(418, "teapot"), fallback, {
      retryStatuses: custom,
    });
    const resp418 = await teapot("https://x");
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(await resp418.text()).toBe("from-fallback");

    const fallback2 = vi.fn(fakeOk(200, "from-fallback"));
    const forbidden = makeFallbackFetch(fakeOk(403, "forbidden"), fallback2, {
      retryStatuses: custom,
    });
    const resp403 = await forbidden("https://x");
    expect(fallback2).not.toHaveBeenCalled();
    expect(resp403.status).toBe(403);
  });
});
