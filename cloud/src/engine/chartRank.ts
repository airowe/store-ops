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
import { genreNameFor } from "./appStoreGenres.js";

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
 * The audit-shaped category rank the run status bar renders (#326).
 *
 * `category` is OPTIONAL because a genre id we cannot name is not a category:
 * absent means "we know the rank but not the category's name", and the bar
 * renders a bare "#42" rather than the bug-looking "#42 in 6013".
 */
export type CategoryRank = { rank: number | null; category?: string };

/**
 * Narrow a ChartRank into the status bar's `{ rank, category? }` (#326).
 *
 * The three rank states stay distinct, which is the whole honesty point:
 *  - charted        → `rank` is the measured 1-based position.
 *  - read, unranked → `rank: null` (we READ the chart; the app wasn't in it).
 *  - never read     → `undefined`, so the bar shows its "#—" placeholder rather
 *                     than asserting the app doesn't chart.
 *
 * The category name resolves in the same measured-or-absent spirit: the feed's
 * own `genreName` first (a label we actually read), then Apple's verified
 * id→name map. A miss omits `category` entirely — we never surface the raw id
 * as a name, because a numeric "category" is a fabricated label, not a
 * measurement.
 */
export function categoryRankFrom(cr: ChartRank | null | undefined): CategoryRank | undefined {
  if (!cr) return undefined;
  const category = cr.genreName ?? genreNameFor(cr.genreId);
  return {
    rank: cr.ranked ? cr.position : null,
    ...(category !== undefined ? { category } : {}),
  };
}

/** Options shared by the chart reads. */
type ChartOpts = {
  appId: string;
  genreId?: string;
  genreName?: string;
  chart?: ChartKind;
  country?: string;
  limit?: number;
};

/**
 * A chart read: the app's position AND the ordered ids the feed carried.
 *
 * The entries are the same list `chartRankFromEntries` reduces to a position.
 * The icon comparison (#455) needs the list itself — who is at the top of your
 * category — so this returns both from ONE fetch rather than making a second
 * caller re-read the identical feed.
 */
export type ChartRead = { rank: ChartRank; entries: string[] };

/**
 * Fetch the genre chart ONCE, returning the position and the ordered ids.
 * Null on the same terms as `fetchChartRank`: unknown genre or unreadable feed.
 */
export async function fetchChartRead(
  fetchFn: FetchFn,
  opts: ChartOpts,
): Promise<ChartRead | null> {
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
  const rank = chartRankFromEntries(entries, opts.appId, {
    genreId: opts.genreId,
    ...(opts.genreName !== undefined ? { genreName: opts.genreName } : {}),
    chart,
    country,
    limit,
  });
  return { rank, entries };
}

/**
 * Fetch the genre chart and locate the app. Returns:
 *  - a ChartRank (ranked or not) on a good read,
 *  - null when the genre is unknown (can't pick a chart honestly) or the feed
 *    is unreadable (UNKNOWN — never a false "not charting").
 */
export async function fetchChartRank(
  fetchFn: FetchFn,
  opts: ChartOpts,
): Promise<ChartRank | null> {
  return (await fetchChartRead(fetchFn, opts))?.rank ?? null;
}
