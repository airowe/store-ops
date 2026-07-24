import { describe, it, expect } from "vitest";
import type { AppListItem, DeltaEntry, RankPoint } from "@shipaso/api";
import { movers, series } from "./fleetModel.js";

const app = (id: string, name: string): AppListItem => ({
  id, name, bundle_id: `com.${id}`, latest_run: null, rank_summary: null, findings_summary: null,
});
const d = (keyword: string, delta: number | null): DeltaEntry => ({
  keyword, previous: null, current: null, delta, direction: delta == null ? "unmeasured" : delta > 0 ? "up" : "down",
});
const pt = (rank: number | null): RankPoint => ({ rank, total: 200, checked_at: "2026-07-01T00:00:00Z" });

describe("fleetModel", () => {
  describe("movers", () => {
    it("ranks by absolute movement, biggest first, across apps", () => {
      const m = movers([
        { app: app("a", "Cal AI"), entries: [d("calorie counter", 37), d("food scanner", 8)] },
        { app: app("b", "Lyfta"), entries: [d("gym log", -4)] },
      ]);
      expect(m.map((x) => x.keyword)).toEqual(["calorie counter", "food scanner", "gym log"]);
      expect(m[0]).toMatchObject({ app: "Cal AI", delta: 37, magnitude: 1 });
    });

    it("excludes unmeasured and zero deltas — never a fabricated mover", () => {
      const m = movers([{ app: app("a", "A"), entries: [d("x", null), d("y", 0), d("z", 5)] }]);
      expect(m.map((x) => x.keyword)).toEqual(["z"]);
    });

    it("caps the list at the limit", () => {
      const entries = Array.from({ length: 10 }, (_, i) => d("k" + i, i + 1));
      expect(movers([{ app: app("a", "A"), entries }], 3)).toHaveLength(3);
    });

    it("magnitude is relative to the biggest move in the set", () => {
      const m = movers([{ app: app("a", "A"), entries: [d("big", 40), d("small", 10)] }]);
      expect(m[0]!.magnitude).toBe(1);
      expect(m[1]!.magnitude).toBeCloseTo(0.25);
    });
  });

  describe("series", () => {
    it("makes one labeled series per app that has points", () => {
      const s = series([
        { app: app("a", "Cal AI"), points: [pt(20), pt(4)] },
        { app: app("b", "Empty"), points: [] },
      ]);
      expect(s).toHaveLength(1);
      expect(s[0]).toEqual({ label: "Cal AI", points: [20, 4] });
    });

    it("preserves null ranks as gaps in the series (not dropped, not faked)", () => {
      const s = series([{ app: app("a", "A"), points: [pt(10), pt(null), pt(6)] }]);
      expect(s[0]!.points).toEqual([10, null, 6]);
    });
  });
});
