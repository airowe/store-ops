import type { AgentResult } from "./agent.js";

/**
 * A teaser-safe slice of a run for LOGGED-OUT visitors (try-before-signup).
 *
 * Shows enough real signal to earn trust — the app's audit grade, its best
 * organic rank, how many keywords were checked and how many crack the top 10,
 * plus a small ranked sample — while WITHHOLDING the payoff (the optimized copy
 * proposal + push commands + full keyword reasoning), which is what signing up
 * unlocks. Pure: no DB, no network, no auth.
 */
export type AppPreview = {
  appName: string;
  auditGrade: string | null;
  leadKeyword: string | null;
  leadRank: number | null;
  keywordsChecked: number;
  inTop10: number;
  /** a short ranked sample (keyword + position), enough to feel real */
  sample: { keyword: string; rank: number | null }[];
};

const SAMPLE_SIZE = 5;

export function buildPreview(result: AgentResult): AppPreview {
  const ranks = result.ranks ?? [];

  // best (lowest) non-null rank is the "lead"
  let lead: { keyword: string; rank: number } | null = null;
  for (const r of ranks) {
    if (r.rank !== null && (lead === null || r.rank < lead.rank)) {
      lead = { keyword: r.keyword, rank: r.rank };
    }
  }

  const inTop10 = ranks.filter((r) => r.rank !== null && r.rank <= 10).length;

  return {
    appName: result.audit?.liveName || result.audit?.app || "",
    auditGrade: result.audit?.screenshots?.grade ?? null,
    leadKeyword: lead?.keyword ?? null,
    leadRank: lead?.rank ?? null,
    keywordsChecked: ranks.length,
    inTop10,
    sample: ranks.slice(0, SAMPLE_SIZE).map((r) => ({ keyword: r.keyword, rank: r.rank })),
  };
}
