import type { AgentResult } from "./agent.js";
import { buildReportBreakdown, type ReportFieldScore } from "./reportBreakdown.js";

/**
 * A teaser-safe slice of a run for LOGGED-OUT visitors (try-before-signup).
 *
 * Shows enough real signal to earn trust — the app's audit grade, its best
 * organic rank, how many keywords were checked and how many crack the top 10,
 * plus a small ranked sample and a per-field scored breakdown — while
 * WITHHOLDING the payoff (the optimized copy proposal + push commands + full
 * keyword reasoning), which is what signing up unlocks. Pure: no DB, no network,
 * no auth.
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
  /** per-field scored breakdown (the public report card) — measured or unreadable. */
  breakdown: ReportFieldScore[];
  /**
   * composite 0–100 over the fields we could MEASURE (unreadable fields are
   * excluded from both numerator and denominator — the score reflects what's
   * knowable, never penalizing for what the public page didn't expose).
   */
  score: number | null;
};

const SAMPLE_SIZE = 5;

/** Composite 0–100 from the measurable fields only (null when nothing measured). */
function compositeScore(breakdown: ReportFieldScore[]): number | null {
  const measured = breakdown.filter((f) => f.state === "measured" && f.score !== null);
  if (measured.length === 0) return null;
  const got = measured.reduce((s, f) => s + (f.score ?? 0), 0);
  const max = measured.reduce((s, f) => s + f.max, 0);
  return max === 0 ? null : Math.round((got / max) * 100);
}

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
  const breakdown = result.audit ? buildReportBreakdown(result.audit) : [];

  return {
    appName: result.audit?.liveName || result.audit?.app || "",
    auditGrade: result.audit?.screenshots?.grade ?? null,
    leadKeyword: lead?.keyword ?? null,
    leadRank: lead?.rank ?? null,
    keywordsChecked: ranks.length,
    inTop10,
    sample: ranks.slice(0, SAMPLE_SIZE).map((r) => ({ keyword: r.keyword, rank: r.rank })),
    breakdown,
    score: compositeScore(breakdown),
  };
}
