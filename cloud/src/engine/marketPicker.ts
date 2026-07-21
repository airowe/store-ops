/**
 * Market picker (#180 Phase 2) — turn measured language coverage into an explicit
 * "your next N markets" recommendation. Thin wrapper over
 * recommendLocalesFromLanguages (the shipped ROI heuristic): it filters out
 * markets already localized and caps the list.
 *
 * Honesty: every pick's reason is the recommendation's own `rationale` — a
 * market/language descriptor derived from measured coverage + category, NEVER a
 * fabricated market-size / TAM number (the exact thing LocalizeRank-style services
 * invent). Empty coverage → no picks (no guessed markets).
 */
import { recommendLocalesFromLanguages } from "./languageCoverage.js";
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";

const SURFACE = "localization";
const DEFAULT_LIMIT = 3;

export type MarketPick = { locale: string; reason: string };

export function pickMarkets(input: {
  currentLanguages: string[];
  categoryName?: string;
  /** approved/live locales — never re-recommended. */
  alreadyLocalized: string[];
  limit?: number;
}): MarketPick[] {
  const { recommendations } = recommendLocalesFromLanguages({
    languages: input.currentLanguages,
    ...(input.categoryName !== undefined ? { category: input.categoryName } : {}),
  });
  const already = new Set(input.alreadyLocalized.map((l) => l.toLowerCase()));
  const limit = input.limit ?? DEFAULT_LIMIT;
  return recommendations
    .filter((r) => !already.has(r.locale.toLowerCase()))
    .slice(0, limit)
    .map((r) => ({ locale: r.locale, reason: r.rationale }));
}

/**
 * One "your next markets" finding listing the picks + their measured reasons.
 * No picks → no finding (silent).
 */
export function marketPickerFindings(picks: MarketPick[]): Finding[] {
  if (picks.length === 0) return [];
  const list = picks.map((p) => `${p.locale} (${p.reason})`).join("; ");
  return [
    mk({
      id: "localization_next_markets",
      surface: SURFACE,
      severity: "info",
      impact: "conversion",
      title: `Your next ${picks.length} market${picks.length === 1 ? "" : "s"} to localize`,
      detail:
        `Based on your measured language coverage and category, consider: ${list}. ` +
        `These are reasoned from coverage gaps, not market-size estimates — we don't invent TAM numbers.`,
      fix: "Localize the highest-fit market next, then measure its rank before/after.",
      evidence: `${picks.length} recommended from measured coverage`,
      context: true,
    }),
  ];
}
