/**
 * Competitor rank war room — PRD 05 (`docs/prd/ranking-features/05-competitor-rank-war.md`).
 *
 * `buildWarRoom` is PURE + DETERMINISTIC + NETWORK-FREE: it takes your normalized
 * per-keyword rank history (the same RankSnapshotRow shape `getRankHistory`
 * returns, normalized to `{ keyword, rank, checked_at }`) and a per-competitor
 * set of the same, and returns one head-to-head row per keyword — your rank,
 * each selected competitor's rank (or null when we never checked them on that
 * keyword), the gap to the best competitor, a trend over the window, and a
 * winning flag — sorted so the most CLOSEABLE gaps lead.
 *
 * HONESTY CONSTRAINTS (carried from the PRD + the suite overview):
 *  - Unknown ≠ zero ≠ "they don't rank". A competitor we didn't check on a
 *    keyword is `null` (rendered "—"), never guessed or interpolated.
 *  - gapToBest is CURRENT, never historical or projected.
 *  - winning = you beat EVERY selected competitor on this keyword.
 */
import { describe, expect, it } from "vitest";
import { buildWarRoom, type RankSnapshot } from "./rankWarRoom.js";

describe("buildWarRoom", () => {
  it("ranks you vs selected competitors, computes gap-to-best and winning flag", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "budget app", rank: 18, checked_at: "2026-06-10" },
      { keyword: "budget app", rank: 15, checked_at: "2026-06-03" },
      { keyword: "habit tracker", rank: 25, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      {
        name: "Money Lover",
        ranks: [
          { keyword: "budget app", rank: 8, checked_at: "2026-06-10" },
          { keyword: "budget app", rank: 9, checked_at: "2026-06-03" },
        ],
      },
      {
        name: "Goodbudget",
        ranks: [
          { keyword: "budget app", rank: 12, checked_at: "2026-06-10" },
          { keyword: "budget app", rank: 13, checked_at: "2026-06-03" },
        ],
      },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    // "budget app" (you #18, best #8, gap=10) leads; "habit tracker" has no
    // competitor data so it has no closeable gap and sinks below.
    expect(result[0]?.keyword).toBe("budget app");
    expect(result[0]?.you).toBe(18);
    expect(result[0]?.gapToBest).toBe(10);
    expect(result[0]?.winning).toBe(false);
    expect(result[0]?.competitors).toHaveLength(2);
    expect(result[0]?.competitors[0]).toEqual({ name: "Money Lover", rank: 8 });
    expect(result[0]?.competitors[1]).toEqual({ name: "Goodbudget", rank: 12 });
  });

  it("computes trend over the window (gaining / lost)", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "meditation", rank: 20, checked_at: "2026-06-10" },
      { keyword: "meditation", rank: 25, checked_at: "2026-06-03" },
      { keyword: "focus timer", rank: null, checked_at: "2026-06-10" },
      { keyword: "focus timer", rank: 40, checked_at: "2026-06-03" },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks: [] });
    // meditation: 25 → 20 (lower is better = gaining); focus timer: 40 → null (lost)
    expect(result.find((r) => r.keyword === "meditation")?.trend).toBe("gaining");
    expect(result.find((r) => r.keyword === "focus timer")?.trend).toBe("lost");
  });

  it("classifies losing / flat / new trends", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "slipping", rank: 30, checked_at: "2026-06-10" },
      { keyword: "slipping", rank: 22, checked_at: "2026-06-03" }, // 22 → 30 = losing
      { keyword: "steady", rank: 14, checked_at: "2026-06-10" },
      { keyword: "steady", rank: 14, checked_at: "2026-06-03" }, // 14 → 14 = flat
      { keyword: "fresh", rank: 60, checked_at: "2026-06-10" }, // single snapshot = new
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks: [] });
    expect(result.find((r) => r.keyword === "slipping")?.trend).toBe("losing");
    expect(result.find((r) => r.keyword === "steady")?.trend).toBe("flat");
    expect(result.find((r) => r.keyword === "fresh")?.trend).toBe("new");
  });

  it("marks unknown competitor ranks as null, never guesses", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "todo app", rank: 10, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      {
        name: "Todoist",
        ranks: [
          // Did NOT check "todo app" — only "task manager".
          { keyword: "task manager", rank: 5, checked_at: "2026-06-10" },
        ],
      },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    const todo = result.find((r) => r.keyword === "todo app");
    expect(todo?.competitors[0]?.rank).toBeNull(); // —
    expect(todo?.gapToBest).toBeNull(); // no valid best to gap against
    expect(todo?.winning).toBe(false); // can't claim a win over an unknown
  });

  it("sets winning=true and gapToBest=null when you beat all competitors", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "amazing app", rank: 3, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      { name: "OldApp", ranks: [{ keyword: "amazing app", rank: 45, checked_at: "2026-06-10" }] },
      { name: "MediocreApp", ranks: [{ keyword: "amazing app", rank: 80, checked_at: "2026-06-10" }] },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    expect(result[0]?.winning).toBe(true);
    expect(result[0]?.gapToBest).toBeNull();
  });

  it("sorts by closeable gap: smallest (most reachable) gap first", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "kw1", rank: 20, checked_at: "2026-06-10" },
      { keyword: "kw2", rank: 50, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      {
        name: "CompA",
        ranks: [
          { keyword: "kw1", rank: 18, checked_at: "2026-06-10" }, // gap=2
          { keyword: "kw2", rank: 40, checked_at: "2026-06-10" }, // gap=10
        ],
      },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    // gapToBest ascending (the PRD algorithm + the winnability mandate): the
    // most-reachable race (kw1 gap=2) leads the harder one (kw2 gap=10).
    expect(result[0]?.keyword).toBe("kw1");
    expect(result[1]?.keyword).toBe("kw2");
  });

  it("uses the two most-recent DISTINCT checked_at for trend (default window)", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "old", rank: 50, checked_at: "2026-05-01" },
      { keyword: "old", rank: 20, checked_at: "2026-06-10" },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks: [] });
    // current 20, previous 50 → gaining.
    expect(result[0]?.trend).toBe("gaining");
    expect(result[0]?.you).toBe(20);
  });

  it("WINNABILITY: a #200 user is NOT sent to chase a strong incumbent over a closer term", () => {
    // The reachable race (you behind by a few, competitor weak) must outrank the
    // vanity race (you nowhere, competitor entrenched at #1). gapToBest ascending
    // — the smaller, closeable gap leads.
    const yourRanks: RankSnapshot[] = [
      { keyword: "vanity high-volume", rank: 200, checked_at: "2026-06-10" },
      { keyword: "reachable niche", rank: 14, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      {
        name: "Incumbent",
        ranks: [
          { keyword: "vanity high-volume", rank: 1, checked_at: "2026-06-10" }, // gap=199
          { keyword: "reachable niche", rank: 11, checked_at: "2026-06-10" }, // gap=3
        ],
      },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    // The closeable race leads; the unwinnable incumbent term is demoted.
    expect(result[0]?.keyword).toBe("reachable niche");
    expect(result[0]?.gapToBest).toBe(3);
    expect(result[1]?.keyword).toBe("vanity high-volume");
  });

  it("groups multiple competitors and keeps unknown ones as null per keyword", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "shared", rank: 30, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      { name: "A", ranks: [{ keyword: "shared", rank: 12, checked_at: "2026-06-10" }] },
      { name: "B", ranks: [{ keyword: "other", rank: 4, checked_at: "2026-06-10" }] }, // not checked on "shared"
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    const row = result.find((r) => r.keyword === "shared");
    expect(row?.competitors).toEqual([
      { name: "A", rank: 12 },
      { name: "B", rank: null },
    ]);
    // best is A=12, you=30 → gap=18; B's unknown rank is ignored, not treated as 0.
    expect(row?.gapToBest).toBe(18);
    expect(row?.winning).toBe(false);
  });

  it("ties between equal closeable gaps break deterministically by keyword", () => {
    const yourRanks: RankSnapshot[] = [
      { keyword: "bravo", rank: 20, checked_at: "2026-06-10" },
      { keyword: "alpha", rank: 20, checked_at: "2026-06-10" },
    ];
    const competitorRanks = [
      {
        name: "C",
        ranks: [
          { keyword: "bravo", rank: 15, checked_at: "2026-06-10" }, // gap=5
          { keyword: "alpha", rank: 15, checked_at: "2026-06-10" }, // gap=5
        ],
      },
    ];
    const result = buildWarRoom({ yourRanks, competitorRanks });
    expect(result.map((r) => r.keyword)).toEqual(["alpha", "bravo"]);
  });

  it("returns an empty array for no input", () => {
    expect(buildWarRoom({ yourRanks: [], competitorRanks: [] })).toEqual([]);
  });
});
