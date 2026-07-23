/**
 * Rank opportunity score — PRD 06 (`docs/prd/ranking-features/06-rank-opportunity-score.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE ranker that scores each tracked keyword by
 * WINNABILITY — built ONLY from signals we actually MEASURE (#65). It fuses three
 * real signals computed from rank data:
 *   • distance           — how close you are to the top (closer = more winnable).
 *   • competitorWeakness — weak/absent rivals on the term = more winnable.
 *   • momentum           — already gaining = momentum to ride (a tiebreak, low weight).
 *
 * It deliberately does NOT use a "search volume"/"difficulty"/"relevance" signal:
 * we have no measured source for those (the iTunes APIs expose rank, not volume),
 * so inventing them would be fabricated precision dressed as data (#65). Every
 * driver here is derived from real organic rank — ours and competitors'.
 *
 * The headline output is `opportunityScore` (0–100) plus a `reachability` enum
 * ("now" | "soon" | "longshot"). The enum is the HONEST HEDGE: a #200 weak app on
 * "games" against three giant incumbents is labeled "longshot" — never "now" — so
 * the user chooses with eyes open. The score is a heuristic framed as "most
 * winnable next," NOT a guarantee or a causal claim.
 *
 * HARD CONSTRAINTS (carried from the suite overview):
 *  - No fetch / Date.now / randomness — same input → identical output.
 *  - Only measured signals: no fabricated volume/difficulty/relevance.
 *  - Correlational only: `why` describes the state ("close to top 10, weak
 *    competitors"), never asserts a metadata change CAUSED a rank move.
 */

/**
 * One per-keyword rank-history row. Structurally a subset of `RankSnapshotRow`
 * (d1.ts) — only the fields this pure module reads, so it works off either the
 * live `Rank` results or the persisted snapshot rows without coupling to D1.
 */
export type RankSnapshot = {
  keyword: string;
  /** 1-based organic position, or null if not in the top results. */
  rank: number | null;
  /** how many apps competed for this term (unused in scoring; kept for parity). */
  total?: number | undefined;
  /** ISO-ish timestamp; used only to order a keyword's history oldest → newest. */
  checked_at: string;
};

export type Reachability = "now" | "soon" | "longshot";

export type OpportunityDrivers = {
  /** 0–100; 100 ≈ rank 1, 0 at rank ≥ 200 / unranked. (measured: your rank) */
  distance: number;
  /** 0–100; 100 = no rivals on the term, 0 = strong incumbents at the top.
   *  (measured: competitor ranks) */
  competitorWeakness: number;
  /** 0–100; 100 = gaining, 50 = flat / no prior, 0 = losing. (measured: rank history) */
  momentum: number;
};

export type Opportunity = {
  keyword: string;
  /** current (latest) rank, 1-based, or null if not in the top results. */
  rank: number | null;
  /** 0–100, weighted over the three measured drivers (distance/competitor-weakness/momentum). */
  opportunityScore: number;
  /**
   * Is `opportunityScore` backed by a MEASURED differentiating signal? `false`
   * when the keyword is unranked AND has no competitor data AND no rank history —
   * then every driver is a default (distance 0, competitorWeakness's no-data 100,
   * momentum's no-history 50) and the score collapses to the same constant (42.5)
   * for every such term. That constant is an ARTIFACT of absent data, not a
   * measurement (#65), so the UI must present it as "not enough data to score",
   * never as a real number. Consumers treat `undefined` (legacy/persisted rows)
   * as scored, so only an explicit `false` hides the number.
   */
  scored: boolean;
  /** human, correlational explanation — "close to top 10, weak competitors, gaining". */
  why: string;
  /** honest reachability bucketing — the hedge that labels (not hides) longshots. */
  reachability: Reachability;
  drivers: OpportunityDrivers;
};

export type RankOpportunityInput = {
  /** your per-keyword rank history rows (any number of snapshots per keyword).
   *  Every keyword present here is ranked — the rank rows ARE the target set, so
   *  we never need an invented per-keyword "score" to decide what to rank (#65). */
  ranks: RankSnapshot[];
  /** optional competitor rank data, same snapshot shape grouped by name. */
  competitorRanks?:
    | Array<{ name: string; ranks: RankSnapshot[] }>
    | undefined;
};

/** The denominator for distance/competitor scaling — the iTunes top-200 window. */
const SCAN_DEPTH = 200;

/** Driver weights over the THREE measured signals (sum to 1.0). Distance (your
 *  own rank, the most direct signal) leads; competitor weakness is second;
 *  momentum is a low-weight tiebreak. No fabricated "volume" term (#65). */
const WEIGHTS = { distance: 0.5, competitorWeakness: 0.35, momentum: 0.15 } as const;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Group rows by keyword and order each group oldest → newest by `checked_at`. */
function groupByKeyword(rows: RankSnapshot[]): Map<string, RankSnapshot[]> {
  const map = new Map<string, RankSnapshot[]>();
  for (const r of rows) {
    const list = map.get(r.keyword);
    if (list) list.push(r);
    else map.set(r.keyword, [r]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.checked_at < b.checked_at ? -1 : a.checked_at > b.checked_at ? 1 : 0));
  }
  return map;
}

/** Distance-to-top driver: rank 1 ≈ 99.5, rank 10 ≈ 95, rank 200/null → 0. */
function distanceScore(rank: number | null): number {
  if (rank === null) return 0;
  return clamp(((SCAN_DEPTH - rank) / SCAN_DEPTH) * 100);
}

/**
 * Competitor-weakness driver from the average competitor rank on this term.
 * No competitors → 100 (open field). Incumbents at the top → low. Deep/absent → high.
 * Scale mirrors distance: (avgRank − 1) / 200 × 100, clamped.
 */
function competitorWeaknessScore(avgCompetitorRank: number | null): number {
  if (avgCompetitorRank === null) return 100;
  return clamp(((avgCompetitorRank - 1) / SCAN_DEPTH) * 100);
}

/** Average rank a set of competitors holds for one keyword (null = none ranked). */
function avgCompetitorRankFor(
  keyword: string,
  competitorRanks: RankOpportunityInput["competitorRanks"],
): number | null {
  if (!competitorRanks || competitorRanks.length === 0) return null;
  const ranks: number[] = [];
  for (const c of competitorRanks) {
    const group = c.ranks.filter((r) => r.keyword === keyword && r.rank !== null);
    if (group.length === 0) continue;
    // use the competitor's latest (last, since groups arrive history-ordered enough
    // for our purposes — but be defensive and take the most recent by timestamp).
    const latest = group.reduce((a, b) => (a.checked_at >= b.checked_at ? a : b));
    if (latest.rank !== null) ranks.push(latest.rank);
  }
  if (ranks.length === 0) return null;
  return ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

/** Momentum driver from the most recent 2 snapshots: gaining 100, flat/new 50, losing 0. */
function momentumScore(historyRows: RankSnapshot[]): number {
  if (historyRows.length < 2) return 50;
  const prev = historyRows[historyRows.length - 2]!;
  const curr = historyRows[historyRows.length - 1]!;
  // Treat unranked as "worse than any rank" so entering/leaving the window reads right.
  const p = prev.rank ?? SCAN_DEPTH + 1;
  const c = curr.rank ?? SCAN_DEPTH + 1;
  if (c < p) return 100; // rank number got smaller → improved
  if (c > p) return 0; // got bigger → lost ground
  return 50; // unchanged
}

/**
 * Reachability bucketing — the honest hedge. Ordered most-winnable → least:
 *  - already top-10 → "now" (you're winning; keep momentum).
 *  - close (≤30) AND weak field → "now" (a very reachable push).
 *  - reachable gap (decent distance + weak field) → "soon".
 *  - unranked but an open field (weak/absent incumbents) → "soon".
 *  - otherwise → "longshot" (far, or strong incumbents — labeled, not hidden).
 */
function reachabilityFor(
  rank: number | null,
  drivers: OpportunityDrivers,
): Reachability {
  const { distance, competitorWeakness } = drivers;
  if (rank !== null && rank <= 10) return "now";
  if (rank !== null && rank <= 30 && distance >= 60 && competitorWeakness >= 50) return "now";
  if (distance >= 60 && competitorWeakness >= 60) return "soon";
  // Unranked but the field is genuinely open (weak/absent incumbents) → a real,
  // reachable push. No fabricated "volume" gate here (#65) — the open field is
  // the measured signal that makes it winnable.
  if (rank === null && competitorWeakness >= 70) return "soon";
  return "longshot";
}

/** A short, correlational explanation. Describes the STATE, never asserts causation. */
function explain(rank: number | null, drivers: OpportunityDrivers, reach: Reachability): string {
  const parts: string[] = [];
  if (rank !== null && rank <= 10) parts.push("already top 10");
  else if (rank !== null && rank <= 30) parts.push("close to top 10");
  else if (rank !== null) parts.push(`currently #${rank}`);
  else parts.push("not yet ranked");

  if (drivers.competitorWeakness >= 70) parts.push("weak/absent competitors");
  else if (drivers.competitorWeakness <= 30) parts.push("strong incumbents");

  if (drivers.momentum === 100) parts.push("gaining");
  else if (drivers.momentum === 0) parts.push("losing ground");

  const lead =
    reach === "now"
      ? "Most winnable next"
      : reach === "soon"
        ? "Reachable with a push"
        : "Longshot";
  return `${lead}: ${parts.join(", ")}.`;
}

/**
 * Score every tracked keyword by winnability (from measured rank signals only)
 * and return them sorted by `opportunityScore` descending. Every keyword present
 * in `ranks` is ranked — no invented per-keyword score gates the list (#65).
 * Pure + deterministic.
 */
export function rankOpportunities(input: RankOpportunityInput): Opportunity[] {
  const byKeyword = groupByKeyword(input.ranks);
  const out: Opportunity[] = [];

  for (const [keyword, rows] of byKeyword) {
    const latest = rows[rows.length - 1]!;
    const rank = latest.rank;

    const drivers: OpportunityDrivers = {
      distance: round2(distanceScore(rank)),
      competitorWeakness: round2(competitorWeaknessScore(avgCompetitorRankFor(keyword, input.competitorRanks))),
      momentum: momentumScore(rows),
    };

    const opportunityScore = round2(
      drivers.distance * WEIGHTS.distance +
        drivers.competitorWeakness * WEIGHTS.competitorWeakness +
        drivers.momentum * WEIGHTS.momentum,
    );

    // The score is a real measurement only if SOME differentiating signal exists:
    // a measured current rank, competitor data for THIS term, or a history that
    // contains at least one real (non-null) rank. Row COUNT alone is NOT a signal
    // (#317): ≥2 all-null snapshots leave momentum at its no-movement default (50),
    // so the score is still the 42.5 artifact — present it as "not enough data".
    const hasCompetitorSignal = (input.competitorRanks ?? []).some((c) =>
      c.ranks.some((r) => r.keyword === keyword),
    );
    const hasRankedHistory = rows.some((r) => r.rank !== null);
    const scored = rank !== null || hasCompetitorSignal || hasRankedHistory;

    const reachability = reachabilityFor(rank, drivers);
    out.push({
      keyword,
      rank,
      opportunityScore,
      scored,
      reachability,
      why: explain(rank, drivers, reachability),
      drivers,
    });
  }

  // Sort by winnability desc; tie-break by keyword for stable, deterministic output.
  out.sort((a, b) =>
    b.opportunityScore !== a.opportunityScore
      ? b.opportunityScore - a.opportunityScore
      : a.keyword < b.keyword
        ? -1
        : a.keyword > b.keyword
          ? 1
          : 0,
  );
  return out;
}
