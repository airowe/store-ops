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
  baseCopy?: { name?: string; subtitle?: string; promo?: string; description?: string };
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
  const keywords =
    overrides.keywords && overrides.keywords.length > 0
      ? overrides.keywords
      : seedKeywordsFromName(app.name || app.bundle_id);

  const input: AppInput = {
    app: app.name || app.bundle_id,
    bundleId: app.bundle_id,
    keywords,
    competitors: overrides.competitors ?? [],
    previousCompetitors,
    country: app.country,
  };
  if (overrides.baseCopy !== undefined) input.baseCopy = overrides.baseCopy;
  return input;
}
