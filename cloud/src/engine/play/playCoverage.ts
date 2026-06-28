/**
 * Google Play metadata coverage — the Android sibling of `metadataCoverage.ts`.
 *
 * Play's ranking model is NOT iOS's. There is no keyword field; Play indexes the
 * title (30), short description (80) and long description (4000), and it ranks on
 * the long description's TERM FREQUENCY. So the waste model is the inverse of
 * iOS's "duplicate term across fields is wasted":
 *   • stuffing    — a term OVER-repeated in the long description. Play penalizes
 *                   keyword stuffing, so excess repetition is the waste here.
 *   • brand_repeat— the brand word burned in the short description (the title
 *                   already carries the brand), same idea as iOS subtitle burn.
 * There is deliberately NO cross-field "counted once" dupe rule — repeating a
 * term across title/short/long is normal and even helpful on Play, up to a point.
 *
 * HONESTY (carried from the iOS module): "coverage" is a BUDGET-EFFICIENCY
 * heuristic, framed as "how hard your indexed text is working," NEVER a rank
 * score or guarantee. An UNSEEN field (input undefined — e.g. we couldn't read
 * it) carries no fabricated fill: used/fillPct stay 0 AND `seen` is false.
 *
 * Pure + deterministic: same input → deep-equal output (no fetch/Date/random).
 */
import { PLAY_CHAR_LIMITS } from "../store/profiles.js";

/** Per-field fill (used/limit), with `seen` so an unseen field reads UNKNOWN. */
export type PlayFieldFill = {
  field: "title" | "shortDescription" | "description";
  limit: number;
  used: number;
  fillPct: number;
  /** false when the field's input was undefined (unseen) — a 0 here is UNKNOWN. */
  seen: boolean;
};

/** A single itemized unit of wasted/risked budget. */
export type PlayCoverageWaste = {
  kind: "stuffing" | "brand_repeat";
  /** human-facing explanation. */
  detail: string;
  /** the term involved. */
  term: string;
  /** occurrences (stuffing) or wasted chars (brand_repeat). */
  count: number;
};

export type PlayCoverageReport = {
  /** per-field fill, with a `seen` flag so unseen fields read as UNKNOWN. */
  fieldFill: PlayFieldFill[];
  /** count of unique non-brand terms across the indexed text. */
  distinctTerms: number;
  /** itemized waste — empty when the listing is clean. */
  waste: PlayCoverageWaste[];
  /** 0–100 efficiency heuristic — "how hard your indexed text works", NOT rank. */
  coverageScore: number;
  /** true when any term is over-repeated in the long description. */
  stuffingRisk: boolean;
};

export type PlayCoverageOptions = {
  /** the app's brand name, so brand words are flagged when they burn short-desc budget. */
  brand?: string | undefined;
  /** occurrences of one term in the long description above which it reads as stuffing. */
  stuffingMax?: number | undefined;
};

/** The indexed Play fields share one budget: 30 + 80 + 4000 = 4110 working chars. */
const AVAILABLE_BUDGET =
  PLAY_CHAR_LIMITS.title + PLAY_CHAR_LIMITS.shortDescription + PLAY_CHAR_LIMITS.description;

/** Default stuffing threshold: a term repeated MORE than this in the long desc is flagged. */
const DEFAULT_STUFFING_MAX = 6;

/** Generic stopwords that never count as stuffing (repeating "the" isn't keyword stuffing). */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "our", "app", "apps", "are", "can",
  "all", "any", "from", "that", "this", "have", "has", "will", "get", "use",
  "more", "new", "now", "out", "its", "into", "not", "but", "what", "when",
]);

/** Lowercase, split into alphanumeric tokens (drops punctuation/spaces). */
function tokenize(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Push a waste item only when it carries weight (keeps the array honest). */
function pushWaste(out: PlayCoverageWaste[], item: PlayCoverageWaste): void {
  if (item.count > 0) out.push(item);
}

/**
 * Compute the Play coverage report for a listing's indexed copy. Pure.
 *
 * @param copy  title / short description / long description (any may be undefined
 *              on a partial read — those fields contribute nothing and read UNSEEN).
 * @param opts  optional brand (for the short-desc brand-burn flag) + stuffing threshold.
 */
export function playCoverage(
  copy: {
    title?: string | undefined;
    shortDescription?: string | undefined;
    description?: string | undefined;
  },
  opts: PlayCoverageOptions = {},
): PlayCoverageReport {
  const stuffingMax = opts.stuffingMax ?? DEFAULT_STUFFING_MAX;

  const fieldFill: PlayFieldFill[] = (
    ["title", "shortDescription", "description"] as const
  ).map((field) => {
    const raw = copy[field];
    const seen = raw !== undefined;
    const used = seen ? raw.length : 0;
    const limit = PLAY_CHAR_LIMITS[field];
    const fillPct = seen ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
    return { field, limit, used, fillPct, seen };
  });

  const brandTokens = new Set(tokenize(opts.brand));
  const waste: PlayCoverageWaste[] = [];

  // ── brand_repeat: a brand word burned in the short description ──────────────
  const shortTokens = new Set(tokenize(copy.shortDescription));
  for (const brandTok of brandTokens) {
    if (shortTokens.has(brandTok)) {
      pushWaste(waste, {
        kind: "brand_repeat",
        term: brandTok,
        detail:
          `Your brand word "${brandTok}" repeats in the short description — the title already carries ` +
          `the brand, so this spends scarce short-description budget for no extra reach.`,
        count: brandTok.length,
      });
    }
  }

  // ── stuffing: a non-brand, non-stopword term OVER-repeated in the long desc ─
  const descTokens = tokenize(copy.description).filter(
    (t) => !brandTokens.has(t) && !STOPWORDS.has(t) && t.length >= 3,
  );
  const freq = new Map<string, number>();
  for (const t of descTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  for (const [term, count] of freq) {
    if (count > stuffingMax) {
      pushWaste(waste, {
        kind: "stuffing",
        term,
        detail:
          `'${term}' appears ${count} times in the long description — Play can read repeated keywords as ` +
          `stuffing, which risks ranking rather than helping it. Vary the language; your call.`,
        count,
      });
    }
  }

  // ── distinct terms across all indexed text (non-brand) ──────────────────────
  const allTokens = new Set<string>(
    [
      ...tokenize(copy.title),
      ...tokenize(copy.shortDescription),
      ...tokenize(copy.description),
    ].filter((t) => !brandTokens.has(t)),
  );
  const distinctTerms = allTokens.size;

  // ── coverage math: (budget − stuffing/brand waste chars) / budget ───────────
  // Stuffing "waste chars" = the EXCESS repetitions beyond the threshold × term
  // length (the part that's likely hurting, not the legitimate mentions). An
  // empty listing (no distinct terms) floors at 0 — nothing is working.
  let wasteChars = 0;
  for (const w of waste) {
    if (w.kind === "brand_repeat") wasteChars += w.count;
    else wasteChars += (w.count - stuffingMax) * w.term.length; // excess repeats only
  }
  const coverageScore =
    distinctTerms === 0
      ? 0
      : Math.max(0, Math.min(100, ((AVAILABLE_BUDGET - wasteChars) / AVAILABLE_BUDGET) * 100));

  return {
    fieldFill,
    distinctTerms,
    waste,
    coverageScore,
    stuffingRisk: waste.some((w) => w.kind === "stuffing"),
  };
}
