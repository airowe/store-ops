/**
 * Ported constants from the Python store-ops libs. These are LOAD-BEARING —
 * the engine (to be built) must honor them exactly. Keep this file as the single
 * source of truth so api/ and cron/ import the same numbers.
 */

// ── App Store field char limits (HARD — never emit over-limit copy) ──────────
// From aso_copy_stub.py LIMITS.
export const CHAR_LIMITS = {
  name: 30,
  subtitle: 30,
  keywords: 100, // keyword field — comma-separated, NO spaces, no title/subtitle dupes
  promo: 170, // promotional_text
  description: 4000,
} as const;
export type StoreField = keyof typeof CHAR_LIMITS;

// ── iTunes endpoints (free, no auth) ─────────────────────────────────────────
// Search → organic rank (app's 1-based index in results[]); absent => not top 200.
export const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
// Lookup → competitor watch + screenshot set (by id= or bundleId=).
export const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
export const ITUNES_MAX_LIMIT = 200; // Apple returns at most 200 software results
export const USER_AGENT = "Mozilla/5.0 (Macintosh; store-ops)";

// ── Public customer reviews (PRD 03 / #95) ───────────────────────────────────
// Apple's free RSS customer-reviews JSON feed — PUBLIC, no key. Paginated by a
// path segment (`page=N`), keyed by the numeric App Store track id, sorted most
// recent first. The `/json` suffix returns the JSON variant (label-wrapped
// fields), not XML. Same free-endpoint posture as search/lookup.
export const ITUNES_REVIEWS_RSS_BASE = "https://itunes.apple.com";

/**
 * Build the customer-reviews RSS JSON feed URL for one app + page.
 * Shape: /{country}/rss/customerreviews/page=N/id=ID/sortby=mostrecent/json
 * (country is lower-cased per the RSS feed convention).
 */
export function buildReviewsRssUrl(
  appId: string,
  { country = "us", page = 1 }: { country?: string; page?: number } = {},
): string {
  const cc = country.toLowerCase();
  return `${ITUNES_REVIEWS_RSS_BASE}/${cc}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`;
}

/** Legacy RSS "feed name" per chart — the only variant that honors ?genre=. */
export const CHART_FEEDS = {
  "top-free": "topfreeapplications",
  "top-paid": "toppaidapplications",
  "top-grossing": "topgrossingapplications",
} as const;
export type ChartKind = keyof typeof CHART_FEEDS;

/**
 * Build the legacy top-charts RSS JSON feed URL, genre-scoped. Unlike the newer
 * rss.marketingtools.apple.com feed (which ignores ?genre=), this path returns a
 * real CATEGORY chart. Shape:
 *   /{country}/rss/{feed}/limit=N/genre=ID/json
 */
export function buildChartFeedUrl(opts: {
  chart: ChartKind;
  genreId: string;
  country?: string;
  limit?: number;
}): string {
  const cc = (opts.country ?? "us").toLowerCase();
  const limit = opts.limit ?? 100;
  return `${ITUNES_REVIEWS_RSS_BASE}/${cc}/rss/${CHART_FEEDS[opts.chart]}/limit=${limit}/genre=${opts.genreId}/json`;
}

// Retry policy for the public endpoints (from aso_rank_check.py).
export const MAX_RETRIES = 3;
export const BACKOFF_BASE = 1.5; // seconds: 1.5, 3.0, 6.0
// 403 is included because Apple intermittently 403s requests from datacenter
// egress (e.g. Cloudflare Workers); a retry — ideally via a clean-egress
// transport like TinyFish — often clears it.
export const RETRY_STATUS = new Set([403, 429, 500, 502, 503, 504]);

// ── Screenshot scoring (from aso_screenshot_score.py) ────────────────────────
export const SCREENSHOT = {
  MAX_SLOTS: 10,
  GOOD_MIN: 4, // below this → warn
  KEY_SLOTS: 3, // first N carry most installs
  TALL_RATIO: 2.0, // h/w >= 2.0 → modern tall phone, scores higher
} as const;

// ── Keyword reasoning (scoring + buckets) ────────────────────────────────────
// score = volume*0.4 + (100-difficulty)*0.3 + relevance*0.3
export const KEYWORD_WEIGHTS = {
  volume: 0.4,
  difficulty: 0.3, // applied to (100 - difficulty)
  relevance: 0.3,
} as const;

// Buckets map a scored keyword to the store field it belongs in.
export const KEYWORD_BUCKETS = ["Primary", "Secondary", "Long-tail", "Aspirational"] as const;
export type KeywordBucket = (typeof KEYWORD_BUCKETS)[number];
// Primary → title (name), Secondary → subtitle, Long-tail → keyword field,
// Aspirational → track only (not placed in metadata).
export const BUCKET_TO_FIELD: Record<KeywordBucket, StoreField | null> = {
  Primary: "name",
  Secondary: "subtitle",
  "Long-tail": "keywords",
  Aspirational: null,
};

// ── Run lifecycle (mirrors schema.sql CHECK + the approval-gate guarantee) ────
export const RUN_STATUSES = [
  "detected",
  "researching",
  "awaiting_approval",
  "approved",
  "rejected",
  "shipped",
  // terminal: an older awaiting_approval run replaced by a newer one for the same
  // app (never a decided run — approved/rejected/shipped are history, not phantoms).
  "superseded",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
