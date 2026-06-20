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
import { type Reasoner, reasonKeywords } from "../engine/keywordReasoner.js";
import type { AppRow } from "../d1.js";

export type RunOverrides = {
  keywords?: KeywordInput[];
  competitors?: string[];
  baseCopy?: { name?: string; subtitle?: string; keywords?: string; promo?: string; description?: string };
  /** True when baseCopy's subtitle/keywords were READ from App Store Connect — lets
   *  the optimizer improve them instead of omitting them (the #30 Mode-A path). */
  ascMetadataRead?: boolean;
  /**
   * Optional LLM reasoner for keyword targeting (#57). When present AND a
   * description is available, keywords are derived by reasonKeywords (LLM
   * classifies → reality validates) instead of tokenizing the title. Omit → the
   * deterministic classifier is used. The concrete env.AI-backed Reasoner is
   * built in the API layer and threaded in here; a missing AI binding simply
   * means no reasoner is passed and the run degrades gracefully.
   */
  reasoner?: Reasoner;
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

/** Tokenize the app name into candidate keyword tokens for the reasoner. */
function candidateTokensFromName(name: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !SEED_STOP.has(w))) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * Map reasoned `target` strings to the engine's KeywordInput shape. We keep the
 * neutral mid-band volume/difficulty/relevance proxies untouched here on purpose:
 * #65 already made the SCORING honest (no fabricated metrics flow into the
 * opportunity/attribution surfaces), and #57 is strictly about WHICH keywords we
 * target — not re-deriving metrics. So targeting gets smarter; the proxies stay.
 */
function targetsToKeywordInputs(targets: string[]): KeywordInput[] {
  return targets.map((keyword) => ({
    keyword,
    volume: 55,
    difficulty: 45,
    relevance: 90,
  }));
}

/**
 * Source the run's keywords from the reasoning step (#57) when a description is
 * available: the LLM (or the deterministic fallback) classifies the title tokens
 * + suggests description-derived targets, guardrailed against invention. Brand
 * and dropped terms are excluded from the keyword SET (brand is monitor-only; the
 * engine's AppInput has no brand lane today, so we simply don't target them).
 * Falls back to the old name-seeder only when there's no description to reason
 * over (a bare bundle connect before the live listing is read).
 */
async function reasonedKeywords(
  app: AppRow,
  description: string | undefined,
  reasoner?: Reasoner,
): Promise<KeywordInput[]> {
  const name = app.name || app.bundle_id;
  if (!description || !description.trim()) {
    // No description to reason over → keep the deterministic name seeder as the
    // floor so a bare connect still produces a real (if coarser) keyword set.
    return seedKeywordsFromName(name);
  }
  const reasoning = await reasonKeywords(
    { appName: name, description, candidateTokens: candidateTokensFromName(name) },
    reasoner,
  );
  const targets = targetsToKeywordInputs(reasoning.target);
  // Defensive: if reasoning somehow yields nothing targetable, don't ship an
  // empty keyword set — fall back to the name seeder.
  return targets.length > 0 ? targets : seedKeywordsFromName(name);
}

/**
 * Compose the agent input. Precedence: explicit overrides > reasoned keywords
 * (#57) > name-derived seeds. `previousCompetitors` is threaded in separately by
 * the caller (it comes from D1 snapshots, not the request). Async because the
 * keyword reasoning step may call an injected LLM.
 */
export async function buildAppInput(
  app: AppRow,
  overrides: RunOverrides = {},
  previousCompetitors: Record<string, Record<string, string>> = {},
): Promise<AppInput> {
  const clean = overrides.keywords ? sanitizeKeywords(overrides.keywords) : [];
  const keywords =
    clean.length > 0
      ? clean
      : await reasonedKeywords(app, overrides.baseCopy?.description, overrides.reasoner);

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
