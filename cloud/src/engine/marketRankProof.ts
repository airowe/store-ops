/**
 * Per-market rank proof (#180 Phase 1) — the thing that makes localization value
 * PROVABLE. Assembles country-scoped rank snapshots into a before/after movement
 * per market, so a localized push can show "since your Japanese localization you
 * climbed +8 for <keyword> in the Japan App Store" — measured, per storefront,
 * never a blended global claim.
 *
 * Honesty, load-bearing:
 *   • each market is measured ONLY from its own `country` snapshots (no blend),
 *   • movement reuses rankAttribution.classifyMovement — the new/lost/up/down/same
 *     vocabulary is single-sourced so two surfaces can't drift,
 *   • a market with < MIN_SNAPSHOTS distinct dates → measured:false (no fabricated
 *     move); a null rank stays unranked, never a fake position,
 *   • findings are CORRELATIONAL — "since your <locale> push", never "caused".
 *
 * Pure: no D1, no network. The caller reads RankSnapshotRow[] (getRankHistory) and
 * passes them in — so this unit-tests with fixtures.
 */
import type { RankSnapshotRow } from "../d1.js";
import { classifyMovement, type MovementDirection } from "./rankAttribution.js";
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";

export const MIN_SNAPSHOTS = 2;
const SURFACE = "localization";

export type MarketKeywordMove = {
  keyword: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  direction: MovementDirection;
};

export type MarketProof = {
  country: string;
  /** ISO of the localized push this window is measured against, when known. */
  since?: string;
  keywords: MarketKeywordMove[];
  /** climbed − dropped across the market's keywords (a summary, not a claim). */
  netImproved: number;
  /** false when the market has < MIN_SNAPSHOTS distinct snapshot dates. */
  measured: boolean;
};

/** ISO-ish string compare works for the "YYYY-MM-DD…" timestamps we store. */
function onOrAfter(checkedAt: string, since: string): boolean {
  return checkedAt.slice(0, since.length) >= since;
}

/**
 * Assemble per-market rank proof. Groups rows by (country, keyword); per keyword
 * takes the earliest-in-window snapshot as `from` and the latest as `to`, and
 * classifies the move. `since[country]` trims that market's window to on/after the
 * localized push date. A market with fewer than MIN_SNAPSHOTS distinct dates is
 * emitted measured:false. Markets sorted by country asc (deterministic).
 */
export function buildMarketProof(
  rows: RankSnapshotRow[],
  opts: { since?: Record<string, string> } = {},
): MarketProof[] {
  // country → keyword → rows (in the market's window), plus the distinct dates.
  const byCountry = new Map<string, { rows: RankSnapshotRow[]; dates: Set<string> }>();
  for (const r of rows) {
    const country = r.country;
    if (!country) continue; // legacy '' rows aren't a real market
    const since = opts.since?.[country];
    if (since && !onOrAfter(r.checked_at, since)) continue; // outside the push window
    if (!byCountry.has(country)) byCountry.set(country, { rows: [], dates: new Set() });
    const bucket = byCountry.get(country)!;
    bucket.rows.push(r);
    bucket.dates.add(r.checked_at);
  }

  const proofs: MarketProof[] = [];
  for (const country of [...byCountry.keys()].sort()) {
    const { rows: mrows, dates } = byCountry.get(country)!;
    const measured = dates.size >= MIN_SNAPSHOTS;

    // per keyword: earliest vs latest snapshot (by checked_at).
    const byKeyword = new Map<string, RankSnapshotRow[]>();
    for (const r of mrows) {
      if (!byKeyword.has(r.keyword)) byKeyword.set(r.keyword, []);
      byKeyword.get(r.keyword)!.push(r);
    }
    const keywords: MarketKeywordMove[] = [];
    for (const [keyword, krows] of byKeyword) {
      krows.sort((a, b) => (a.checked_at < b.checked_at ? -1 : a.checked_at > b.checked_at ? 1 : 0));
      const from = krows[0]!.rank;
      const to = krows[krows.length - 1]!.rank;
      const { delta, direction } = classifyMovement(from, to);
      keywords.push({ keyword, from, to, delta, direction });
    }
    keywords.sort((a, b) => (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0));

    const netImproved =
      keywords.filter((k) => k.direction === "up" || k.direction === "new").length -
      keywords.filter((k) => k.direction === "down" || k.direction === "lost").length;

    proofs.push({
      country,
      ...(opts.since?.[country] ? { since: opts.since[country] } : {}),
      keywords,
      netImproved,
      measured,
    });
  }
  return proofs;
}

const upper = (c: string) => c.toUpperCase();

/**
 * Turn measured market proofs into findings. Only a `measured` market with at
 * least one real move produces a finding — quoting THAT market's own numbers,
 * correlational ("since your <locale> localization"), never "caused". Unmeasured
 * markets are silent (no noise).
 */
export function marketProofFindings(
  proofs: MarketProof[],
  opts: { locales?: Record<string, string> } = {},
): Finding[] {
  const out: Finding[] = [];
  for (const p of proofs) {
    if (!p.measured) continue;
    const moved = p.keywords.filter((k) => k.direction !== "same");
    if (moved.length === 0) continue;

    const up = p.keywords.filter((k) => k.direction === "up" || k.direction === "new").length;
    const down = p.keywords.filter((k) => k.direction === "down" || k.direction === "lost").length;
    const locale = opts.locales?.[p.country];
    const sinceClause = p.since ? ` since ${p.since}` : "";
    const localeClause = locale ? ` ${locale} localization` : " localization";

    out.push(
      mk({
        id: `market_rank_proof_${p.country}`,
        surface: SURFACE,
        severity: "info",
        impact: "conversion",
        title: `Measured rank movement in the ${upper(p.country)} App Store`,
        detail:
          `Following your${localeClause}${sinceClause}, ${up} keyword(s) climbed and ${down} slipped in the ` +
          `${upper(p.country)} storefront (net ${p.netImproved >= 0 ? "+" : ""}${p.netImproved}). These are that ` +
          `market's own measured ranks — a correlational before/after, not a causal claim.`,
        fix:
          p.netImproved > 0
            ? "Keep the localized copy; consider localizing your next market."
            : "Give it more time, or revisit the localized keywords for this market.",
        evidence: `measured in ${p.country}; ${p.keywords.length} keyword(s) tracked`,
        context: true,
      }),
    );
  }
  return out;
}
