import { beforeEach, describe, expect, it } from "vitest";
import { ranksFor, rankFor } from "./rankCheck.js";
import { __setSleep, type FetchFn } from "./itunes.js";

// Never actually sleep in tests (backoff/pause are exercised by call counts).
beforeEach(() => __setSleep(async () => {}));

/** Build a fake iTunes Search response body. */
function searchBody(bundleIds: string[], opts: { resultCount?: number } = {}): string {
  const results = bundleIds.map((b, i) => ({
    bundleId: b,
    trackName: `App ${i + 1}`,
  }));
  return JSON.stringify({ resultCount: opts.resultCount ?? results.length, results });
}

/** A mock FetchFn that returns the given body with status 200. */
function okFetch(body: string): FetchFn {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  });
}

describe("rankFor — organic rank parsing", () => {
  it("returns the 1-based index of the app in results", async () => {
    const fetchFn = okFetch(searchBody(["com.other.a", "com.me.app", "com.other.b"]));
    const r = await rankFor(fetchFn, "com.me.app", "stoic");
    expect(r.rank).toBe(2);
    expect(r.foundName).toBe("App 2");
    expect(r.error).toBe("");
  });

  it("returns rank=null when the app is not in the results (not in top 200)", async () => {
    const fetchFn = okFetch(searchBody(["com.a", "com.b"], { resultCount: 200 }));
    const r = await rankFor(fetchFn, "com.me.app", "stoic");
    expect(r.rank).toBeNull();
    expect(r.total).toBe(200);
  });

  it("reports rank #1 when the app is the top result", async () => {
    const fetchFn = okFetch(searchBody(["com.me.app", "com.other"]));
    const r = await rankFor(fetchFn, "com.me.app", "stoic");
    expect(r.rank).toBe(1);
  });

  it("caps the scan depth at 200 (limit clamps)", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => searchBody([]) };
    };
    const r = await rankFor(fetchFn, "x", "kw", { limit: 9999 });
    expect(r.limit).toBe(200);
    expect(capturedUrl).toContain("limit=200");
  });

  it("parses Apple JSON with raw control chars in description strings", async () => {
    // raw newline + tab inside a description string (strict JSON would reject)
    const body = `{"resultCount":1,"results":[{"bundleId":"com.me.app","trackName":"X","description":"line one\nline\ttwo"}]}`;
    const r = await rankFor(okFetch(body), "com.me.app", "kw");
    expect(r.rank).toBe(1);
  });
});

describe("ranksFor — batch resilience + ceiling", () => {
  it("does not abort the batch when one keyword's fetch fails", async () => {
    let call = 0;
    const fetchFn: FetchFn = async () => {
      call++;
      if (call === 2) {
        return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => searchBody(["com.me.app"]),
      };
    };
    const out = await ranksFor(fetchFn, "com.me.app", ["a", "b", "c"], { pauseMs: 0 });
    expect(out).toHaveLength(3);
    expect(out[0]?.rank).toBe(1);
    expect(out[1]?.error).toContain("HTTP 404");
    expect(out[1]?.rank).toBeNull();
    expect(out[2]?.rank).toBe(1);
  });

  it("retries on 429 then succeeds", async () => {
    let call = 0;
    const fetchFn: FetchFn = async () => {
      call++;
      if (call === 1) {
        return { ok: false, status: 429, headers: { get: () => null }, text: async () => "" };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => searchBody(["com.me.app"]),
      };
    };
    const r = await rankFor(fetchFn, "com.me.app", "kw");
    expect(r.rank).toBe(1);
    expect(call).toBe(2); // one retry
  });
});
