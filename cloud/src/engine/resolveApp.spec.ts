import { describe, expect, it } from "vitest";
import { classifyQuery, resolveAppQuery, type FetchFn } from "./index.js";

/**
 * Build a FetchFn that returns a canned iTunes JSON payload for any URL, and
 * records the URLs it was called with so tests can assert which endpoint
 * (search vs lookup) and which params were used.
 */
function mockFetch(payload: unknown, calls: string[] = []): FetchFn {
  return async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
    };
  };
}

const clarity = {
  bundleId: "app.airowe.clarity",
  trackId: 1600000000,
  trackName: "Heathen - Secular Meditation",
  artistName: "airowe",
  genres: ["Health & Fitness"],
  artworkUrl100: "https://is1.example/clarity.png",
};

describe("classifyQuery", () => {
  it("recognizes an App Store URL and extracts the numeric track id", () => {
    const q = classifyQuery(
      "https://apps.apple.com/us/app/heathen-secular-meditation/id1600000000",
    );
    expect(q).toEqual({ kind: "appstore-id", id: "1600000000" });
  });

  it("recognizes a bare App Store id URL with query string", () => {
    const q = classifyQuery("https://apps.apple.com/app/id1600000000?mt=8");
    expect(q).toEqual({ kind: "appstore-id", id: "1600000000" });
  });

  it("recognizes a Google Play URL and extracts the package as a bundle id", () => {
    const q = classifyQuery(
      "https://play.google.com/store/apps/details?id=app.airowe.clarity&hl=en",
    );
    expect(q).toEqual({ kind: "bundle-id", id: "app.airowe.clarity" });
  });

  it("treats a standalone numeric string as an App Store track id", () => {
    expect(classifyQuery("1600000000")).toEqual({ kind: "appstore-id", id: "1600000000" });
  });

  it("treats a dotted, space-free token as a bundle id", () => {
    expect(classifyQuery("app.airowe.clarity")).toEqual({
      kind: "bundle-id",
      id: "app.airowe.clarity",
    });
  });

  it("treats free text (spaces / no dots) as a name search", () => {
    expect(classifyQuery("secular meditation")).toEqual({
      kind: "name",
      term: "secular meditation",
    });
    expect(classifyQuery("Calm")).toEqual({ kind: "name", term: "Calm" });
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(classifyQuery("  app.airowe.clarity  ")).toEqual({
      kind: "bundle-id",
      id: "app.airowe.clarity",
    });
  });
});

describe("resolveAppQuery", () => {
  it("resolves a bundle-id query to a single exact match without searching", async () => {
    const calls: string[] = [];
    const fetchFn = mockFetch({ resultCount: 1, results: [clarity] }, calls);

    const res = await resolveAppQuery(fetchFn, "app.airowe.clarity", { country: "US" });

    expect(res.kind).toBe("resolved");
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      bundleId: "app.airowe.clarity",
      name: "Heathen - Secular Meditation",
      publisher: "airowe",
    });
    // bundle-id path must hit /lookup, never /search
    expect(calls.every((u) => u.includes("/lookup"))).toBe(true);
  });

  it("resolves an App Store URL via lookup by track id", async () => {
    const calls: string[] = [];
    const fetchFn = mockFetch({ resultCount: 1, results: [clarity] }, calls);

    const res = await resolveAppQuery(
      fetchFn,
      "https://apps.apple.com/us/app/x/id1600000000",
      { country: "US" },
    );

    expect(res.kind).toBe("resolved");
    expect(res.candidates[0]?.bundleId).toBe("app.airowe.clarity");
    expect(calls[0]).toContain("/lookup");
    expect(calls[0]).toContain("id=1600000000");
  });

  it("returns multiple candidates for an ambiguous name search", async () => {
    const fetchFn = mockFetch({
      resultCount: 2,
      results: [
        clarity,
        {
          bundleId: "com.calm.calmapp",
          trackId: 571800810,
          trackName: "Calm",
          artistName: "Calm.com, Inc.",
          genres: ["Health & Fitness"],
        },
      ],
    });

    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US" });

    expect(res.kind).toBe("candidates");
    expect(res.candidates).toHaveLength(2);
    expect(res.candidates.map((c) => c.bundleId)).toEqual([
      "app.airowe.clarity",
      "com.calm.calmapp",
    ]);
  });

  it("collapses a single name-search hit to a resolved result", async () => {
    const fetchFn = mockFetch({ resultCount: 1, results: [clarity] });
    const res = await resolveAppQuery(fetchFn, "heathen secular meditation", { country: "US" });
    expect(res.kind).toBe("resolved");
    expect(res.candidates).toHaveLength(1);
  });

  it("returns a not-found result when nothing matches", async () => {
    const fetchFn = mockFetch({ resultCount: 0, results: [] });
    const res = await resolveAppQuery(fetchFn, "zzz no such app zzz", { country: "US" });
    expect(res.kind).toBe("not-found");
    expect(res.candidates).toHaveLength(0);
  });

  it("drops search results that carry no bundleId (un-connectable)", async () => {
    const fetchFn = mockFetch({
      resultCount: 2,
      results: [clarity, { trackId: 999, trackName: "No Bundle", genres: [] }],
    });
    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US" });
    expect(res.kind).toBe("resolved");
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.bundleId).toBe("app.airowe.clarity");
  });
});

/** N distinct connectable iTunes results, so we can exercise paging boundaries. */
function makeResults(n: number, start = 0): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    bundleId: `com.example.app${start + i}`,
    trackId: 1000 + start + i,
    trackName: `App ${start + i}`,
    artistName: "Example",
    genres: ["Utilities"],
  }));
}

describe("resolveAppQuery — pagination (Show more)", () => {
  it("caps a name search at PAGE_SIZE (12) candidates per page", async () => {
    // iTunes returns more than a page; the result must be trimmed to PAGE_SIZE.
    const fetchFn = mockFetch({ resultCount: 20, results: makeResults(20) });
    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US" });
    expect(res.kind).toBe("candidates");
    expect(res.candidates).toHaveLength(12);
  });

  it("reports hasMore:true when a full extra row beyond the page exists", async () => {
    // 13 results back (PAGE_SIZE 12 + the lookahead row) → there's a next page.
    const fetchFn = mockFetch({ resultCount: 13, results: makeResults(13) });
    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US" });
    expect(res.candidates).toHaveLength(12);
    expect(res.hasMore).toBe(true);
  });

  it("reports hasMore:false on the last (partial) page", async () => {
    const fetchFn = mockFetch({ resultCount: 5, results: makeResults(5) });
    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US" });
    expect(res.candidates).toHaveLength(5);
    expect(res.hasMore).toBe(false);
  });

  it("requests the page with a limit one larger than PAGE_SIZE (lookahead) and the given offset", async () => {
    const calls: string[] = [];
    const fetchFn = mockFetch({ resultCount: 13, results: makeResults(13, 12) }, calls);
    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US", offset: 12 });
    const url = calls[0]!;
    expect(url).toContain("limit=13"); // 12 + 1 lookahead
    expect(url).toContain("offset=12");
    expect(res.offset).toBe(12);
  });

  it("defaults offset to 0 when omitted (no offset param in the URL)", async () => {
    const calls: string[] = [];
    const fetchFn = mockFetch({ resultCount: 3, results: makeResults(3) }, calls);
    const res = await resolveAppQuery(fetchFn, "meditation", { country: "US" });
    expect(res.offset).toBe(0);
    expect(calls[0]).not.toContain("offset=");
  });

  it("does not paginate id/bundle lookups (they resolve to a single match)", async () => {
    const calls: string[] = [];
    const fetchFn = mockFetch({ resultCount: 1, results: [clarity] }, calls);
    const res = await resolveAppQuery(fetchFn, "app.airowe.clarity", { country: "US", offset: 50 });
    expect(res.kind).toBe("resolved");
    expect(res.hasMore).toBe(false);
    // a lookup never carries a search offset
    expect(calls[0]).not.toContain("offset=");
  });
});
