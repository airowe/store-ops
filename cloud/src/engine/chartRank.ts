/**
 * Chart rank — the app's position in an App Store CATEGORY chart, read from the
 * public legacy iTunes top-charts RSS feed (no key required; the
 * analytics-reports/04-public-data-map PRD's highest-value keyless gap).
 *
 * Honest by construction: the feed is a ranked list of app ids; if the app's id
 * is in it, its 1-based position IS the measured chart rank. If it's not in the
 * top N, we say so (`ranked:false`) — never a fabricated number and never a
 * silent zero. An unreadable feed is UNKNOWN (`null`), distinct from "not
 * charting". Pure parse + FetchFn-injected fetch; never throws.
 */
import {
  buildChartFeedUrl,
  type ChartKind,
} from "./constants.js";
import { fetchJson, type FetchFn } from "./itunes.js";

export type ChartRank = {
  genreId: string;
  genreName?: string;
  chart: ChartKind;
  country: string;
  /** how many entries the feed returned (the chart depth we actually saw). */
  outOf: number;
} & (
  | { ranked: true; position: number } // 1-based position in the chart
  | { ranked: false } // read the chart; the app isn't in the top `outOf`
);

/** Extract the ordered app ids from a legacy RSS feed body. Never throws. */
export function parseChartFeed(body: string): string[] {
  let feed: unknown;
  try {
    feed = (JSON.parse(body) as { feed?: unknown }).feed;
  } catch {
    return [];
  }
  const entryField = (feed as { entry?: unknown } | undefined)?.entry;
  if (!entryField) return [];
  // Apple returns an array for many entries, a bare object for exactly one.
  const entries = Array.isArray(entryField) ? entryField : [entryField];
  const ids: string[] = [];
  for (const e of entries) {
    const id = (e as { id?: { attributes?: { "im:id"?: unknown } } })?.id?.attributes?.["im:id"];
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

/** Pure: locate `appId` in an ordered id list and shape the ChartRank. */
export function chartRankFromEntries(
  entries: string[],
  appId: string,
  meta: { genreId: string; genreName?: string; chart: ChartKind; country: string; limit?: number },
): ChartRank {
  const base = {
    genreId: meta.genreId,
    ...(meta.genreName !== undefined ? { genreName: meta.genreName } : {}),
    chart: meta.chart,
    country: meta.country,
    outOf: entries.length,
  };
  const idx = entries.indexOf(appId);
  return idx >= 0 ? { ...base, ranked: true, position: idx + 1 } : { ...base, ranked: false };
}

/**
 * Fetch the genre chart and locate the app. Returns:
 *  - a ChartRank (ranked or not) on a good read,
 *  - null when the genre is unknown (can't pick a chart honestly) or the feed
 *    is unreadable (UNKNOWN — never a false "not charting").
 */
export async function fetchChartRank(
  fetchFn: FetchFn,
  opts: {
    appId: string;
    genreId?: string;
    genreName?: string;
    chart?: ChartKind;
    country?: string;
    limit?: number;
  },
): Promise<ChartRank | null> {
  if (!opts.genreId) return null;
  const chart = opts.chart ?? "top-free";
  const country = opts.country ?? "us";
  const limit = opts.limit ?? 100;
  let body: string;
  try {
    body = (await fetchJson(fetchFn, buildChartFeedUrl({ chart, genreId: opts.genreId, country, limit }))) as never;
  } catch {
    return null;
  }
  // fetchJson lenient-parses to an object; we need the raw text. Re-fetch shape:
  // it returns the parsed value, so stringify back for the shared parser. When
  // it already handed us an object, JSON.stringify round-trips the feed intact.
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const entries = parseChartFeed(text);
  if (entries.length === 0) return null; // unreadable / empty ⇒ UNKNOWN
  return chartRankFromEntries(entries, opts.appId, {
    genreId: opts.genreId,
    ...(opts.genreName !== undefined ? { genreName: opts.genreName } : {}),
    chart,
    country,
    limit,
  });
}
