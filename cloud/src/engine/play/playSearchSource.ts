/**
 * The concrete keyless Play SEARCH source — the brittle half behind the injected
 * `PlaySearchSource` seam. Play search results are server-rendered into the
 * search page HTML as `/store/apps/details?id=<pkg>` links in RESULT ORDER, so
 * we read them by CONTENT (first-seen order, deduped) rather than a fragile
 * positional `ds:` walk — the same drift-tolerant posture as the chart parser.
 *
 * Degrade-safe by construction: datacenter/Worker egress gets 403/429'd by
 * Google (data-map §1), so any fetch/parse failure → `[]`, which the pure engine
 * reads as UNKNOWN (`null`) — never a fabricated rank.
 */
import type { PlayPageOpts, PlayPageSource } from "./playWebSource.js";
import type { PlaySearchSource } from "./playSearchRank.js";

/** Match every `…/store/apps/details?id=<pkg>` package id, IN DOCUMENT ORDER. */
const DETAIL_ID_RE = /\/store\/apps\/details\?id=([a-zA-Z][a-zA-Z0-9_.]*)/g;
/** A reverse-DNS package id, e.g. com.foo.bar (≥ 2 dot-separated segments). */
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

/**
 * Extract ordered package ids from a Play search-results page, by content. Walks
 * every `details?id=` link in document order, keeps package-shaped ids, dedups
 * (first position wins — that's the rank), and caps at `limit`. Never throws; a
 * page it can't read yields `[]`.
 */
export function parsePlaySearchResults(html: string, limit = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  DETAIL_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DETAIL_ID_RE.exec(html)) !== null) {
    const id = m[1];
    if (!id || !PACKAGE_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A `PlaySearchSource` backed by a `PlayPageSource` (the injected HTML fetcher).
 * Degrade-safe: any fetch/parse failure → `[]`.
 */
export function playSearchSource(pageSource: PlayPageSource): PlaySearchSource {
  return async ({ term, country, limit = 50 }) => {
    try {
      const opts: PlayPageOpts = { country };
      const html = await pageSource.search(term, opts);
      return parsePlaySearchResults(html, limit);
    } catch {
      return [];
    }
  };
}
