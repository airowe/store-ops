/**
 * App Store organic rank — ported from aso_rank_check.py.
 *
 * The app's 1-based index in the iTunes Search `results[]` for a term IS its
 * organic rank for that term. Absent from the (≤200) results => not in top 200
 * (rank = null). One keyword's failure does NOT abort the batch — it returns a
 * row with `.error` set, mirroring the Python `ranks_for` resilience contract.
 */
import { ITUNES_MAX_LIMIT, ITUNES_SEARCH_URL } from "./constants.js";
import {
  asResponse,
  buildUrl,
  type FetchFn,
  fetchJson,
  ItunesError,
  sleep,
} from "./itunes.js";

export type Rank = {
  keyword: string;
  /** 1-based organic position, or null if not in the top `limit` results. */
  rank: number | null;
  /** the app's listed name at that rank (sanity check). */
  foundName: string;
  /** how many apps competed for this term (resultCount). */
  total: number;
  /** how deep we scanned (1..200). */
  limit: number;
  /** non-empty if this keyword's fetch failed (batch goes on). */
  error: string;
};

function cap(limit: number): number {
  return Math.max(1, Math.min(limit, ITUNES_MAX_LIMIT));
}

/** Fetch one term and locate `bundleId` in the ranked results. */
export async function rankFor(
  fetchFn: FetchFn,
  bundleId: string,
  keyword: string,
  { country = "US", limit = ITUNES_MAX_LIMIT }: { country?: string; limit?: number } = {},
): Promise<Rank> {
  const capped = cap(limit);
  const url = buildUrl(ITUNES_SEARCH_URL, {
    term: keyword,
    country,
    entity: "software",
    limit: capped,
  });
  const data = asResponse(await fetchJson(fetchFn, url));
  const results = data.results ?? [];
  const total = data.resultCount ?? results.length;
  for (let i = 0; i < results.length; i++) {
    const app = results[i];
    if (app && app.bundleId === bundleId) {
      return {
        keyword,
        rank: i + 1,
        foundName: app.trackName ?? "",
        total,
        limit: capped,
        error: "",
      };
    }
  }
  return { keyword, rank: null, foundName: "", total, limit: capped, error: "" };
}

/**
 * Rank every keyword. A single keyword's failure becomes a row with `.error`
 * set (never throws for one bad term) — ported from `ranks_for`. `pauseMs`
 * spaces calls to be polite to the public endpoint.
 */
export async function ranksFor(
  fetchFn: FetchFn,
  bundleId: string,
  keywords: string[],
  {
    country = "US",
    limit = ITUNES_MAX_LIMIT,
    pauseMs = 300,
  }: { country?: string; limit?: number; pauseMs?: number } = {},
): Promise<Rank[]> {
  const capped = cap(limit);
  const out: Rank[] = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i] as string;
    try {
      out.push(await rankFor(fetchFn, bundleId, kw, { country, limit: capped }));
    } catch (e) {
      out.push({
        keyword: kw,
        rank: null,
        foundName: "",
        total: 0,
        limit: capped,
        error: e instanceof ItunesError ? e.message : String(e),
      });
    }
    if (i + 1 < keywords.length && pauseMs > 0) await sleep(pauseMs);
  }
  return out;
}
