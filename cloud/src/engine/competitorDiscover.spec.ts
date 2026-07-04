import { describe, expect, it } from "vitest";
import { discoverCompetitors } from "./competitorWatch.js";
import type { FetchFn } from "./itunes.js";

/**
 * Competitor auto-discovery (#72-C) — candidates come from REAL iTunes search
 * results for the app's tracked keywords, ranked by how many keywords each app
 * surfaced for. Suggestions only; confirmation is the caller's (human's) job.
 */

type Hit = { trackId: number; trackName: string; bundleId?: string };

/** A fetch stub serving per-term iTunes search results. Unknown terms 404
 *  (a non-retryable failure, so the never-throws path is exercised without
 *  waiting out fetchJson's real retry backoff). */
function searchFetch(byTerm: Record<string, Hit[]>): FetchFn {
  return async (url: string | URL) => {
    const u = new URL(String(url));
    const term = u.searchParams.get("term") ?? "";
    const results = byTerm[term];
    if (!results) return new Response("boom", { status: 404 });
    return new Response(JSON.stringify({ resultCount: results.length, results }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const A = { trackId: 111, trackName: "Meal Maestro", bundleId: "com.rival.a" };
const B = { trackId: 222, trackName: "PantryPal", bundleId: "com.rival.b" };
const C = { trackId: 333, trackName: "Grocery Guru", bundleId: "com.rival.c" };
const SELF = { trackId: 999, trackName: "Mangia", bundleId: "com.self.mangia" };

describe("discoverCompetitors (#72-C)", () => {
  it("ranks candidates by how many tracked keywords they surface for", async () => {
    const fetchFn = searchFetch({
      "meal planner": [A, B, SELF],
      "grocery list": [C, A],
    });
    const found = await discoverCompetitors(fetchFn, {
      keywords: ["meal planner", "grocery list"],
      selfBundleId: "com.self.mangia",
    });
    // A matched both terms → first; B and C one each (B pos 1 vs C pos 0 → C first).
    expect(found.map((f) => f.name)).toEqual(["Meal Maestro", "Grocery Guru", "PantryPal"]);
    expect(found[0]).toEqual({
      key: "111",
      name: "Meal Maestro",
      matchedKeywords: ["meal planner", "grocery list"],
    });
  });

  it("never suggests the app to itself (bundle id or name match)", async () => {
    const fetchFn = searchFetch({ kw: [SELF, { trackId: 998, trackName: "mangia " }, A] });
    const found = await discoverCompetitors(fetchFn, {
      keywords: ["kw"],
      selfBundleId: "com.self.mangia",
      selfName: "Mangia",
    });
    expect(found.map((f) => f.key)).toEqual(["111"]);
  });

  it("zero tracked keywords → [] (no invented seeds)", async () => {
    const found = await discoverCompetitors(searchFetch({}), { keywords: [] });
    expect(found).toEqual([]);
  });

  it("a failed keyword search contributes nothing; the rest still discover", async () => {
    const fetchFn = searchFetch({ good: [A] }); // "bad" term → 500
    const found = await discoverCompetitors(fetchFn, { keywords: ["bad", "good"] });
    expect(found.map((f) => f.key)).toEqual(["111"]);
  });

  it("caps at the limit, keeping the strongest candidates", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      trackId: 1000 + i,
      trackName: `App ${String.fromCharCode(65 + i)}`,
    }));
    const found = await discoverCompetitors(searchFetch({ kw: many }), {
      keywords: ["kw"],
      limit: 8,
    });
    expect(found).toHaveLength(8);
    // position is the tiebreak within a single keyword → first results kept
    expect(found[0]!.name).toBe("App A");
  });

  it("results without a trackId or name are skipped (never a half-row)", async () => {
    const fetchFn = searchFetch({
      kw: [{ trackId: 0, trackName: "NoId" } as Hit, { trackId: 5, trackName: "" } as Hit, A],
    });
    const found = await discoverCompetitors(fetchFn, { keywords: ["kw"] });
    expect(found.map((f) => f.key)).toEqual(["111"]);
  });
});
