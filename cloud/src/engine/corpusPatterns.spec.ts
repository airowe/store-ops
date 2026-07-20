/**
 * Corpus pattern-mining (#64) — correlational-only mining of (visible change →
 * rank move) sequences from the #63 corpus.
 *
 * Invariants pinned here (the honesty rules, made testable):
 *   • correlational, NEVER causal — phrasing is "tended to", never "do X",
 *   • sample size shown; a change under MIN_SUPPORT is insufficient, not a claim,
 *   • VISIBLE changes only — blindSpots (subtitle, keyword field) always stated,
 *   • null ranks handled explicitly: null→N = entered, N→null = left, never a
 *     fabricated absolute rank,
 *   • empty/thin input → no fabricated pattern.
 */
import { describe, expect, it } from "vitest";
import {
  buildTransitions,
  mineHypotheses,
  phraseHypothesis,
  MIN_SUPPORT,
  type CorpusPoint,
} from "./corpusPatterns.js";

function pt(p: Partial<CorpusPoint> = {}): CorpusPoint {
  return {
    seedKeyword: "weather",
    country: "us",
    bundleId: "com.a",
    name: "Weatherly",
    rank: 5,
    version: "1.0.0",
    rating: 4.0,
    description: "Forecasts.",
    checkedAt: "2026-07-01 08:00:00",
    ...p,
  };
}

describe("buildTransitions", () => {
  it("pairs consecutive snapshots per (seed, bundle) and signs the rank move (climb = positive)", () => {
    const ts = buildTransitions([
      pt({ rank: 8, checkedAt: "2026-07-01 08:00:00" }),
      pt({ rank: 3, checkedAt: "2026-07-02 08:00:00" }),
    ]);
    expect(ts).toHaveLength(1);
    expect(ts[0]!.rankMove).toBe(5); // 8 → 3 = climbed 5
    expect(ts[0]!.event).toBe("climbed");
  });

  it("classifies null→N as 'entered' and N→null as 'left' (no fabricated rank)", () => {
    const entered = buildTransitions([pt({ rank: null, checkedAt: "2026-07-01 08:00:00" }), pt({ rank: 4, checkedAt: "2026-07-02 08:00:00" })]);
    expect(entered[0]!.event).toBe("entered");
    expect(entered[0]!.rankMove).toBeNull();
    const left = buildTransitions([pt({ rank: 4, checkedAt: "2026-07-01 08:00:00" }), pt({ rank: null, checkedAt: "2026-07-02 08:00:00" })]);
    expect(left[0]!.event).toBe("left");
  });

  it("null→null yields a flat transition (no signal)", () => {
    const ts = buildTransitions([pt({ rank: null, checkedAt: "2026-07-01 08:00:00" }), pt({ rank: null, checkedAt: "2026-07-02 08:00:00" })]);
    expect(ts[0]!.event).toBe("flat");
  });

  it("detects name_added_seed vs name_changed", () => {
    const ts = buildTransitions([
      pt({ name: "Weatherly", checkedAt: "2026-07-01 08:00:00" }),
      pt({ name: "Weatherly Radar", checkedAt: "2026-07-02 08:00:00", rank: 3 }),
    ]);
    // seed "weather" was already in both names → name_changed, but NOT name_added_seed
    expect(ts[0]!.changes).toContain("name_changed");
    expect(ts[0]!.changes).not.toContain("name_added_seed");

    const added = buildTransitions([
      pt({ name: "Radar", seedKeyword: "weather", checkedAt: "2026-07-01 08:00:00" }),
      pt({ name: "Weather Radar", seedKeyword: "weather", checkedAt: "2026-07-02 08:00:00" }),
    ]);
    expect(added[0]!.changes).toContain("name_added_seed");
  });

  it("detects version bump, rating up/down, description grow/shrink", () => {
    const ts = buildTransitions([
      pt({ version: "1.0.0", rating: 4.0, description: "Short.", checkedAt: "2026-07-01 08:00:00" }),
      pt({ version: "1.1.0", rating: 4.6, description: "A much longer description now.", checkedAt: "2026-07-02 08:00:00" }),
    ]);
    expect(ts[0]!.changes).toContain("version_bumped");
    expect(ts[0]!.changes).toContain("rating_up");
    expect(ts[0]!.changes).toContain("description_grew");
  });

  it("does not pair snapshots across different bundles or seeds", () => {
    const ts = buildTransitions([
      pt({ bundleId: "com.a", checkedAt: "2026-07-01 08:00:00" }),
      pt({ bundleId: "com.b", checkedAt: "2026-07-02 08:00:00" }),
    ]);
    expect(ts).toHaveLength(0);
  });
});

/** Build `n` version-bump transitions, `climbers` of which climbed. */
function transitionsWith(_change: "version_bumped", seed: string, n: number, climbers: number) {
  const points: CorpusPoint[] = [];
  for (let i = 0; i < n; i++) {
    const bundleId = `com.app${i}`;
    points.push(pt({ bundleId, seedKeyword: seed, version: "1.0.0", rank: 8, checkedAt: "2026-07-01 08:00:00" }));
    points.push(pt({ bundleId, seedKeyword: seed, version: "1.1.0", rank: i < climbers ? 3 : 8, checkedAt: "2026-07-02 08:00:00" }));
  }
  return buildTransitions(points);
}

describe("mineHypotheses", () => {
  it("empty input → no hypotheses, but blindSpots are always stated", () => {
    const out = mineHypotheses([]);
    expect(out.hypotheses).toEqual([]);
    expect(out.totalTransitions).toBe(0);
    expect(out.blindSpots.join(" ")).toMatch(/subtitle|keyword/i);
  });

  it("computes climb rate + support and marks sufficient at/above MIN_SUPPORT", () => {
    const ts = transitionsWith("version_bumped", "weather", MIN_SUPPORT, Math.round(MIN_SUPPORT * 0.6));
    const h = mineHypotheses(ts).hypotheses.find((x: { change: string }) => x.change === "version_bumped")!;
    expect(h.support).toBe(MIN_SUPPORT);
    expect(h.climbRate).toBeCloseTo(0.6, 1);
    expect(h.sufficient).toBe(true);
    expect(h.examples.length).toBeGreaterThan(0); // real supporting rows
  });

  it("withholds a sub-threshold change by default (no pattern from thin data)", () => {
    const ts = transitionsWith("version_bumped", "weather", 3, 2); // only 3
    const out = mineHypotheses(ts);
    expect(out.hypotheses.find((x: { change: string }) => x.change === "version_bumped")).toBeUndefined();
  });

  it("can include insufficient ones flagged, when asked", () => {
    const ts = transitionsWith("version_bumped", "weather", 3, 2);
    const out = mineHypotheses(ts, { includeInsufficient: true });
    const h = out.hypotheses.find((x: { change: string }) => x.change === "version_bumped")!;
    expect(h.sufficient).toBe(false);
  });
});

describe("phraseHypothesis", () => {
  it("uses correlational 'tended to' wording for a sufficient hypothesis — never an imperative", () => {
    const [h] = mineHypotheses(transitionsWith("version_bumped", "weather", MIN_SUPPORT, MIN_SUPPORT - 5)).hypotheses;
    const line = phraseHypothesis(h!);
    expect(line).toMatch(/tended to/i);
    expect(line.toLowerCase()).not.toMatch(/\b(do |add |should |must )/);
  });

  it("says 'not enough' for an insufficient hypothesis", () => {
    const ts = transitionsWith("version_bumped", "weather", 4, 3);
    const h = mineHypotheses(ts, { includeInsufficient: true }).hypotheses[0]!;
    expect(phraseHypothesis(h).toLowerCase()).toMatch(/not enough|only \d/);
  });
});
