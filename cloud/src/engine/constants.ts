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
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
