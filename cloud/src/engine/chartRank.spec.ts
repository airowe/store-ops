import { beforeEach, describe, expect, it } from "vitest";
import {
  categoryRankFrom,
  chartRankFromEntries,
  fetchChartRank,
  parseChartFeed,
  type ChartRank,
} from "./chartRank.js";
import { __setSleep, type FetchFn } from "./itunes.js";

/**
 * Chart rank (public, keyless): the app's position in a category chart from the
 * legacy iTunes RSS top-charts feed. Present → measured position; absent →
 * honestly "not in the top N", never a fabricated number.
 */

beforeEach(() => __setSleep(async () => {}));

/** Legacy RSS feed shape: feed.entry[].id.attributes["im:id"] is the app id. */
function feed(ids: string[]): string {
  return JSON.stringify({
    feed: {
      title: { label: "Top Free Apps" },
      entry: ids.map((id, i) => ({
        id: { attributes: { "im:id": id } },
        "im:name": { label: `App ${i + 1}` },
      })),
    },
  });
}

describe("parseChartFeed (pure)", () => {
  it("returns the ordered app ids from a legacy RSS feed", () => {
    expect(parseChartFeed(feed(["100", "200", "300"]))).toEqual(["100", "200", "300"]);
  });

  it("tolerates a single-entry feed (Apple returns an object, not an array)", () => {
    const single = JSON.stringify({
      feed: { entry: { id: { attributes: { "im:id": "42" } } } },
    });
    expect(parseChartFeed(single)).toEqual(["42"]);
  });

  it("returns [] for an empty or malformed feed rather than throwing", () => {
    expect(parseChartFeed(JSON.stringify({ feed: {} }))).toEqual([]);
    expect(parseChartFeed("not json")).toEqual([]);
    expect(parseChartFeed(JSON.stringify({ feed: { entry: [] } }))).toEqual([]);
  });
});

describe("chartRankFromEntries (pure)", () => {
  const chart = "top-free" as const;
  const meta = { genreId: "6012", genreName: "Lifestyle", chart, country: "us", limit: 3 };

  it("returns the 1-based position when the app is in the list", () => {
    expect(chartRankFromEntries(["100", "200", "300"], "200", meta)).toEqual<ChartRank>({
      ranked: true,
      position: 2,
      outOf: 3,
      genreId: "6012",
      genreName: "Lifestyle",
      chart,
      country: "us",
    });
  });

  it("returns ranked:false (never a number) when the app is absent from the top N", () => {
    expect(chartRankFromEntries(["100", "200", "300"], "999", meta)).toEqual<ChartRank>({
      ranked: false,
      outOf: 3,
      genreId: "6012",
      genreName: "Lifestyle",
      chart,
      country: "us",
    });
  });

  it("reports position 1 for the chart-topper", () => {
    const r = chartRankFromEntries(["100", "200"], "100", meta);
    expect(r.ranked && r.position).toBe(1);
  });
});

describe("fetchChartRank", () => {
  const okFeed =
    (ids: string[]): FetchFn =>
    (async () => new Response(feed(ids), { status: 200 })) as unknown as FetchFn;

  const opts = { appId: "200", genreId: "6012", genreName: "Lifestyle", country: "us", limit: 50 };

  it("fetches the genre chart and locates the app", async () => {
    const r = await fetchChartRank(okFeed(["100", "200", "300"]), opts);
    expect(r?.ranked && r.position).toBe(2);
    expect(r?.genreName).toBe("Lifestyle");
  });

  it("returns a ranked:false result when the app isn't charting (still a real read)", async () => {
    const r = await fetchChartRank(okFeed(["1", "2", "3"]), opts);
    expect(r).toMatchObject({ ranked: false, outOf: 3 });
  });

  it("returns null (UNKNOWN) when the feed can't be read — never a false 'not charting'", async () => {
    const bad: FetchFn = (async () => new Response("", { status: 500 })) as unknown as FetchFn;
    expect(await fetchChartRank(bad, opts)).toBeNull();
    const boom: FetchFn = (async () => {
      throw new Error("net down");
    }) as unknown as FetchFn;
    expect(await fetchChartRank(boom, opts)).toBeNull();
  });

  it("returns null when no genreId is known (can't pick a chart honestly)", async () => {
    const { genreId: _omit, ...noGenre } = opts;
    const r = await fetchChartRank(okFeed(["200"]), noGenre);
    expect(r).toBeNull();
  });
});

/**
 * #326 — the status bar's category-rank cell. `categoryRankFrom` narrows a
 * ChartRank into the audit-shaped `{ rank, category }` the bar renders. The
 * three states stay distinct: measured-and-charting is a number; measured-and-
 * NOT-charting is `rank:null` (we read the chart, the app wasn't in it); an
 * unread chart is undefined (unknown) and never reaches the bar as a number.
 */
describe("categoryRankFrom — #326 audit shaping", () => {
  it("carries the measured position and the genre name", () => {
    const r = categoryRankFrom({
      genreId: "6013",
      genreName: "Health & Fitness",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: true,
      position: 42,
    });
    expect(r).toEqual({ rank: 42, category: "Health & Fitness" });
  });

  it("reports rank:null when the chart was read and the app is NOT charting", () => {
    const r = categoryRankFrom({
      genreId: "6013",
      genreName: "Health & Fitness",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: false,
    });
    expect(r).toEqual({ rank: null, category: "Health & Fitness" });
  });

  it("resolves a known genre id to its display name when the feed carried no name", () => {
    const r = categoryRankFrom({
      genreId: "6013",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: true,
      position: 7,
    });
    expect(r).toEqual({ rank: 7, category: "Health & Fitness" });
  });

  it("resolves a Games sub-genre id through the map", () => {
    const r = categoryRankFrom({
      genreId: "7014",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: true,
      position: 3,
    });
    expect(r).toEqual({ rank: 3, category: "Roleplaying" });
  });

  it("prefers the feed's own genreName over the map", () => {
    const r = categoryRankFrom({
      genreId: "6013",
      genreName: "Fitness & Wellbeing",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: true,
      position: 7,
    });
    expect(r).toEqual({ rank: 7, category: "Fitness & Wellbeing" });
  });

  /**
   * The raw id is NOT a category name. Rendering "#42 in 6013" reads as a bug
   * and asserts a label we never measured, so an unresolvable id yields a
   * CategoryRank with NO category clause — the bar renders a bare "#42".
   */
  it("omits category entirely when the genre id is not in the map", () => {
    const r = categoryRankFrom({
      genreId: "999999",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: true,
      position: 42,
    });
    expect(r).toEqual({ rank: 42 });
    expect(r).not.toHaveProperty("category");
  });

  it("never surfaces a raw numeric id as the category", () => {
    const r = categoryRankFrom({
      genreId: "6013",
      chart: "top-free",
      country: "us",
      outOf: 100,
      ranked: false,
    });
    expect(r?.category).not.toMatch(/^\d+$/);
  });

  it("is undefined (UNKNOWN) when the chart was never read", () => {
    expect(categoryRankFrom(null)).toBeUndefined();
    expect(categoryRankFrom(undefined)).toBeUndefined();
  });
});
