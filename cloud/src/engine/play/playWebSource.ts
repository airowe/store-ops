/**
 * "Our own" Google Play data provider — the FETCH half.
 *
 * Google Play has no free keyless Lookup API (unlike iTunes), so this provider
 * reads the PUBLIC Play web pages directly. Per the implementation plan this is
 * the ToS-sensitive / brittle path; we isolate it behind an injectable source so
 * the engine stays pure and the parser (the other half, `playListingParse.ts`)
 * unit-tests against fixtures with no network.
 *
 * Faithful to the iTunes layer's posture: retry transient failures (incl. 403,
 * which datacenter / Cloudflare-Worker egress hits constantly on Google) with
 * exponential backoff, honoring Retry-After. Returns RAW HTML text — the page's
 * embedded `application/ld+json` + Open Graph tags are parsed downstream.
 */
import { BACKOFF_BASE, MAX_RETRIES, RETRY_STATUS, USER_AGENT } from "../constants.js";
import { type FetchFn, buildUrl, sleep } from "../itunes.js";

export const PLAY_DETAIL_URL = "https://play.google.com/store/apps/details";
export const PLAY_SEARCH_URL = "https://play.google.com/store/search";

/** Per-request options shared by detail + search reads. */
export type PlayPageOpts = { country?: string; lang?: string };

/** Build the public Play listing-detail URL for a package id. */
export function playDetailUrl(packageName: string, opts: PlayPageOpts = {}): string {
  const { country = "US", lang = "en" } = opts;
  return buildUrl(PLAY_DETAIL_URL, { id: packageName, gl: country, hl: lang });
}

/** Build the public Play app-search URL for a free-text term. */
export function playSearchUrl(term: string, opts: PlayPageOpts = {}): string {
  const { country = "US", lang = "en" } = opts;
  return buildUrl(PLAY_SEARCH_URL, { q: term, c: "apps", gl: country, hl: lang });
}

export class PlayError extends Error {}

/** Statuses whose error message should propagate as retryable (mirrors itunes). */
const RETRYABLE_MSG = /HTTP (403|429|500|502|503|504)/;

/**
 * Fetch one URL as raw text, retrying transient failures with backoff. Ported
 * from the iTunes `fetchJson` retry loop but returns the body unparsed (Play
 * pages are HTML, not JSON). 403 is retried because Google routinely 403s
 * datacenter egress — a retry (ideally via a clean-egress transport) can clear
 * it, the same reason the iTunes layer retries 403.
 */
export async function fetchText(fetchFn: FetchFn, url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetchFn(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      });
      if (!resp.ok) {
        if (RETRY_STATUS.has(resp.status) && attempt < MAX_RETRIES) {
          const retryAfter = resp.headers.get("Retry-After");
          const waitMs =
            retryAfter && /^\d+$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : BACKOFF_BASE * 1000 * 2 ** attempt;
          await sleep(waitMs);
          continue;
        }
        throw new PlayError(`HTTP ${resp.status}`);
      }
      return await resp.text();
    } catch (e) {
      lastErr = e;
      if (e instanceof PlayError && !RETRYABLE_MSG.test(e.message)) throw e;
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_BASE * 1000 * 2 ** attempt);
        continue;
      }
      throw e instanceof PlayError ? e : new PlayError(String(e));
    }
  }
  throw new PlayError(`retries exhausted: ${String(lastErr)}`);
}

/**
 * The Play page source: fetch a listing-detail or search page as raw HTML.
 * Injected (like `FetchFn`) so the engine never hard-codes how pages are
 * fetched — a clean-egress transport can be swapped in without touching parsing.
 */
export type PlayPageSource = {
  detail(packageName: string, opts?: PlayPageOpts): Promise<string>;
  search(term: string, opts?: PlayPageOpts): Promise<string>;
};

/** A `PlayPageSource` backed by a raw `FetchFn` hitting play.google.com. */
export function playWebSource(fetchFn: FetchFn): PlayPageSource {
  return {
    detail: (packageName, opts) => fetchText(fetchFn, playDetailUrl(packageName, opts)),
    search: (term, opts) => fetchText(fetchFn, playSearchUrl(term, opts)),
  };
}
