import { describe, expect, it } from "vitest";
import { rankOpportunities, type RankSnapshot } from "./rankOpportunity.js";

/** Build a single-snapshot rank row for a keyword (the common case). */
function snap(keyword: string, rank: number | null, checked_at = "2026-01-01 00:00:00"): RankSnapshot {
  return { keyword, rank, total: 200, checked_at };
}

/** Build a 2-snapshot history (older → newer) so momentum is exercised. */
function history(keyword: string, older: number | null, newer: number | null): RankSnapshot[] {
  return [
    { keyword, rank: older, total: 200, checked_at: "2026-01-01 00:00:00" },
    { keyword, rank: newer, total: 200, checked_at: "2026-01-15 00:00:00" },
  ];
}

describe("rankOpportunities — winnability scoring", () => {
  it("ranks a close + weak-competitor term above a high-volume far + strong-incumbent term", () => {
    const out = rankOpportunities({
      ranks: [snap("meditation timer", 14), snap("games", 180)],
      keywordScores: { "meditation timer": 55, games: 95 },
      competitorRanks: [
        // "games" has a giant incumbent sitting at #1; "meditation timer" rivals are weak/deep.
        { name: "BigGames", ranks: [snap("games", 1)] },
        { name: "WeakRival", ranks: [snap("meditation timer", 120)] },
      ],
    });
    const close = out.find((o) => o.keyword === "meditation timer");
    const far = out.find((o) => o.keyword === "games");
    expect(close).toBeDefined();
    expect(far).toBeDefined();
    expect((close as { opportunityScore: number }).opportunityScore).toBeGreaterThan(
      (far as { opportunityScore: number }).opportunityScore,
    );
    // sorted descending → the winnable term leads.
    expect(out[0]?.keyword).toBe("meditation timer");
  });

  it("KEY honesty test: a #200 weak app is NOT sent to chase a high-volume strong-incumbent term", () => {
    const out = rankOpportunities({
      ranks: [snap("games", 200)],
      keywordScores: { games: 98 },
      competitorRanks: [
        { name: "Incumbent A", ranks: [snap("games", 1)] },
        { name: "Incumbent B", ranks: [snap("games", 2)] },
        { name: "Incumbent C", ranks: [snap("games", 3)] },
      ],
    });
    const games = out.find((o) => o.keyword === "games");
    expect(games?.reachability).toBe("longshot");
    expect(games?.reachability).not.toBe("now");
  });

  it("a #14 mid-volume term in a weak field is reachable (now/soon), never longshot", () => {
    const out = rankOpportunities({
      ranks: [snap("meditation timer", 14)],
      keywordScores: { "meditation timer": 55 },
      competitorRanks: [{ name: "WeakRival", ranks: [snap("meditation timer", 150)] }],
    });
    const o = out.find((x) => x.keyword === "meditation timer");
    expect(o).toBeDefined();
    expect(["now", "soon"]).toContain(o?.reachability);
    expect(o?.reachability).not.toBe("longshot");
  });
});

describe("rankOpportunities — drivers", () => {
  it("scales distance: rank 1 is near-100, rank 200/null is 0", () => {
    const out = rankOpportunities({
      ranks: [snap("top", 1), snap("deep", 200), snap("unranked", null)],
      keywordScores: { top: 50, deep: 50, unranked: 50 },
    });
    const top = out.find((o) => o.keyword === "top");
    const deep = out.find((o) => o.keyword === "deep");
    const unranked = out.find((o) => o.keyword === "unranked");
    expect(top?.drivers.distance).toBeGreaterThan(95);
    expect(deep?.drivers.distance).toBe(0);
    expect(unranked?.drivers.distance).toBe(0);
  });

  it("competitorWeakness is 100 when there are no competitors for the term", () => {
    const out = rankOpportunities({
      ranks: [snap("solo", 30)],
      keywordScores: { solo: 50 },
    });
    expect(out[0]?.drivers.competitorWeakness).toBe(100);
  });

  it("competitorWeakness is low when incumbents sit at the top, high when they're deep", () => {
    const strong = rankOpportunities({
      ranks: [snap("k", 30)],
      keywordScores: { k: 50 },
      competitorRanks: [{ name: "Top", ranks: [snap("k", 1)] }],
    });
    const weak = rankOpportunities({
      ranks: [snap("k", 30)],
      keywordScores: { k: 50 },
      competitorRanks: [{ name: "Deep", ranks: [snap("k", 180)] }],
    });
    expect(strong[0]?.drivers.competitorWeakness).toBeLessThan(weak[0]?.drivers.competitorWeakness ?? 0);
  });

  it("momentum is 100 when gaining, 0 when losing, 50 with a single snapshot", () => {
    const gaining = rankOpportunities({
      ranks: history("g", 40, 20),
      keywordScores: { g: 50 },
    });
    const losing = rankOpportunities({
      ranks: history("l", 20, 40),
      keywordScores: { l: 50 },
    });
    const flat = rankOpportunities({
      ranks: [snap("s", 20)],
      keywordScores: { s: 50 },
    });
    expect(gaining[0]?.drivers.momentum).toBe(100);
    expect(losing[0]?.drivers.momentum).toBe(0);
    expect(flat[0]?.drivers.momentum).toBe(50);
  });

  it("exposes a serializable drivers object (volume/distance/competitorWeakness/momentum)", () => {
    const out = rankOpportunities({
      ranks: [snap("k", 30)],
      keywordScores: { k: 50 },
    });
    const d = out[0]?.drivers;
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(Object.keys(d ?? {}).sort()).toEqual(
      ["competitorWeakness", "distance", "momentum", "volume"],
    );
  });
});

describe("rankOpportunities — reachability buckets", () => {
  it("already-top-10 ranks bucket as 'now'", () => {
    const out = rankOpportunities({
      ranks: [snap("k", 5)],
      keywordScores: { k: 50 },
    });
    expect(out[0]?.reachability).toBe("now");
  });

  it("unranked but high-volume in a winnable field is 'soon', not 'longshot'", () => {
    const out = rankOpportunities({
      ranks: [snap("k", null)],
      keywordScores: { k: 70 },
    });
    expect(out[0]?.reachability).toBe("soon");
  });

  it("unranked + low-volume is a 'longshot'", () => {
    const out = rankOpportunities({
      ranks: [snap("k", null)],
      keywordScores: { k: 20 },
    });
    expect(out[0]?.reachability).toBe("longshot");
  });
});

describe("rankOpportunities — output contract", () => {
  it("sorts by opportunityScore descending and is deterministic (same input → same output)", () => {
    const input = {
      ranks: [snap("a", 8), snap("b", 50), snap("c", 150)],
      keywordScores: { a: 60, b: 55, c: 50 },
    };
    const first = rankOpportunities(input);
    const second = rankOpportunities(input);
    expect(first).toEqual(second);
    for (let i = 1; i < first.length; i++) {
      expect(first[i - 1]!.opportunityScore).toBeGreaterThanOrEqual(first[i]!.opportunityScore);
    }
  });

  it("emits a correlational, non-causal why string", () => {
    const out = rankOpportunities({
      ranks: [snap("k", 12)],
      keywordScores: { k: 60 },
      competitorRanks: [{ name: "Deep", ranks: [snap("k", 160)] }],
    });
    const why = out[0]?.why ?? "";
    expect(why.length).toBeGreaterThan(0);
    // Honesty: never claim causation in the explanation.
    expect(why.toLowerCase()).not.toMatch(/caused|guaranteed|will rank/);
  });

  it("uses the latest snapshot per keyword as the current rank", () => {
    const out = rankOpportunities({
      ranks: history("k", 80, 12),
      keywordScores: { k: 50 },
    });
    expect(out[0]?.rank).toBe(12);
  });

  it("returns no opportunity for a keyword absent from keywordScores (degrades gracefully)", () => {
    const out = rankOpportunities({
      ranks: [snap("known", 10), snap("unscored", 10)],
      keywordScores: { known: 50 },
    });
    expect(out.map((o) => o.keyword)).toEqual(["known"]);
  });
});
