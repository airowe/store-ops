import { beforeEach, describe, expect, it } from "vitest";
import {
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
