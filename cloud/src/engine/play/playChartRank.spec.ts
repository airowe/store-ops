/**
 * Play chart rank — pure engine. Honesty invariants (mirror chartRank.ts):
 *   • in the chart → measured 1-based position (never fabricated),
 *   • read the chart but app absent → ranked:false (a real "not charting" fact),
 *   • unreadable/empty chart → null (UNKNOWN, distinct from "not charting"),
 *   • degrade-safe: a throwing source resolves to null, never throws.
 */
import { describe, expect, it } from "vitest";
import {
  fetchPlayChartRank,
  playChartRankFinding,
  playChartRankFromEntries,
  type PlayChartSource,
} from "./playChartRank.js";

const META = { collection: "TOP_FREE" as const, category: "WEATHER", country: "us" };

describe("playChartRankFromEntries", () => {
  it("returns the 1-based position when the app is in the chart", () => {
    const r = playChartRankFromEntries(["com.a", "com.me", "com.b"], "com.me", META);
    expect(r).toMatchObject({ ranked: true, position: 2, outOf: 3, category: "WEATHER" });
  });
  it("returns ranked:false (a real fact) when the app is not in the read chart", () => {
    const r = playChartRankFromEntries(["com.a", "com.b"], "com.me", META);
    expect(r.ranked).toBe(false);
    expect(r.outOf).toBe(2);
  });
});

describe("fetchPlayChartRank — degrade-safe", () => {
  const src = (ids: string[]): PlayChartSource => async () => ids;

  it("locates the app via the injected source", async () => {
    const r = await fetchPlayChartRank(src(["com.x", "com.me"]), { packageName: "com.me", category: "WEATHER" });
    expect(r).toMatchObject({ ranked: true, position: 2 });
  });
  it("empty chart → null (UNKNOWN), not a false 'not charting'", async () => {
    expect(await fetchPlayChartRank(src([]), { packageName: "com.me", category: "WEATHER" })).toBeNull();
  });
  it("a throwing source → null (never throws)", async () => {
    const boom: PlayChartSource = async () => {
      throw new Error("429");
    };
    expect(await fetchPlayChartRank(boom, { packageName: "com.me", category: "WEATHER" })).toBeNull();
  });
  it("no category → null (can't pick a chart honestly)", async () => {
    expect(await fetchPlayChartRank(src(["com.me"]), { packageName: "com.me", category: "" })).toBeNull();
  });
});

describe("playChartRankFinding", () => {
  it("a measured position → a context finding naming the #N + category", () => {
    const r = playChartRankFromEntries(["com.a", "com.me"], "com.me", { ...META, categoryName: "Weather" });
    const f = playChartRankFinding(r)[0]!;
    expect(f.id).toBe("play_chart_rank");
    expect(f.context).toBe(true);
    expect(f.title).toContain("#2 in Weather (Top Free, US)");
    expect(f.severity).toBe("good");
  });
  it("not charting → an honest 'not in the top N' context fact", () => {
    const r = playChartRankFromEntries(["com.a"], "com.me", META);
    const f = playChartRankFinding(r)[0]!;
    expect(f.id).toBe("play_chart_not_charting");
    expect(f.context).toBe(true);
  });
  it("UNKNOWN (null) → nothing", () => {
    expect(playChartRankFinding(null)).toEqual([]);
  });
});
