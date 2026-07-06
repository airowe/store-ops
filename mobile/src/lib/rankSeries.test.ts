/**
 * Pins toRankSeries/toGraphPoints to the SAME honesty rules as the shared spine
 * (`packages/honesty/rankSeries.mjs`). If the shared transform changes, mirror it
 * here (until Metro wires the sibling package and this local copy is deleted).
 */
import { toGraphPoints, toRankSeries } from "./rankSeries.js";

const p = (rank: number | null, day: number) => ({ rank, checked_at: `2026-07-0${day}T00:00:00Z` });

describe("toRankSeries (mirrors @shipaso/honesty)", () => {
  it("is empty for <2 points", () => {
    expect(toRankSeries([]).empty).toBe(true);
    expect(toRankSeries([p(3, 1)]).empty).toBe(true);
  });
  it("preserves nulls and pads the y-range clamped to >= 1", () => {
    const s = toRankSeries([p(2, 1), p(null, 2), p(40, 3)]);
    expect(s.rank).toEqual([2, null, 40]);
    expect(s.loRank).toBe(1); // 2 - 3 clamped
    expect(s.hiRank).toBe(43); // 40 + 3
  });
});

describe("toGraphPoints (native chart mapping)", () => {
  it("inverts rank so #1 is highest (value = -rank)", () => {
    const { points } = toGraphPoints([p(50, 1), p(1, 2)]);
    expect(points.map((x) => x.value)).toEqual([-50, -1]);
    expect(points[1]!.value).toBeGreaterThan(points[0]!.value); // rank 1 higher
  });
  it("DROPS unmeasured points and counts the gaps (no fabricated values)", () => {
    const { points, gaps } = toGraphPoints([p(20, 1), p(null, 2), p(8, 3)]);
    expect(points.map((x) => x.value)).toEqual([-20, -8]);
    expect(gaps).toBe(1);
  });
  it("is empty when fewer than two measured points remain", () => {
    expect(toGraphPoints([p(5, 1), p(null, 2)]).empty).toBe(true);
  });
  it("maps checked_at to a Date on x", () => {
    const { points } = toGraphPoints([p(3, 1), p(2, 2)]);
    expect(points[0]!.date instanceof Date).toBe(true);
    expect(points[1]!.date.getTime()).toBeGreaterThan(points[0]!.date.getTime());
  });
});
