/**
 * Build the engine's `AppInput` from a stored app row (+ optional client
 * overrides). The agent needs target keywords (with volume/difficulty/relevance
 * 0–100 proxies) and a competitor list. For the working demo these can come from
 * the request body; when absent we derive sensible seeds from the app name so a
 * bare `POST /apps/:id/run` still does something real against live iTunes data.
 *
 * This is the ONE place that translates "stored app" → "agent input", so the API
 * (on-demand run) and the cron (weekly run) feed the engine identically.
 */
import type { AppInput, KeywordInput } from "../engine/index.js";
import type { AppRow } from "../d1.js";

export type RunOverrides = {
  keywords?: KeywordInput[];
  competitors?: string[];
  baseCopy?: { name?: string; subtitle?: string; keywords?: string; promo?: string; description?: string };
  /** True when baseCopy's subtitle/keywords were READ from App Store Connect — lets
   *  the optimizer improve them instead of omitting them (the #30 Mode-A path). */
  ascMetadataRead?: boolean;
};

// Words that are never useful keyword seeds.
const SEED_STOP = new Set([
  "the", "and", "for", "your", "app", "free", "pro", "lite", "best", "new",
  "with", "secular", // brandy/qualifier words still useful elsewhere but weak as the ONLY seed
]);

// Genre → a small set of category seeds, so even a one-word app name yields a
// real keyword set to rank + bucket. Mirrors the Python derive_seeds logic.
const GENRE_SEEDS: Record<string, string[]> = {
  meditation: ["meditation", "mindfulness", "calm", "stoic", "sleep", "anxiety"],
  health: ["meditation", "mindfulness", "wellness", "calm", "sleep", "fitness"],
  lifestyle: ["mindfulness", "journal", "habit", "calm", "focus"],
  photo: ["photo editor", "filter", "collage", "camera", "edit"],
  entertainment: ["meme", "funny", "video", "fun", "share"],
  social: ["chat", "meet", "friends", "nearby", "dating"],
  food: ["recipe", "meal", "cooking", "grocery", "pantry"],
  productivity: ["notes", "tasks", "planner", "focus", "journal"],
  finance: ["budget", "expense", "money", "savings", "track"],
  weather: ["weather", "forecast", "radar", "rain", "temperature"],
};

function detectGenreSeeds(hint: string): string[] {
  const h = hint.toLowerCase();
  for (const [key, seeds] of Object.entries(GENRE_SEEDS)) {
    if (h.includes(key)) return seeds;
  }
  return [];
}

/**
 * Derive candidate keyword seeds from the app's name/live-name (+ any genre hint
 * baked into it). Tokenizes the name AND folds in genre-category seeds, so a bare
 * connect on a one-word app still produces a real keyword set to rank + bucket.
 */
function seedKeywordsFromName(name: string): KeywordInput[] {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !SEED_STOP.has(w));

  const candidates = [...words, ...detectGenreSeeds(name)];
  const seen = new Set<string>();
  const out: KeywordInput[] = [];
  for (const w of candidates) {
    if (seen.has(w)) continue;
    seen.add(w);
    // Neutral mid-band proxies so the scorer has something real to rank/bucket.
    // (Real volume/difficulty come from the client or a future data source.)
    // Name tokens are more relevant than generic genre seeds.
    const relevance = words.includes(w) ? 90 : 70;
    out.push({ keyword: w, volume: 55, difficulty: 45, relevance });
  }
  return out;
}

/** A keyword string longer than this is almost certainly junk or an attack. */
const MAX_KEYWORD_LEN = 80;

function clamp01(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, x));
}

/**
 * Sanitize client-supplied keyword overrides. These arrive in the untrusted
 * POST /apps/:id/run body and are persisted to rank_snapshots, then re-served to
 * the dashboard — so we normalize them at this single chokepoint: strip control
 * characters, collapse whitespace, cap length, drop empties, and clamp the
 * numeric proxies into 0–100. Defense in depth: even though the dashboard renders
 * keywords as text nodes today, no unbounded or control-char string is ever
 * stored or re-served.
 */
function sanitizeKeywords(keywords: KeywordInput[]): KeywordInput[] {
  const out: KeywordInput[] = [];
  for (const k of keywords) {
    // Replace any control character (codepoint < 0x20 or 0x7f) with a space,
    // collapse whitespace, trim, and cap length. Done via a codepoint check
    // rather than a control-char regex literal so the source stays byte-clean.
    let stripped = "";
    for (const ch of String(k?.keyword ?? "")) {
      const code = ch.codePointAt(0) ?? 0;
      stripped += code < 0x20 || code === 0x7f ? " " : ch;
    }
    const cleaned = stripped.replace(/\s+/g, " ").trim().slice(0, MAX_KEYWORD_LEN);
    if (!cleaned) continue;
    out.push({
      keyword: cleaned,
      volume: clamp01(k.volume),
      difficulty: clamp01(k.difficulty),
      relevance: clamp01(k.relevance),
    });
  }
  return out;
}

/**
 * Compose the agent input. Precedence: explicit overrides > name-derived seeds.
 * `previousCompetitors` is threaded in separately by the caller (it comes from
 * D1 snapshots, not the request).
 */
export function buildAppInput(
  app: AppRow,
  overrides: RunOverrides = {},
  previousCompetitors: Record<string, Record<string, string>> = {},
): AppInput {
  const clean = overrides.keywords ? sanitizeKeywords(overrides.keywords) : [];
  const keywords =
    clean.length > 0 ? clean : seedKeywordsFromName(app.name || app.bundle_id);

  const input: AppInput = {
    app: app.name || app.bundle_id,
    bundleId: app.bundle_id,
    keywords,
    competitors: overrides.competitors ?? [],
    previousCompetitors,
    country: app.country,
  };
  if (overrides.baseCopy !== undefined) input.baseCopy = overrides.baseCopy;
  if (overrides.ascMetadataRead) input.ascMetadataRead = true;
  return input;
}
