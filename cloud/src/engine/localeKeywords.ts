/**
 * Locale-native keyword extraction (#180 Phase 3, the differentiated core).
 *
 * The failure LocalizeRank markets against is shipping TRANSLATED en-US keywords
 * as "localization." The honest alternative: the terms real apps ALREADY USE in
 * that storefront. This extracts candidate keywords from the name/subtitle of the
 * top apps in a TARGET market — measured, locale-native by construction (they
 * came from that country's store), never a translation of your English set.
 *
 * Honesty, load-bearing:
 *   • every candidate is a term a MEASURED competitor in that market visibly uses
 *     — attributed to the apps that use it, never invented or machine-translated,
 *   • your own brand + the terms you already target are excluded (not new signal),
 *   • a competitor's OWN brand word is excluded (not a transferable keyword),
 *   • granularity honesty: extraction is whitespace/punctuation-delimited, so
 *     space-less scripts (JP/ZH) yield coarser segments — we surface what the
 *     listings measurably contain and never claim finer tokenization than we did.
 *
 * Pure + deterministic. The per-storefront SEARCH that produces the listings is
 * a separate reader (run-path wiring is the follow-up); this is the extraction,
 * unit-testable with plain listing objects.
 */

/** A locale-native keyword candidate, attributed to the market apps that use it. */
export type LocaleKeywordCandidate = {
  /** the candidate term, lowercased. */
  term: string;
  /** the storefront it was measured in (lowercased ISO, e.g. "jp"). */
  market: string;
  /** how many of the market's top apps visibly use it. */
  usedByCount: number;
  /** the names of those apps — the attribution behind the candidate. */
  usedBy: string[];
};

/** A minimal listing shape (matches competitorWatch `Listing`, only what we read). */
export type MarketListing = { name?: string | undefined; subtitle?: string | undefined; error?: string | undefined };

/** Cross-language low-signal words that never make a useful keyword. */
const STOPWORDS = new Set([
  "app", "apps", "the", "and", "for", "with", "your", "you", "pro", "plus",
  "lite", "free", "new", "get", "top", "best", "all", "any", "our", "this",
]);

/** Whitespace/punctuation-delimited tokens, lowercased, length ≥ 2, non-stopword. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Extract locale-native keyword candidates from a target market's top-app
 * listings. Excludes your brand + your existing targets + each competitor's own
 * brand word. Returns candidates sorted by usage (desc), then term (asc) — fully
 * deterministic. Empty when no listings carry usable, non-excluded terms.
 */
export function extractLocaleKeywords(
  market: string,
  listings: MarketListing[],
  opts: { brandTokens?: string[]; existingTerms?: string[] } = {},
): LocaleKeywordCandidate[] {
  const mkt = market.trim().toLowerCase();
  const excluded = new Set<string>();
  for (const b of opts.brandTokens ?? []) for (const t of tokenize(b)) excluded.add(t);
  for (const e of opts.existingTerms ?? []) for (const t of tokenize(e)) excluded.add(t);

  const usage = new Map<string, Set<string>>(); // term → set of app names using it
  for (const l of listings) {
    if (!l || l.error) continue;
    const name = (l.name ?? "").trim();
    const subtitle = (l.subtitle ?? "").trim();
    if (!name && !subtitle) continue;
    // A single-word app name is that app's OWN brand — never a transferable term.
    const nameTokens = tokenize(name);
    const ownBrand = nameTokens.length === 1 ? new Set(nameTokens) : new Set<string>();
    const terms = new Set([...nameTokens, ...tokenize(subtitle)]);
    for (const term of terms) {
      if (excluded.has(term) || ownBrand.has(term)) continue;
      if (!usage.has(term)) usage.set(term, new Set());
      usage.get(term)!.add(name || "(unnamed)");
    }
  }

  const candidates: LocaleKeywordCandidate[] = [];
  for (const [term, apps] of usage) {
    candidates.push({ term, market: mkt, usedByCount: apps.size, usedBy: [...apps].sort() });
  }
  candidates.sort((a, b) => b.usedByCount - a.usedByCount || a.term.localeCompare(b.term));
  return candidates;
}
