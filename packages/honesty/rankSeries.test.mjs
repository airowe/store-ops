import { test } from "node:test";
import assert from "node:assert/strict";
import { toRankSeries } from "./rankSeries.mjs";

test("toRankSeries: <2 points is empty (no trend)", () => {
  assert.equal(toRankSeries([]).empty, true);
  assert.equal(toRankSeries([{ rank: 3, checked_at: "2026-07-01T00:00:00Z" }]).empty, true);
});

test("toRankSeries: preserves nulls as gaps (never a fabricated value)", () => {
  const s = toRankSeries([
    { rank: 10, checked_at: "2026-07-01T00:00:00Z" },
    { rank: null, checked_at: "2026-07-02T00:00:00Z" },
    { rank: 4, checked_at: "2026-07-03T00:00:00Z" },
  ]);
  assert.equal(s.empty, false);
  assert.deepEqual(s.rank, [10, null, 4]);
  assert.equal(s.t.length, 3);
});

test("toRankSeries: y-range pads the measured min/max, clamped to >= 1", () => {
  const s = toRankSeries([
    { rank: 2, checked_at: "2026-07-01T00:00:00Z" },
    { rank: 40, checked_at: "2026-07-02T00:00:00Z" },
  ]);
  assert.equal(s.loRank, 1); // 2 - 3 clamped to 1
  assert.equal(s.hiRank, 43); // 40 + 3
});

test("toRankSeries: timestamps are epoch seconds, in order", () => {
  const s = toRankSeries([
    { rank: 1, checked_at: "2026-07-01T00:00:00Z" },
    { rank: 1, checked_at: "2026-07-02T00:00:00Z" },
  ]);
  assert.ok(s.t[1] > s.t[0]);
  assert.equal(s.t[0], Math.floor(Date.parse("2026-07-01T00:00:00Z") / 1000));
});
