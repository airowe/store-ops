/**
 * Proof capture — PURE win extraction + anonymized aggregation, fully testable
 * with no network and no DB. We feed in-memory RankSnapshotRow[] arrays (the
 * same shape `getRankHistory` returns: flat, mixed keywords, ASC by checked_at)
 * and assert which keywords count as "wins", the earliest→latest rank pairing,
 * the day-span computation, the sort order, and the anonymized landing-page
 * aggregate (counts + medians only — no app names, no emails).
 *
 * Rank convention: LOWER is better. A win is a keyword whose rank IMPROVED
 * meaningfully between its earliest and latest non-null snapshot, so
 * improvement = from - to and a win requires improvement >= minImprovement.
 */
import { describe, expect, it } from "vitest";
import { extractWins, aggregateProof, type RankWin } from "./proof.js";
import type { RankSnapshotRow } from "./d1.js";

// ── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
/** Build a RankSnapshotRow with a monotonically-increasing id. */
function snap(
  keyword: string,
  rank: number | null,
  checkedAt: string,
  total = 200,
): RankSnapshotRow {
  return {
    id: `snap-${String(seq++).padStart(6, "0")}`,
    app_id: "app-1",
    keyword,
    rank,
    total,
    country: "us",
    checked_at: checkedAt,
  };
}

// ── extractWins: basic win detection ─────────────────────────────────────────

describe("extractWins — win detection", () => {
  it("treats a meaningful improvement as a win (from earliest to latest)", () => {
    const history = [
      snap("budget tracker", 40, "2026-01-01 00:00:00"),
      snap("budget tracker", 12, "2026-01-08 00:00:00"),
    ];
    const wins = extractWins(history);
    expect(wins).toEqual<RankWin[]>([
      {
        keyword: "budget tracker",
        from: 40,
        to: 12,
        improvement: 28,
        spanDays: 7,
      },
    ]);
  });

  it("does NOT count a worsening rank (rank went up = worse) as a win", () => {
    const history = [
      snap("expense app", 10, "2026-01-01 00:00:00"),
      snap("expense app", 30, "2026-01-08 00:00:00"),
    ];
    expect(extractWins(history)).toEqual([]);
  });

  it("does NOT count an unchanged rank as a win", () => {
    const history = [
      snap("flat", 15, "2026-01-01 00:00:00"),
      snap("flat", 15, "2026-01-08 00:00:00"),
    ];
    expect(extractWins(history)).toEqual([]);
  });

  it("skips a keyword that only ever had one non-null rank", () => {
    const history = [snap("lonely", 5, "2026-01-01 00:00:00")];
    expect(extractWins(history)).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(extractWins([])).toEqual([]);
  });
});

// ── extractWins: minImprovement threshold boundary ───────────────────────────

describe("extractWins — minImprovement threshold", () => {
  // default threshold is 3 per the module contract.
  it.each([
    { improvementDelta: 2, isWin: false, label: "below default" },
    { improvementDelta: 3, isWin: true, label: "exactly at default (inclusive)" },
    { improvementDelta: 4, isWin: true, label: "above default" },
  ])(
    "default threshold: improvement of $improvementDelta ($label) -> win=$isWin",
    ({ improvementDelta, isWin }) => {
      const from = 50;
      const to = from - improvementDelta;
      const history = [
        snap("kw", from, "2026-01-01 00:00:00"),
        snap("kw", to, "2026-01-08 00:00:00"),
      ];
      const wins = extractWins(history);
      expect(wins.length).toBe(isWin ? 1 : 0);
      if (isWin) expect(wins[0]?.improvement).toBe(improvementDelta);
    },
  );

  it.each([
    { minImprovement: 10, improvementDelta: 9, isWin: false },
    { minImprovement: 10, improvementDelta: 10, isWin: true },
    { minImprovement: 10, improvementDelta: 11, isWin: true },
    { minImprovement: 1, improvementDelta: 1, isWin: true },
  ])(
    "custom minImprovement=$minImprovement: improvement=$improvementDelta -> win=$isWin",
    ({ minImprovement, improvementDelta, isWin }) => {
      const from = 80;
      const history = [
        snap("kw", from, "2026-01-01 00:00:00"),
        snap("kw", from - improvementDelta, "2026-01-08 00:00:00"),
      ];
      expect(extractWins(history, { minImprovement }).length).toBe(isWin ? 1 : 0);
    },
  );
});

// ── extractWins: earliest/latest selection across many snapshots ─────────────

describe("extractWins — earliest/latest selection", () => {
  it("uses the EARLIEST and LATEST non-null snapshots, ignoring those between", () => {
    const history = [
      snap("kw", 60, "2026-01-01 00:00:00"), // earliest
      snap("kw", 5, "2026-01-04 00:00:00"), // best, but not the endpoint
      snap("kw", 90, "2026-01-06 00:00:00"), // worst, but not the endpoint
      snap("kw", 20, "2026-01-11 00:00:00"), // latest
    ];
    const wins = extractWins(history);
    expect(wins[0]).toMatchObject({ from: 60, to: 20, improvement: 40, spanDays: 10 });
  });

  it("skips leading/trailing null ranks when choosing earliest & latest", () => {
    const history = [
      snap("kw", null, "2026-01-01 00:00:00"), // leading null -> skipped
      snap("kw", 45, "2026-01-03 00:00:00"), // earliest non-null
      snap("kw", 18, "2026-01-09 00:00:00"), // latest non-null
      snap("kw", null, "2026-01-12 00:00:00"), // trailing null -> skipped
    ];
    const wins = extractWins(history);
    expect(wins[0]).toMatchObject({ from: 45, to: 18, improvement: 27, spanDays: 6 });
  });

  it("treats interior null ranks as gaps, not endpoints", () => {
    const history = [
      snap("kw", 30, "2026-01-01 00:00:00"),
      snap("kw", null, "2026-01-05 00:00:00"),
      snap("kw", 10, "2026-01-09 00:00:00"),
    ];
    const wins = extractWins(history);
    expect(wins[0]).toMatchObject({ from: 30, to: 10, improvement: 20, spanDays: 8 });
  });

  it("never produces a null `from` or `to`", () => {
    const history = [
      snap("kw", null, "2026-01-01 00:00:00"),
      snap("kw", 40, "2026-01-02 00:00:00"),
      snap("kw", 10, "2026-01-05 00:00:00"),
    ];
    const win = extractWins(history)[0];
    expect(win?.from).not.toBeNull();
    expect(win?.to).not.toBeNull();
    expect(typeof win?.from).toBe("number");
    expect(typeof win?.to).toBe("number");
  });
});

// ── extractWins: spanDays computation ────────────────────────────────────────

describe("extractWins — spanDays", () => {
  it.each([
    { from: "2026-01-01 00:00:00", to: "2026-01-08 00:00:00", spanDays: 7 },
    { from: "2026-01-01 00:00:00", to: "2026-01-02 00:00:00", spanDays: 1 },
    { from: "2026-01-01 00:00:00", to: "2026-02-01 00:00:00", spanDays: 31 },
    { from: "2026-01-01 12:00:00", to: "2026-01-02 12:00:00", spanDays: 1 },
  ])("span between $from and $to is $spanDays day(s)", ({ from, to, spanDays }) => {
    const history = [
      snap("kw", 50, from),
      snap("kw", 10, to),
    ];
    expect(extractWins(history)[0]?.spanDays).toBe(spanDays);
  });

  it("computes a fractional-day span correctly (12h = 0.5 days)", () => {
    const history = [
      snap("kw", 50, "2026-01-01 00:00:00"),
      snap("kw", 10, "2026-01-01 12:00:00"),
    ];
    expect(extractWins(history)[0]?.spanDays).toBeCloseTo(0.5, 6);
  });

  it("parses the 'YYYY-MM-DD HH:MM:SS' format as UTC (no local-tz drift)", () => {
    // a whole number of days must come out exactly whole regardless of host tz.
    const history = [
      snap("kw", 50, "2026-06-13 09:30:00"),
      snap("kw", 10, "2026-06-20 09:30:00"),
    ];
    expect(extractWins(history)[0]?.spanDays).toBe(7);
  });
});

// ── extractWins: multiple keywords, sort order ───────────────────────────────

describe("extractWins — multiple keywords & sort order", () => {
  it("returns one win per qualifying keyword, sorted by improvement desc", () => {
    const history = [
      snap("small win", 20, "2026-01-01 00:00:00"),
      snap("small win", 15, "2026-01-08 00:00:00"), // improvement 5
      snap("big win", 90, "2026-01-01 00:00:00"),
      snap("big win", 30, "2026-01-08 00:00:00"), // improvement 60
      snap("medium win", 50, "2026-01-01 00:00:00"),
      snap("medium win", 20, "2026-01-08 00:00:00"), // improvement 30
    ];
    const wins = extractWins(history);
    expect(wins.map((w) => w.keyword)).toEqual(["big win", "medium win", "small win"]);
    expect(wins.map((w) => w.improvement)).toEqual([60, 30, 5]);
  });

  it("excludes non-winning keywords from a mixed batch", () => {
    const history = [
      snap("winner", 40, "2026-01-01 00:00:00"),
      snap("winner", 10, "2026-01-08 00:00:00"), // win
      snap("loser", 10, "2026-01-01 00:00:00"),
      snap("loser", 40, "2026-01-08 00:00:00"), // worsened
      snap("tiny", 10, "2026-01-01 00:00:00"),
      snap("tiny", 8, "2026-01-08 00:00:00"), // improvement 2 < default 3
      snap("single", 5, "2026-01-01 00:00:00"), // only one snapshot
    ];
    expect(extractWins(history).map((w) => w.keyword)).toEqual(["winner"]);
  });
});

// ── aggregateProof: anonymized aggregate ─────────────────────────────────────

function win(improvement: number): RankWin {
  return {
    keyword: "kw",
    from: 100,
    to: 100 - improvement,
    improvement,
    spanDays: 7,
  };
}

describe("aggregateProof", () => {
  it("returns all-zero stats for no apps", () => {
    expect(aggregateProof([])).toEqual({
      appsWithWins: 0,
      totalWins: 0,
      bestImprovement: 0,
      medianImprovement: 0,
    });
  });

  it("returns all-zero stats when apps exist but none have wins", () => {
    expect(aggregateProof([[], [], []])).toEqual({
      appsWithWins: 0,
      totalWins: 0,
      bestImprovement: 0,
      medianImprovement: 0,
    });
  });

  it("counts only apps that actually have wins", () => {
    const result = aggregateProof([
      [win(10), win(20)], // app 1: 2 wins
      [], // app 2: no wins -> not counted in appsWithWins
      [win(5)], // app 3: 1 win
    ]);
    expect(result.appsWithWins).toBe(2);
    expect(result.totalWins).toBe(3);
  });

  it("reports the single best improvement across all apps", () => {
    const result = aggregateProof([
      [win(10), win(45)],
      [win(60), win(5)],
    ]);
    expect(result.bestImprovement).toBe(60);
  });

  it("computes the median over an ODD count of wins", () => {
    // improvements: [5, 10, 30] -> median 10
    const result = aggregateProof([[win(10)], [win(5), win(30)]]);
    expect(result.medianImprovement).toBe(10);
  });

  it("computes the median over an EVEN count of wins (average of middle two)", () => {
    // improvements sorted: [10, 20, 30, 40] -> median (20+30)/2 = 25
    const result = aggregateProof([
      [win(40), win(10)],
      [win(30), win(20)],
    ]);
    expect(result.medianImprovement).toBe(25);
  });

  it("median of a single win is that win's improvement", () => {
    expect(aggregateProof([[win(17)]]).medianImprovement).toBe(17);
  });

  it("aggregate is anonymized: exposes only numeric fields", () => {
    const result = aggregateProof([[win(12)], [win(8)]]);
    expect(Object.keys(result).sort()).toEqual([
      "appsWithWins",
      "bestImprovement",
      "medianImprovement",
      "totalWins",
    ]);
    for (const v of Object.values(result)) expect(typeof v).toBe("number");
  });

  it("composes with extractWins end to end (anonymized fan-in)", () => {
    const appA = [
      snap("a-kw", 50, "2026-01-01 00:00:00"),
      snap("a-kw", 20, "2026-01-08 00:00:00"), // improvement 30
    ];
    const appB = [
      snap("b-kw", 90, "2026-01-01 00:00:00"),
      snap("b-kw", 10, "2026-01-08 00:00:00"), // improvement 80
      snap("b-flat", 5, "2026-01-01 00:00:00"),
      snap("b-flat", 5, "2026-01-08 00:00:00"), // no win
    ];
    const result = aggregateProof([extractWins(appA), extractWins(appB)]);
    expect(result).toEqual({
      appsWithWins: 2,
      totalWins: 2,
      bestImprovement: 80,
      medianImprovement: 55, // (30 + 80) / 2
    });
  });
});
