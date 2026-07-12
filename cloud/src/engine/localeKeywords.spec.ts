import { describe, expect, it } from "vitest";
import { extractLocaleKeywords, readLocaleKeywords, type MarketListing } from "./localeKeywords.js";
import type { FetchFn } from "./itunes.js";

const L = (name: string, subtitle = ""): MarketListing => ({ name, subtitle });

describe("extractLocaleKeywords", () => {
  it("no usable listings → [] (never a fabricated candidate)", () => {
    expect(extractLocaleKeywords("jp", [])).toEqual([]);
    expect(extractLocaleKeywords("jp", [{ error: "timeout" }, L("", "")])).toEqual([]);
  });

  it("surfaces terms real market apps use, attributed to them, sorted by usage", () => {
    const out = extractLocaleKeywords("de", [
      L("Wetter Radar", "Regen Vorhersage"),
      L("Regen Alarm", "Wetter live"),
      L("Sturm Warnung", "Wetter Karte"),
    ]);
    // "wetter" appears in all three → top candidate
    expect(out[0]!.term).toBe("wetter");
    expect(out[0]!.usedByCount).toBe(3);
    expect(out[0]!.market).toBe("de");
    expect(out[0]!.usedBy).toEqual(["Regen Alarm", "Sturm Warnung", "Wetter Radar"]);
  });

  it("excludes your brand and your existing targets (not new signal)", () => {
    const out = extractLocaleKeywords(
      "de",
      [L("Wetter Radar", "Regen live"), L("Regen Alarm", "Wetter")],
      { brandTokens: ["Regen"], existingTerms: ["wetter"] },
    );
    const terms = out.map((c) => c.term);
    expect(terms).not.toContain("regen");
    expect(terms).not.toContain("wetter");
    expect(terms).toContain("radar");
  });

  it("excludes a competitor's OWN single-word brand", () => {
    // "Calm" is a pure brand word (single-token name) — not a transferable target
    const out = extractLocaleKeywords("us", [L("Calm", "meditation and sleep")]);
    expect(out.map((c) => c.term)).not.toContain("calm");
    expect(out.map((c) => c.term)).toEqual(expect.arrayContaining(["meditation", "sleep"]));
  });

  it("drops stopwords and one-char noise", () => {
    const out = extractLocaleKeywords("us", [L("The Best App", "for you")]);
    expect(out).toEqual([]); // every token is a stopword
  });

  it("lowercases the market + terms (attribution keeps the app's real name)", () => {
    // Same listings, market casing varies → identical output (market normalized).
    const a = extractLocaleKeywords("JP", [L("Sleep Tracker", "sleep sounds")]);
    const b = extractLocaleKeywords("jp", [L("Sleep Tracker", "sleep sounds")]);
    expect(a).toEqual(b);
    expect(a[0]!.market).toBe("jp");
    expect(a.every((c) => c.term === c.term.toLowerCase())).toBe(true);
    // the candidate for "sounds" is attributed to the real display name, verbatim
    expect(a.find((c) => c.term === "sounds")!.usedBy).toEqual(["Sleep Tracker"]);
  });

  it("handles space-less script segments without inventing tokenization", () => {
    // Japanese has no spaces; a two-app overlap on a segment still surfaces it.
    const out = extractLocaleKeywords("jp", [L("天気 レーダー"), L("天気 予報")]);
    const top = out.find((c) => c.term === "天気");
    expect(top?.usedByCount).toBe(2);
  });
});

/** A FetchFn that returns a canned iTunes search response keyed by the `term`. */
function searchFetch(byTerm: Record<string, Array<{ trackId?: number; trackName: string }>>): FetchFn {
  return async (url: string) => {
    const term = decodeURIComponent(new URL(url).searchParams.get("term") ?? "");
    const results = byTerm[term] ?? [];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ resultCount: results.length, results }),
    };
  };
}

describe("readLocaleKeywords", () => {
  it("searches each seed in the target storefront and extracts market-native terms", async () => {
    const fetchFn = searchFetch({
      weather: [
        { trackId: 1, trackName: "Wetter Radar" },
        { trackId: 2, trackName: "Regen Alarm" },
      ],
      radar: [{ trackId: 3, trackName: "Sturm Radar" }],
    });
    const out = await readLocaleKeywords(fetchFn, { market: "de", seeds: ["weather", "radar"], pauseMs: 0 });
    const radar = out.find((c) => c.term === "radar");
    expect(radar!.market).toBe("de");
    expect(radar!.usedByCount).toBe(2); // Wetter Radar + Sturm Radar
    expect(radar!.usedBy).toEqual(["Sturm Radar", "Wetter Radar"]);
  });

  it("hits the target country and passes seeds as the search term", async () => {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ results: [] }) };
    };
    await readLocaleKeywords(fetchFn, { market: "jp", seeds: ["sleep"], pauseMs: 0 });
    expect(calls[0]).toContain("country=jp");
    expect(calls[0]).toContain("term=sleep");
  });

  it("de-dupes an app that ranks for several seeds (counted once)", async () => {
    const fetchFn = searchFetch({
      a: [{ trackId: 7, trackName: "Sleep Tracker" }],
      b: [{ trackId: 7, trackName: "Sleep Tracker" }],
    });
    const out = await readLocaleKeywords(fetchFn, { market: "us", seeds: ["a", "b"], pauseMs: 0 });
    expect(out.find((c) => c.term === "tracker")!.usedByCount).toBe(1);
  });

  it("safe-degrades: a failed seed search is skipped, never throws", async () => {
    // A non-retryable 404 on one seed degrades instantly; the other seed still lands.
    const fetchFn: FetchFn = async (url) => {
      if (url.includes("term=boom")) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ results: [{ trackId: 1, trackName: "Calm Sleep" }] }),
      };
    };
    const out = await readLocaleKeywords(fetchFn, { market: "us", seeds: ["boom", "ok"], pauseMs: 0 });
    expect(out.map((c) => c.term)).toEqual(expect.arrayContaining(["calm", "sleep"]));
  });

  it("empty sweep → [] (no fabricated candidates)", async () => {
    const out = await readLocaleKeywords(searchFetch({}), { market: "fr", seeds: ["x"], pauseMs: 0 });
    expect(out).toEqual([]);
  });
});
