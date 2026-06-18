/**
 * Rank opportunity score — PRD 06 (`docs/prd/ranking-features/06-rank-opportunity-score.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE ranker that scores each tracked keyword by
 * WINNABILITY — not raw volume — so users chase reachable gains instead of vanity
 * terms. It fuses four signals we already compute:
 *   • volume          — the keyword's composite score (`scoreKeyword`, 0–100).
 *   • distance         — how close you are to the top (closer = more winnable).
 *   • competitorWeakness — weak/absent rivals on the term = more winnable.
 *   • momentum         — already gaining = momentum to ride (a tiebreak, low weight).
 *
 * The headline output is `opportunityScore` (0–100) plus a `reachability` enum
 * ("now" | "soon" | "longshot"). The enum is the HONEST HEDGE: a #200 weak app on
 * "games" against three giant incumbents is labeled "longshot" — never "now" — so
 * the user chooses with eyes open. The score is a heuristic framed as "most
 * winnable next," NOT a guarantee or a causal claim.
 *
 * HARD CONSTRAINTS (carried from the suite overview):
 *  - No fetch / Date.now / randomness — same input → identical output.
 *  - Winnability over vanity volume: distance + competitor weakness are
 *    first-class terms so a far/strong-incumbent term can't top the list on volume.
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
  /** 0–100, the keyword's composite score (volume·0.4 + …). */
  volume: number;
  /** 0–100; 100 ≈ rank 1, 0 at rank ≥ 200 / unranked. */
  distance: number;
  /** 0–100; 100 = no rivals on the term, 0 = strong incumbents at the top. */
  competitorWeakness: number;
  /** 0–100; 100 = gaining, 50 = flat / no prior, 0 = losing. */
  momentum: number;
};

export type Opportunity = {
  keyword: string;
  /** current (latest) rank, 1-based, or null if not in the top results. */
  rank: number | null;
  /** 0–100, winnability-weighted (NOT raw volume). */
  opportunityScore: number;
  /** human, correlational explanation — "close to top 10, weak competitors, gaining". */
  why: string;
  /** honest reachability bucketing — the hedge that labels (not hides) longshots. */
  reachability: Reachability;
  drivers: OpportunityDrivers;
};

export type RankOpportunityInput = {
  /** your per-keyword rank history rows (any number of snapshots per keyword). */
  ranks: RankSnapshot[];
  /** keyword → 0–100 composite score (from `scoreKeyword`). */
  keywordScores: Record<string, number>;
  /** optional competitor rank data, same snapshot shape grouped by name. */
  competitorRanks?:
    | Array<{ name: string; ranks: RankSnapshot[] }>
    | undefined;
};

/** The denominator for distance/competitor scaling — the iTunes top-200 window. */
const SCAN_DEPTH = 200;

/** Driver weights — distance + competitor weakness outweigh raw volume on purpose
 *  so a far/strong term can't win on volume alone. momentum is a low-weight tiebreak. */
const WEIGHTS = { volume: 0.4, distance: 0.3, competitorWeakness: 0.2, momentum: 0.1 } as const;

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
 *  - unranked but high-volume winnable field → "soon".
 *  - otherwise → "longshot" (far, or strong incumbents — labeled, not hidden).
 */
function reachabilityFor(
  rank: number | null,
  drivers: OpportunityDrivers,
): Reachability {
  const { distance, competitorWeakness, volume } = drivers;
  if (rank !== null && rank <= 10) return "now";
  if (rank !== null && rank <= 30 && distance >= 60 && competitorWeakness >= 50) return "now";
  if (distance >= 60 && competitorWeakness >= 60) return "soon";
  if (rank === null && volume >= 50 && competitorWeakness >= 50) return "soon";
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

  if (drivers.volume >= 60) parts.push("high search volume");

  const lead =
    reach === "now"
      ? "Most winnable next"
      : reach === "soon"
        ? "Reachable with a push"
        : "Longshot";
  return `${lead}: ${parts.join(", ")}.`;
}

/**
 * Score every tracked keyword by winnability and return them sorted by
 * `opportunityScore` descending. A keyword with no `keywordScores` entry is
 * skipped (we never invent a volume we don't have). Pure + deterministic.
 */
export function rankOpportunities(input: RankOpportunityInput): Opportunity[] {
  const byKeyword = groupByKeyword(input.ranks);
  const out: Opportunity[] = [];

  for (const [keyword, rows] of byKeyword) {
    const volume = input.keywordScores[keyword];
    // Degrade gracefully: no score for this term → not an opportunity we can rank.
    if (volume === undefined) continue;

    const latest = rows[rows.length - 1]!;
    const rank = latest.rank;

    const drivers: OpportunityDrivers = {
      volume: clamp(volume),
      distance: round2(distanceScore(rank)),
      competitorWeakness: round2(competitorWeaknessScore(avgCompetitorRankFor(keyword, input.competitorRanks))),
      momentum: momentumScore(rows),
    };

    const opportunityScore = round2(
      drivers.volume * WEIGHTS.volume +
        drivers.distance * WEIGHTS.distance +
        drivers.competitorWeakness * WEIGHTS.competitorWeakness +
        drivers.momentum * WEIGHTS.momentum,
    );

    const reachability = reachabilityFor(rank, drivers);
    out.push({
      keyword,
      rank,
      opportunityScore,
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
