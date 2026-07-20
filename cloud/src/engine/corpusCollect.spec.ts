/**
 * Category corpus collection (#63) — the pure mapper + the fetch orchestrator.
 *
 * Invariants pinned here:
 *   • rank is the 1-based position in the seed's search results, capped at topN,
 *   • a result with no bundleId is DROPPED (never a corpus row without identity),
 *   • the category tag (primaryGenreId/Name) + visible metadata are carried;
 *     missing rating/version coerce to null/"" (never a fabricated value),
 *   • a single seed's failure is isolated — one bad seed never aborts the run.
 */
import { describe, expect, it } from "vitest";
import type { FetchFn, ItunesResult } from "./itunes.js";
import { observationsFromResults, collectCorpus, type CorpusObservation } from "./corpusCollect.js";

function result(p: Partial<ItunesResult> = {}): ItunesResult {
  const base: ItunesResult = {
    bundleId: "com.example.weather",
    trackId: 111,
    trackName: "Weatherly",
    version: "2.1.0",
    description: "Honest forecasts.",
    averageUserRating: 4.6,
    userRatingCount: 1200,
    primaryGenreId: "6001",
    primaryGenreName: "Weather",
  };
  return { ...base, ...p };
}

/** Drop keys from a result to simulate iTunes omitting them (exactOptionalProps). */
function without(base: ItunesResult, ...keys: (keyof ItunesResult)[]): ItunesResult {
  const copy = { ...base };
  for (const k of keys) delete copy[k];
  return copy;
}

/** A FetchFn that returns a canned iTunes response body for known terms, and a
 *  non-retryable 404 for any other term (so fetchJson throws immediately — no
 *  real backoff sleeps — exercising the per-seed isolation path realistically). */
function fakeFetch(byTerm: Record<string, ItunesResult[]>): FetchFn {
  return (async (url: string) => {
    const term = decodeURIComponent(new URL(url).searchParams.get("term") ?? "");
    if (byTerm[term] === undefined) {
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
    }
    const body = JSON.stringify({ resultCount: byTerm[term].length, results: byTerm[term] });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
  }) as unknown as FetchFn;
}

describe("observationsFromResults", () => {
  it("assigns 1-based rank in result order and caps at topN", () => {
    const results = [result({ bundleId: "a" }), result({ bundleId: "b" }), result({ bundleId: "c" })];
    const obs = observationsFromResults("weather", "us", results, { topN: 2 });
    expect(obs.map((o: CorpusObservation) => [o.bundleId, o.rank])).toEqual([
      ["a", 1],
      ["b", 2],
    ]); // "c" dropped by the cap
  });

  it("drops a result with no bundleId (no corpus row without identity)", () => {
    const results = [without(result(), "bundleId"), result({ bundleId: "b" })];
    const obs = observationsFromResults("weather", "us", results, { topN: 10 });
    expect(obs.map((o: CorpusObservation) => o.bundleId)).toEqual(["b"]);
    expect(obs[0]!.rank).toBe(2); // rank reflects the ORIGINAL search position, not post-filter
  });

  it("carries the category tag and visible metadata", () => {
    const obs = observationsFromResults("weather", "us", [result()], { topN: 10 })[0]!;
    expect(obs.categoryId).toBe("6001");
    expect(obs.categoryName).toBe("Weather");
    expect(obs.rating).toBe(4.6);
    expect(obs.ratingCount).toBe(1200);
    expect(obs.version).toBe("2.1.0");
    expect(obs.description).toBe("Honest forecasts.");
    expect(obs.seedKeyword).toBe("weather");
    expect(obs.country).toBe("us");
  });

  it("coerces missing rating/version to null/\"\" (never a fabricated value)", () => {
    const obs = observationsFromResults(
      "weather",
      "us",
      [without(result(), "averageUserRating", "userRatingCount", "version", "description")],
      { topN: 10 },
    )[0]!;
    expect(obs.rating).toBeNull();
    expect(obs.ratingCount).toBeNull();
    expect(obs.version).toBe("");
    expect(obs.description).toBe("");
  });

  it("empty results → []", () => {
    expect(observationsFromResults("weather", "us", [], { topN: 10 })).toEqual([]);
  });
});

describe("collectCorpus", () => {
  it("aggregates observations across multiple seeds", async () => {
    const fetchFn = fakeFetch({
      weather: [result({ bundleId: "w1" }), result({ bundleId: "w2" })],
      meditation: [result({ bundleId: "m1" })],
    });
    const obs = await collectCorpus(fetchFn, ["weather", "meditation"], { topN: 10, pauseMs: 0 });
    expect(obs.map((o: CorpusObservation) => o.bundleId).sort()).toEqual(["m1", "w1", "w2"]);
    expect(obs.filter((o: CorpusObservation) => o.seedKeyword === "weather")).toHaveLength(2);
  });

  it("isolates a per-seed failure — one bad seed never aborts the run", async () => {
    const fetchFn = fakeFetch({ weather: [result({ bundleId: "w1" })] }); // "broken" term throws
    const obs = await collectCorpus(fetchFn, ["weather", "broken"], { topN: 10, pauseMs: 0 });
    expect(obs.map((o: CorpusObservation) => o.bundleId)).toEqual(["w1"]); // the good seed still collected
  });

  it("caps each seed at topN", async () => {
    const fetchFn = fakeFetch({ weather: [result({ bundleId: "a" }), result({ bundleId: "b" }), result({ bundleId: "c" })] });
    const obs = await collectCorpus(fetchFn, ["weather"], { topN: 2, pauseMs: 0 });
    expect(obs).toHaveLength(2);
  });
});
