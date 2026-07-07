/**
 * Competitor discovery — storefront-intel PRD 02
 * (`docs/prd/storefront-intel/02-similar-apps-discovery.md`).
 *
 * Two honest discovery sources, one shared shape:
 *  - "search"        — apps that surface for the user's tracked keyword searches
 *                      (#72-C; the function lives in competitorWatch.ts and is
 *                      re-exported here so both sources sit under one import).
 *  - "apple_similar" — Apple's OWN "You Might Also Like" shelf, parsed once per
 *                      audit into `StorefrontListing.similarApps`. An ASSOCIATION
 *                      signal, never measured keyword competition — so
 *                      `matchedKeywords` stays `[]` and is never invented.
 *
 * The compounding win is downstream: apple_similar entries carry the one field
 * the iTunes lookup API never returns — the competitor's SUBTITLE — which finally
 * gives `findKeywordGaps` real subtitle text to tokenize.
 *
 * Pure + FetchFn-injected. No bindings. Never throws on a failing fetch.
 */
import type { DiscoveredCompetitor as SearchDiscovered } from "./competitorWatch.js";
import type { StorefrontApp } from "./storefrontListing.js";
import { asResponse, buildUrl, fetchJson, type FetchFn } from "./itunes.js";
import { ITUNES_LOOKUP_URL } from "./constants.js";

export { discoverCompetitors } from "./competitorWatch.js";

export type DiscoverySource = "search" | "apple_similar";

export type DiscoveredCompetitor = {
  /** App Store trackId, stringified — the watch key `lookup` uses (comp_key). */
  key: string;
  name: string;
  source: DiscoverySource;
  /** search-derived only; `[]` for apple_similar (an association, not a match). */
  matchedKeywords: string[];
  /** apple_similar only, when the shelf carried one — the term-gap fuel. */
  subtitle?: string;
  /** as shown on Apple's page at read time; absent → unknown, never 0. */
  rating?: number;
  ratingCount?: number;
};

/** Adapt a search-derived row (no source) into the unified shape. */
export function asSearchCompetitor(d: SearchDiscovered): DiscoveredCompetitor {
  return { key: d.key, name: d.name, source: "search", matchedKeywords: d.matchedKeywords };
}

const fold = (s: string) => s.trim().toLowerCase();

/**
 * Pure: drop the app itself (by bundleId, else by folded name), dedupe by
 * bundleId, cap. No network. Order preserved (Apple's shelf order is meaningful).
 */
export function filterSimilarApps(
  similar: StorefrontApp[],
  opts: { selfBundleId?: string; selfName?: string; limit?: number } = {},
): StorefrontApp[] {
  const limit = opts.limit ?? 16;
  const selfName = opts.selfName ? fold(opts.selfName) : undefined;
  const seen = new Set<string>();
  const out: StorefrontApp[] = [];
  for (const app of similar) {
    if (opts.selfBundleId && app.bundleId === opts.selfBundleId) continue;
    if (selfName && fold(app.name) === selfName) continue;
    if (seen.has(app.bundleId)) continue;
    seen.add(app.bundleId);
    out.push(app);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Resolve a bundleId to its App Store trackId via iTunes lookup (the top
 * result's trackId), or null. Never throws — mirrors resolveNameToId.
 */
export async function resolveBundleToId(
  fetchFn: FetchFn,
  bundleId: string,
  { country = "US" }: { country?: string } = {},
): Promise<string | null> {
  try {
    const url = buildUrl(ITUNES_LOOKUP_URL, { bundleId, country });
    const tid = asResponse(await fetchJson(fetchFn, url)).results?.[0]?.trackId;
    return tid ? String(tid) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve filtered similar apps to watchable competitors: bundleId → trackId so
 * keys dedupe against search-derived rows. An entry that won't resolve is
 * SKIPPED (never a half-row). Never throws.
 */
export async function resolveSimilarCompetitors(
  fetchFn: FetchFn,
  similar: StorefrontApp[],
  opts: { selfBundleId?: string; selfName?: string; country?: string; limit?: number } = {},
): Promise<DiscoveredCompetitor[]> {
  const filtered = filterSimilarApps(similar, opts);
  const out: DiscoveredCompetitor[] = [];
  const seenKeys = new Set<string>();
  for (const app of filtered) {
    const key = await resolveBundleToId(
      fetchFn,
      app.bundleId,
      opts.country ? { country: opts.country } : {},
    );
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({
      key,
      name: app.name,
      source: "apple_similar",
      matchedKeywords: [],
      ...(app.subtitle !== undefined ? { subtitle: app.subtitle } : {}),
      ...(app.rating !== undefined ? { rating: app.rating } : {}),
      ...(app.ratingCount !== undefined ? { ratingCount: app.ratingCount } : {}),
    });
  }
  return out;
}
