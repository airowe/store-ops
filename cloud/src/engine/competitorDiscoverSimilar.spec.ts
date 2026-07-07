import { beforeEach, describe, expect, it } from "vitest";
import {
  asSearchCompetitor,
  filterSimilarApps,
  resolveBundleToId,
  resolveSimilarCompetitors,
} from "./competitorDiscover.js";
import type { StorefrontApp } from "./storefrontListing.js";
import { __setSleep, type FetchFn } from "./itunes.js";

// Instant retries — a persistently failing lookup still resolves to null, just
// without the real backoff waits (matches rankCheck/reviewSentiment specs).
beforeEach(() => __setSleep(async () => {}));

/**
 * Storefront-intel PRD 02 — Apple's "similar" shelf as a second discovery
 * source. Association signal only: matchedKeywords stays [], rating/subtitle
 * carry only when the shelf provided them (never 0/empty backfill).
 */

const app = (bundleId: string, name: string, extra: Partial<StorefrontApp> = {}): StorefrontApp => ({
  bundleId,
  name,
  ...extra,
});

/** iTunes lookup stub: bundleId → trackId (empty result simulates a miss). */
function lookupFetch(byBundle: Record<string, number>): FetchFn {
  return (async (url: string) => {
    const m = /bundleId=([^&]+)/.exec(url);
    const bundle = m?.[1] ? decodeURIComponent(m[1]) : "";
    const tid = byBundle[bundle];
    const results = tid ? [{ trackId: tid, trackName: bundle, bundleId: bundle }] : [];
    return new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 });
  }) as unknown as FetchFn;
}

describe("filterSimilarApps (pure)", () => {
  it("drops the app itself by bundleId and by folded name, dedupes, and caps", () => {
    const out = filterSimilarApps(
      [
        app("self.app", "My App"),
        app("rival.a", "Rival A"),
        app("rival.a", "Rival A (dupe)"), // same bundle → deduped
        app("noise.app", "  my app  "), // folded-name self-match → dropped
        app("rival.b", "Rival B"),
        app("rival.c", "Rival C"),
      ],
      { selfBundleId: "self.app", selfName: "My App", limit: 2 },
    );
    expect(out.map((a) => a.bundleId)).toEqual(["rival.a", "rival.b"]);
  });

  it("preserves Apple's shelf order", () => {
    const out = filterSimilarApps([app("c", "C"), app("a", "A"), app("b", "B")]);
    expect(out.map((a) => a.bundleId)).toEqual(["c", "a", "b"]);
  });
});

describe("resolveBundleToId", () => {
  it("returns the top result's trackId as a string", async () => {
    expect(await resolveBundleToId(lookupFetch({ "x.app": 42 }), "x.app")).toBe("42");
  });
  it("returns null on a miss and never throws on a failing fetch", async () => {
    expect(await resolveBundleToId(lookupFetch({}), "x.app")).toBeNull();
    const boom: FetchFn = (async () => {
      throw new Error("net down");
    }) as unknown as FetchFn;
    expect(await resolveBundleToId(boom, "x.app")).toBeNull();
  });
});

describe("resolveSimilarCompetitors", () => {
  const shelf = [
    app("rival.a", "Rival A", { subtitle: "Track your streaks", rating: 4.5, ratingCount: 120 }),
    app("rival.b", "Rival B"), // no subtitle/rating on the shelf
    app("gone.app", "Gone App"), // won't resolve → skipped
  ];
  const fetch = lookupFetch({ "rival.a": 111, "rival.b": 222 });

  it("resolves via bundleId, tags source apple_similar, keeps matchedKeywords empty", async () => {
    const out = await resolveSimilarCompetitors(fetch, shelf);
    expect(out).toEqual([
      {
        key: "111",
        name: "Rival A",
        source: "apple_similar",
        matchedKeywords: [],
        subtitle: "Track your streaks",
        rating: 4.5,
        ratingCount: 120,
      },
      { key: "222", name: "Rival B", source: "apple_similar", matchedKeywords: [] },
    ]);
  });

  it("skips unresolvable candidates rather than emitting a half-row", async () => {
    const keys = (await resolveSimilarCompetitors(fetch, shelf)).map((c) => c.key);
    expect(keys).not.toContain("gone.app");
    expect(keys).toEqual(["111", "222"]);
  });

  it("omits rating/subtitle entirely when the shelf didn't carry them (never 0/empty)", async () => {
    const out = await resolveSimilarCompetitors(fetch, shelf);
    const b = out[1]!;
    expect("rating" in b).toBe(false);
    expect("subtitle" in b).toBe(false);
    expect("ratingCount" in b).toBe(false);
  });

  it("dedupes when two bundles resolve to the same trackId", async () => {
    const dupFetch = lookupFetch({ "rival.a": 111, "rival.b": 111 });
    const out = await resolveSimilarCompetitors(dupFetch, [app("rival.a", "A"), app("rival.b", "B")]);
    expect(out.map((c) => c.key)).toEqual(["111"]);
  });

  it("never throws when a lookup fails mid-batch (that candidate is skipped)", async () => {
    const flaky: FetchFn = (async (url: string) => {
      if (url.includes("rival.a")) throw new Error("boom");
      return new Response(
        JSON.stringify({ resultCount: 1, results: [{ trackId: 222, trackName: "B", bundleId: "rival.b" }] }),
        { status: 200 },
      );
    }) as unknown as FetchFn;
    const out = await resolveSimilarCompetitors(flaky, [app("rival.a", "A"), app("rival.b", "B")]);
    expect(out.map((c) => c.key)).toEqual(["222"]);
  });
});

describe("asSearchCompetitor", () => {
  it("adapts a search-derived row into the unified shape with source 'search'", () => {
    expect(asSearchCompetitor({ key: "9", name: "N", matchedKeywords: ["a", "b"] })).toEqual({
      key: "9",
      name: "N",
      source: "search",
      matchedKeywords: ["a", "b"],
    });
  });
});
