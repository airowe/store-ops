/**
 * Portfolio summary — the PURE fleet-level reduction behind the multi-app
 * dashboard (a `fleet`-tier feature). This module has no DB and no network: the
 * API layer assembles one `AppCard` per app (folding in each app's latest run —
 * the audit grade, the lead keyword/rank, and whether a run is sitting on the
 * human approval gate) and hands the array here to be summarized.
 *
 * Keeping the aggregation pure means the histogram + counting logic is unit
 * tested directly against in-memory fixtures, and the endpoint just wires
 * `summarizePortfolio` to the rows it already fetches for `GET /apps`.
 */

/** One app's row in the portfolio grid. Mirrors what `GET /apps` exposes per app. */
export type AppCard = {
  appId: string;
  name: string;
  /** Latest audit screenshot grade letter (e.g. "A"…"F"), or null if never audited. */
  grade: string | null;
  /** The app's headline tracked keyword, or null if nothing is tracked. */
  leadKeyword: string | null;
  /** Current rank for the lead keyword (lower is better), or null if untracked/unranked. */
  leadRank: number | null;
  /** True when a run is awaiting the human approval gate. */
  pendingApproval: boolean;
};

/** Fleet-level rollup shown at the top of the portfolio dashboard. */
export type PortfolioSummary = {
  totalApps: number;
  pendingApprovals: number;
  /** Histogram of grade letters across graded apps; null grades are omitted. */
  gradeBreakdown: Record<string, number>;
  /** Apps that have a non-null leadRank (i.e. we're actively tracking a rank). */
  appsTracked: number;
  /** The cards, in the same order they were supplied. */
  cards: AppCard[];
};

/**
 * Reduce the per-app cards into the portfolio summary. Pure and deterministic:
 * the output `cards` preserve input order, and the counts are a single pass.
 */
export function summarizePortfolio(cards: AppCard[]): PortfolioSummary {
  const gradeBreakdown: Record<string, number> = {};
  let pendingApprovals = 0;
  let appsTracked = 0;

  for (const card of cards) {
    if (card.pendingApproval) pendingApprovals++;
    if (card.leadRank !== null) appsTracked++;
    if (card.grade !== null) {
      gradeBreakdown[card.grade] = (gradeBreakdown[card.grade] ?? 0) + 1;
    }
  }

  return {
    totalApps: cards.length,
    pendingApprovals,
    gradeBreakdown,
    appsTracked,
    cards,
  };
}
