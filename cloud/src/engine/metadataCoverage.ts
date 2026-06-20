/**
 * Metadata coverage score — PRD 03 (`docs/prd/ranking-features/03-metadata-coverage.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE function that quantifies how hard a
 * listing's scarce 30/30/100 character budget (name / subtitle / keyword field)
 * is working for ranking. Apple ranks on the DISTINCT, relevant terms across all
 * three fields, so waste is:
 *   - duplicate   — a term repeated across fields (Apple counts it once)
 *   - brand_repeat— the app's own brand word burned in the subtitle (ties to #42)
 *   - filler      — a low-relevance term (low `scoreKeyword`), advisory only
 *   - unused      — (NOT emitted as waste; unused space is low usage, not waste)
 *
 * HONESTY (carried from the overview + PRD):
 *  - "Coverage" is a heuristic for BUDGET EFFICIENCY, not a rank guarantee. Frame
 *    as "how hard your metadata is working," never "your rank score."
 *  - Waste is CORRELATIONAL with rank (dupes don't help), never causal — detail
 *    strings never claim a term caused a rank move.
 *  - Unused empty space is NOT waste: a short clean name is low usage, not low
 *    quality. Coverage = (budget - waste) / budget, never (budget - used)/budget.
 *  - Filler is advisory ("low-relevance"), not a hard "remove" — the human
 *    overrides. We use `scoreKeyword` as-is (the product's standard).
 *  - `topMissingValue` is deferred to the gap finder (#01); omitted here.
 *
 * Same input → deep-equal output (no fetch / Date.now / randomness).
 */
import { CHAR_LIMITS } from "./constants.js";
import { scoreKeyword } from "./keywords.js";

/** A single itemized unit of wasted budget. */
export type CoverageWaste = {
  kind: "duplicate" | "brand_repeat" | "filler" | "unused";
  /** human-facing explanation, e.g. "'weather' repeats across fields — 7 wasted chars". */
  detail: string;
  /** the wasted character count attributed to this item. */
  chars: number;
};

/**
 * Per-field FILL — how much of a field's own budget is used. This is the HONEST
 * counterpart to `coverageScore` (which is efficiency, not fill): a near-empty
 * listing has low fill but can still be "waste-free". `seen` distinguishes a
 * MEASURED empty field (input was a string, even "") from an UNSEEN one (input
 * was undefined — e.g. a no-key run can't read subtitle/keywords). We never
 * fabricate fill for an unseen field — used/fillPct stay 0 AND seen is false, so
 * the UI can render "UNSEEN" rather than a false "0/limit".
 */
export type FieldFill = {
  field: "name" | "subtitle" | "keywords";
  /** the field's own char budget (30 / 30 / 100). */
  limit: number;
  /** chars used — 0 for an unseen field (carries no measured value). */
  used: number;
  /** used/limit × 100, clamped 0–100 — 0 for an unseen field. */
  fillPct: number;
  /** false when the field's input was undefined (unseen) — a 0 here is UNKNOWN. */
  seen: boolean;
};

export type CoverageReport = {
  /** 0–100: (available budget − total waste chars) / available budget, clamped. */
  coverageScore: number;
  /** actual length of each field, against the 30/30/100 budget. */
  usedChars: {
    name: number;
    subtitle: number;
    keywords: number;
  };
  /** per-field fill (used/limit), with a `seen` flag so unseen fields read as UNKNOWN. */
  fieldFill: FieldFill[];
  /** count of unique ranking terms across all fields (brand + dupes removed). */
  distinctTerms: number;
  /** itemized waste — empty when the listing is clean. */
  waste: CoverageWaste[];
  /** a high-value term that would fit (feeds #01 gap finder). Deferred → omitted. */
  topMissingValue?: string | undefined;
};

/** Optional context — the app's brand name, so brand words are filtered/flagged. */
export type CoverageOptions = {
  brand?: string | undefined;
};

/** The three fields share one budget: 30 + 30 + 100 = 160 working chars. */
const AVAILABLE_BUDGET = CHAR_LIMITS.name + CHAR_LIMITS.subtitle + CHAR_LIMITS.keywords;

/** Filler threshold: a term scoring below this (via scoreKeyword) is low-value. */
const FILLER_SCORE_FLOOR = 20;

/**
 * Low-value filler terms — common stopwords + generic store-listing padding that
 * carry near-zero ranking value. Intentionally small + explicit (no fuzzy magic):
 * the human can override any flag. Anything here scores below the filler floor.
 */
const FILLER_TERMS = new Set([
  "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "at", "by",
  "with", "your", "you", "is", "it", "this", "that", "best", "super", "great",
  "amazing", "easy", "pro", "plus", "now", "get",
]);

/** Lowercase, split a field into alphanumeric tokens (drops punctuation/spaces). */
function tokenize(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Heuristic keyword score for a bare term via the product's `scoreKeyword`. We
 * have no real volume/difficulty/relevance signals here, so we derive an HONEST
 * proxy: known filler/stopwords get low volume + relevance and high difficulty
 * (→ a low composite, below the floor); a substantive term gets neutral-to-good
 * inputs (→ above the floor). Length is a weak relevance proxy (longer, more
 * specific terms read as more intentional). This keeps filler detection tied to
 * the shared scoring formula rather than inventing a parallel one.
 */
function termScore(term: string): number {
  if (FILLER_TERMS.has(term)) {
    return scoreKeyword({ keyword: term, volume: 5, difficulty: 95, relevance: 10 });
  }
  // Very short non-stopword tokens (1–2 chars) read as filler fragments too.
  if (term.length <= 2) {
    return scoreKeyword({ keyword: term, volume: 8, difficulty: 90, relevance: 12 });
  }
  // A substantive term: moderate volume, beatable difficulty, decent relevance.
  const relevance = Math.min(80, 40 + term.length * 4);
  return scoreKeyword({ keyword: term, volume: 50, difficulty: 50, relevance });
}

/** Push a waste item only when it carries chars (keeps the array honest). */
function pushWaste(out: CoverageWaste[], item: CoverageWaste): void {
  if (item.chars > 0) out.push(item);
}

/**
 * Compute the coverage report for a listing's copy. Pure + deterministic.
 *
 * @param copy  the live name / subtitle / keyword-field strings (any may be
 *              undefined on a partial read — those fields contribute nothing).
 * @param opts  optional brand name, so brand words are filtered from the term
 *              analysis and flagged when they burn subtitle budget (#42).
 */
export function metadataCoverage(
  copy: { name?: string | undefined; subtitle?: string | undefined; keywords?: string | undefined },
  opts: CoverageOptions = {},
): CoverageReport {
  const usedChars = {
    name: copy.name?.length ?? 0,
    subtitle: copy.subtitle?.length ?? 0,
    keywords: copy.keywords?.length ?? 0,
  };

  // Per-field FILL (#60): used/limit per field, with `seen` set from whether the
  // input was a string at all. An UNSEEN field (undefined) carries no fabricated
  // fill — used + fillPct stay 0 so the UI shows UNKNOWN, never a measured "0".
  const fieldFill: FieldFill[] = (["name", "subtitle", "keywords"] as const).map((field) => {
    const raw = copy[field];
    const seen = raw !== undefined;
    const used = seen ? raw.length : 0;
    const limit = CHAR_LIMITS[field];
    const fillPct = seen ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
    return { field, limit, used, fillPct, seen };
  });

  const brandTokens = new Set(tokenize(opts.brand));

  // Tokenize each field; brand tokens are removed from the normal term analysis
  // (they're handled by the brand_repeat rule, never double-counted as dupes).
  const nameTokens = tokenize(copy.name).filter((t) => !brandTokens.has(t));
  const subtitleTokens = tokenize(copy.subtitle).filter((t) => !brandTokens.has(t));
  const keywordTokens = tokenize(copy.keywords).filter((t) => !brandTokens.has(t));

  const waste: CoverageWaste[] = [];

  // ── brand_repeat: a brand word that appears in the subtitle burns budget ────
  // (ties to #42). Exact-match only — we don't fuzzy-match variants (error-prone).
  const subtitleRaw = new Set(tokenize(copy.subtitle));
  for (const brandTok of brandTokens) {
    if (subtitleRaw.has(brandTok)) {
      pushWaste(waste, {
        kind: "brand_repeat",
        detail:
          `Your brand name "${brandTok}" repeats in the subtitle — ${brandTok.length} chars Apple already ` +
          `indexes from the title. Move them to a fresh keyword (double-check variant spellings yourself).`,
        chars: brandTok.length,
      });
    }
  }

  // ── duplicate: a non-brand term appearing in 2+ fields (counted once) ───────
  const fieldSets = [new Set(nameTokens), new Set(subtitleTokens), new Set(keywordTokens)];
  const allNonBrand = new Set<string>([...nameTokens, ...subtitleTokens, ...keywordTokens]);
  for (const term of allNonBrand) {
    const inFields = fieldSets.filter((s) => s.has(term)).length;
    if (inFields >= 2) {
      pushWaste(waste, {
        kind: "duplicate",
        detail:
          `'${term}' repeats across ${inFields} fields — Apple counts it once, so ${term.length} chars ` +
          `are doing nothing. Consolidate to one field and reclaim the space.`,
        chars: term.length,
      });
    }
  }

  // ── filler: low-relevance terms (low scoreKeyword) — advisory, not a command ─
  // Dedup so a term flagged in two fields isn't counted twice as filler.
  const seenFiller = new Set<string>();
  for (const term of allNonBrand) {
    if (seenFiller.has(term)) continue;
    seenFiller.add(term);
    if (termScore(term) < FILLER_SCORE_FLOOR) {
      pushWaste(waste, {
        kind: "filler",
        detail:
          `'${term}' is a low-relevance filler term (low keyword value) — ${term.length} chars that ` +
          `likely aren't pulling ranking weight. Consider a higher-value keyword; your call.`,
        chars: term.length,
      });
    }
  }

  // ── distinct terms: unique non-brand tokens across all fields ───────────────
  const distinctTerms = allNonBrand.size;

  // ── coverage math: (budget − total waste) / budget, clamped 0–100 ───────────
  // Unused space is deliberately NOT waste — a short clean listing stays at 100%.
  // But an EMPTY listing (zero working terms) isn't "100% efficient" — there's
  // nothing working at all — so it floors at 0. Coverage only rewards a listing
  // that has at least one distinct ranking term to begin with.
  const totalWaste = waste.reduce((sum, w) => sum + w.chars, 0);
  const coverageScore =
    distinctTerms === 0
      ? 0
      : Math.max(0, Math.min(100, ((AVAILABLE_BUDGET - totalWaste) / AVAILABLE_BUDGET) * 100));

  return {
    coverageScore,
    usedChars,
    fieldFill,
    distinctTerms,
    waste,
    // topMissingValue deferred to the gap finder (#01) — omitted (exactOptional).
  };
}
