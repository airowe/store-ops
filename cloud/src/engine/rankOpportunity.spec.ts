import { describe, expect, it } from "vitest";
import { rankOpportunities, type RankSnapshot } from "./rankOpportunity.js";

/**
 * #65: opportunity scoring is built from MEASURED signals only — your rank
 * (distance), competitor ranks (weakness), and rank history (momentum). There is
 * no fabricated "volume"/"difficulty"/"relevance" driver, so these tests assert
 * the score + reachability fall out of real rank data alone.
 */

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

describe("rankOpportunities — winnability scoring (measured signals only, #65)", () => {
  it("ranks a close + weak-competitor term above a far + strong-incumbent term", () => {
    const out = rankOpportunities({
      ranks: [snap("meditation timer", 14), snap("games", 180)],
      competitorRanks: [
        // "games" has a giant incumbent at #1; "meditation timer" rivals are weak/deep.
        { name: "BigGames", ranks: [snap("games", 1)] },
        { name: "WeakRival", ranks: [snap("meditation timer", 120)] },
      ],
    });
    const close = out.find((o) => o.keyword === "meditation timer");
    const far = out.find((o) => o.keyword === "games");
    expect(close).toBeDefined();
    expect(far).toBeDefined();
    expect(close!.opportunityScore).toBeGreaterThan(far!.opportunityScore);
    // sorted descending → the winnable term leads.
    expect(out[0]?.keyword).toBe("meditation timer");
  });

  it("KEY honesty test: a #200 app vs three top incumbents is a 'longshot', never 'now'", () => {
    const out = rankOpportunities({
      ranks: [snap("games", 200)],
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

  it("a #14 term in a weak field is reachable (now/soon), never longshot", () => {
    const out = rankOpportunities({
      ranks: [snap("meditation timer", 14)],
      competitorRanks: [{ name: "WeakRival", ranks: [snap("meditation timer", 150)] }],
    });
    const o = out.find((x) => x.keyword === "meditation timer");
    expect(o).toBeDefined();
    expect(["now", "soon"]).toContain(o?.reachability);
    expect(o?.reachability).not.toBe("longshot");
  });
});

describe("rankOpportunities — drivers (all measured)", () => {
  it("scales distance: rank 1 is near-100, rank 200/null is 0", () => {
    const out = rankOpportunities({
      ranks: [snap("top", 1), snap("deep", 200), snap("unranked", null)],
    });
    const top = out.find((o) => o.keyword === "top");
    const deep = out.find((o) => o.keyword === "deep");
    const unranked = out.find((o) => o.keyword === "unranked");
    expect(top?.drivers.distance).toBeGreaterThan(95);
    expect(deep?.drivers.distance).toBe(0);
    expect(unranked?.drivers.distance).toBe(0);
  });

  it("competitorWeakness is 100 when there are no competitors for the term", () => {
    const out = rankOpportunities({ ranks: [snap("solo", 30)] });
    expect(out[0]?.drivers.competitorWeakness).toBe(100);
  });

  it("competitorWeakness is low when incumbents sit at the top, high when they're deep", () => {
    const strong = rankOpportunities({
      ranks: [snap("k", 30)],
      competitorRanks: [{ name: "Top", ranks: [snap("k", 1)] }],
    });
    const weak = rankOpportunities({
      ranks: [snap("k", 30)],
      competitorRanks: [{ name: "Deep", ranks: [snap("k", 180)] }],
    });
    expect(strong[0]?.drivers.competitorWeakness).toBeLessThan(weak[0]?.drivers.competitorWeakness ?? 0);
  });

  it("momentum is 100 when gaining, 0 when losing, 50 with a single snapshot", () => {
    const gaining = rankOpportunities({ ranks: history("g", 40, 20) });
    const losing = rankOpportunities({ ranks: history("l", 20, 40) });
    const flat = rankOpportunities({ ranks: [snap("s", 20)] });
    expect(gaining[0]?.drivers.momentum).toBe(100);
    expect(losing[0]?.drivers.momentum).toBe(0);
    expect(flat[0]?.drivers.momentum).toBe(50);
  });

  it("exposes ONLY measured drivers — no fabricated volume/difficulty/relevance (#65)", () => {
    const out = rankOpportunities({ ranks: [snap("k", 30)] });
    const d = out[0]?.drivers;
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(Object.keys(d ?? {}).sort()).toEqual(["competitorWeakness", "distance", "momentum"]);
    // explicit: the fabricated keys are gone
    expect(d).not.toHaveProperty("volume");
    expect(d).not.toHaveProperty("difficulty");
    expect(d).not.toHaveProperty("relevance");
  });
});

describe("rankOpportunities — reachability buckets", () => {
  it("already-top-10 ranks bucket as 'now'", () => {
    const out = rankOpportunities({ ranks: [snap("k", 5)] });
    expect(out[0]?.reachability).toBe("now");
  });

  it("unranked but in an open field (no/weak competitors) is 'soon', not 'longshot'", () => {
    // No competitors → competitorWeakness 100 → an open, reachable field.
    const out = rankOpportunities({ ranks: [snap("k", null)] });
    expect(out[0]?.reachability).toBe("soon");
  });

  it("unranked against strong incumbents is a 'longshot'", () => {
    const out = rankOpportunities({
      ranks: [snap("k", null)],
      competitorRanks: [
        { name: "A", ranks: [snap("k", 1)] },
        { name: "B", ranks: [snap("k", 2)] },
      ],
    });
    expect(out[0]?.reachability).toBe("longshot");
  });
});

describe("rankOpportunities — output contract", () => {
  it("sorts by opportunityScore descending and is deterministic (same input → same output)", () => {
    const input = { ranks: [snap("a", 8), snap("b", 50), snap("c", 150)] };
    const first = rankOpportunities(input);
    const second = rankOpportunities(input);
    expect(first).toEqual(second);
    for (let i = 1; i < first.length; i++) {
      expect(first[i - 1]!.opportunityScore).toBeGreaterThanOrEqual(first[i]!.opportunityScore);
    }
  });

  it("emits a correlational, non-causal why string with NO search-volume claim (#65)", () => {
    const out = rankOpportunities({
      ranks: [snap("k", 12)],
      competitorRanks: [{ name: "Deep", ranks: [snap("k", 160)] }],
    });
    const why = out[0]?.why ?? "";
    expect(why.length).toBeGreaterThan(0);
    // Honesty: never claim causation, and never claim a search-volume we don't measure.
    expect(why.toLowerCase()).not.toMatch(/caused|guaranteed|will rank/);
    expect(why.toLowerCase()).not.toMatch(/search volume|high volume/);
  });

  it("uses the latest snapshot per keyword as the current rank", () => {
    const out = rankOpportunities({ ranks: history("k", 80, 12) });
    expect(out[0]?.rank).toBe(12);
  });

  it("ranks every keyword present in ranks (no invented score gates the list, #65)", () => {
    const out = rankOpportunities({ ranks: [snap("a", 10), snap("b", 10)] });
    expect(out.map((o) => o.keyword).sort()).toEqual(["a", "b"]);
  });

  it("flags an unranked, no-competitor, no-history keyword as NOT scored (the 42.5 artifact, #65)", () => {
    // distance 0 + competitorWeakness's no-data 100 + momentum's no-history 50
    // → the same constant for every such term; that's an artifact, not a measure.
    const out = rankOpportunities({ ranks: [snap("mystery", null)] });
    const o = out.find((x) => x.keyword === "mystery");
    expect(o?.scored).toBe(false);
    expect(o?.opportunityScore).toBe(42.5); // the constant is still computed…
    // …but `scored:false` tells the UI to present it as "not enough data".
  });

  it("flags MULTIPLE all-null snapshots as NOT scored — the same 42.5 artifact, not a measure (#317)", () => {
    // The prod bug: ≥2 history rows that are ALL unranked carry no differentiating
    // signal (momentum stays at its no-movement 50), so the score is still the 42.5
    // artifact. Row COUNT alone must not qualify a keyword as scored.
    const out = rankOpportunities({ ranks: history("ghost", null, null) });
    const o = out.find((x) => x.keyword === "ghost");
    expect(o?.scored).toBe(false);
    expect(o?.opportunityScore).toBe(42.5);
  });

  it("marks a keyword scored when ANY measured signal exists (rank, competitor, or history)", () => {
    const ranked = rankOpportunities({ ranks: [snap("ranked", 12)] });
    expect(ranked.find((o) => o.keyword === "ranked")?.scored).toBe(true);

    const withCompetitor = rankOpportunities({
      ranks: [snap("k", null)],
      competitorRanks: [{ name: "Rival", ranks: [snap("k", 40)] }],
    });
    expect(withCompetitor.find((o) => o.keyword === "k")?.scored).toBe(true);

    // History qualifies as a signal only when it contains a real (non-null) rank —
    // an all-null history is the #317 artifact, covered by its own test above.
    const withHistory = rankOpportunities({ ranks: history("h", null, 40) });
    expect(withHistory.find((o) => o.keyword === "h")?.scored).toBe(true);
  });
});
