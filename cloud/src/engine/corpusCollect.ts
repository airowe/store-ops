/**
 * Category rank+metadata corpus collection (#63) — the compounding data moat.
 *
 * Searches a small fixed set of broad category seed keywords on the App Store and
 * records the top-N apps + their VISIBLE metadata, category-tagged, once a day.
 * Over months this becomes a "movers & shakers" dataset nobody can buy
 * retroactively — the only way to answer "what did apps that climbed for X do" at
 * scale is to have recorded it ourselves starting now.
 *
 * Honesty, load-bearing:
 *   • VISIBLE fields only — iTunes exposes name/version/description/rating/
 *     category/rank, but NOT subtitle or the keyword field. Every downstream use
 *     (incl. #64) must state the picture is partial. We never fabricate the fields
 *     we can't see.
 *   • a rank we couldn't read is `null` (beyond the cap), never a fake 0,
 *   • a result with no bundleId is dropped — no corpus row without app identity.
 *
 * Pure mapper (`observationsFromResults`) + a thin fetch orchestrator
 * (`collectCorpus`) over the injected FetchFn, mirroring rankCheck's shape so it
 * unit-tests with a fake fetch and no Worker runtime.
 */
import { ITUNES_MAX_LIMIT, ITUNES_SEARCH_URL } from "./constants.js";
import { asResponse, buildUrl, fetchJson, ItunesError, sleep, type FetchFn, type ItunesResult } from "./itunes.js";

/**
 * A small, FIXED set of broad category seeds. Deliberately not user-driven, so
 * enabling collection can never fan out unboundedly. Widen with eyes open once
 * ToS/egress are reviewed.
 */
export const CORPUS_SEEDS = [
  "weather",
  "meal planner",
  "budget",
  "meditation",
  "habit tracker",
  "photo editor",
  "workout",
  "language learning",
  "podcast",
  "notes",
] as const;

/** Default conservative caps for the OFF-by-default first run. */
export const DEFAULT_TOP_N = 20;
export const DEFAULT_COUNTRY = "us";

/** One observed app for one seed keyword — VISIBLE fields only. */
export type CorpusObservation = {
  seedKeyword: string;
  country: string;
  bundleId: string;
  trackId?: number;
  name: string;
  categoryId: string;
  categoryName: string;
  /** 1-based position in the seed's search results; null = beyond the cap. */
  rank: number | null;
  version: string;
  rating: number | null;
  ratingCount: number | null;
  description: string;
};

/**
 * Pure: one seed's raw iTunes results → cleaned, capped observations. Rank is the
 * ORIGINAL 1-based search position (so a dropped no-bundleId result still shifts
 * the ranks of those after it — the position is what it is on the store). Results
 * beyond `topN` are cut. Missing rating/version/description coerce to null/"".
 */
export function observationsFromResults(
  seedKeyword: string,
  country: string,
  results: ItunesResult[],
  opts: { topN: number },
): CorpusObservation[] {
  const out: CorpusObservation[] = [];
  for (let i = 0; i < results.length && out.length < opts.topN; i++) {
    const r = results[i];
    if (!r || !r.bundleId) continue; // no identity → not a corpus row
    out.push({
      seedKeyword,
      country,
      bundleId: r.bundleId,
      ...(r.trackId !== undefined ? { trackId: r.trackId } : {}),
      name: r.trackName ?? "",
      categoryId: r.primaryGenreId ?? "",
      categoryName: r.primaryGenreName ?? "",
      rank: i + 1,
      version: r.version ?? "",
      rating: r.averageUserRating ?? null,
      ratingCount: r.userRatingCount ?? null,
      description: r.description ?? "",
    });
  }
  return out;
}

/**
 * Search each seed, map to observations, honor caps + pacing. A single seed's
 * failure is isolated (logged-shaped as skipped) — one bad seed never aborts the
 * whole run. Reuses the exact iTunes fetch + pause idiom as ranksFor.
 */
export async function collectCorpus(
  fetchFn: FetchFn,
  seeds: readonly string[],
  opts: { country?: string; topN?: number; pauseMs?: number } = {},
): Promise<CorpusObservation[]> {
  const country = opts.country ?? DEFAULT_COUNTRY;
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const pauseMs = opts.pauseMs ?? 300;
  const limit = Math.min(Math.max(topN, 1), ITUNES_MAX_LIMIT);

  const out: CorpusObservation[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i] as string;
    try {
      const url = buildUrl(ITUNES_SEARCH_URL, { term: seed, country, entity: "software", limit });
      const data = asResponse(await fetchJson(fetchFn, url));
      out.push(...observationsFromResults(seed, country, data.results ?? [], { topN }));
    } catch (e) {
      // Isolated: skip this seed. Not thrown — a bad seed must not lose the rest.
      if (!(e instanceof ItunesError) && !(e instanceof Error)) throw e;
    }
    if (i + 1 < seeds.length && pauseMs > 0) await sleep(pauseMs);
  }
  return out;
}
