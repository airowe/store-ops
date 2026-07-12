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

import { asResponse, buildUrl, fetchJson, type FetchFn } from "./itunes.js";
import { ITUNES_MAX_LIMIT, ITUNES_SEARCH_URL } from "./constants.js";

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
    // A single-WORD app name is that app's OWN brand — never a transferable term.
    // Decide "single word" from the RAW name, not the stopword-filtered tokens:
    // "Weather App" / "Sleep Pro" are two words, so "weather" / "sleep" are real
    // market terms, not brands (filtering first would wrongly drop them).
    const nameTokens = tokenize(name);
    const oneWordName = name.split(/\s+/).filter(Boolean).length === 1;
    const ownBrand = oneWordName ? new Set(nameTokens) : new Set<string>();
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read locale-native keyword candidates for a TARGET market (#180 Phase 3): for
 * each seed term, search that storefront's App Store and harvest the top apps'
 * names — the terms real apps in that country actually use. The iTunes Search API
 * returns `trackName` (the locale-native name); subtitle isn't exposed there, so
 * we extract from names only (we surface what we measure, never invent).
 *
 * Best-effort + safe-degrade: a failed search for one seed is skipped (never
 * throws), apps are de-duped by trackId so an app that ranks for several seeds is
 * counted once, and the result runs through the pure `extractLocaleKeywords`. An
 * empty/failed sweep returns [] — no candidates, never a fabricated one.
 */
export async function readLocaleKeywords(
  fetchFn: FetchFn,
  opts: {
    market: string;
    seeds: string[];
    brandTokens?: string[] | undefined;
    existingTerms?: string[] | undefined;
    limit?: number | undefined;
    pauseMs?: number | undefined;
  },
): Promise<LocaleKeywordCandidate[]> {
  const market = opts.market.trim();
  const limit = Math.max(1, Math.min(opts.limit ?? 25, ITUNES_MAX_LIMIT));
  const pauseMs = opts.pauseMs ?? 300;
  const seeds = [...new Set(opts.seeds.map((s) => s.trim()).filter((s) => s.length > 0))];

  const byTrackId = new Map<number, MarketListing>();
  const seen = new Set<string>(); // fallback key when trackId is absent
  for (let i = 0; i < seeds.length; i++) {
    try {
      const url = buildUrl(ITUNES_SEARCH_URL, { term: seeds[i]!, country: market, entity: "software", limit });
      const results = asResponse(await fetchJson(fetchFn, url)).results ?? [];
      for (const r of results) {
        const listing: MarketListing = { name: r.trackName ?? "" };
        if (typeof r.trackId === "number") byTrackId.set(r.trackId, listing);
        else if (listing.name && !seen.has(listing.name)) {
          seen.add(listing.name);
          byTrackId.set(-byTrackId.size - 1, listing); // synthetic key for id-less rows
        }
      }
    } catch {
      // a failed seed search is skipped — best-effort, never strands the sweep
    }
    if (i + 1 < seeds.length && pauseMs > 0) await sleep(pauseMs);
  }

  return extractLocaleKeywords(market, [...byTrackId.values()], {
    ...(opts.brandTokens !== undefined ? { brandTokens: opts.brandTokens } : {}),
    ...(opts.existingTerms !== undefined ? { existingTerms: opts.existingTerms } : {}),
  });
}
