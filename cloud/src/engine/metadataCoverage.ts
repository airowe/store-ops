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

/** The three ranking fields, in their canonical order. */
export type CoverageField = "name" | "subtitle" | "keywords";

/** A single itemized unit of wasted budget. */
export type CoverageWaste = {
  kind: "duplicate" | "brand_repeat" | "filler" | "unused";
  /** human-facing explanation, e.g. "'weather' repeats across fields — 7 wasted chars". */
  detail: string;
  /** the wasted character count attributed to this item. */
  chars: number;
  /**
   * #322: WHICH field(s) this waste actually lives in, in name → subtitle →
   * keywords order. The customer's first question about a flagged term is
   * "where is it?" — the analysis already knows (it tokenizes per field), so we
   * report it rather than making them go hunting. Always a MEASURED list: a term
   * is listed for a field only because it was tokenized out of that field.
   */
  fields: CoverageField[];
  /**
   * #322: is removing this safe to do automatically? True ONLY for filler that
   * lives exclusively in the KEYWORD field — Apple ignores prepositions/articles
   * there for ranking, so stripping them is pure reclaimed chars with no
   * readability cost. Filler in the name/subtitle is a READABILITY tradeoff that
   * belongs to the human, so it stays false, as do duplicates and brand repeats
   * (consolidating those is a judgement call about which field keeps the term).
   */
  safeToStrip: boolean;
};

/**
 * #322: the safe, reversible keyword-field tightening — the exact before/after
 * so the change is SHOWN (like the auto-fixed duplicate in the copy diff), never
 * applied silently. Present only when the keyword field was READ and actually
 * carries strippable filler; absent means there was nothing safe to reclaim (or
 * the field was never read — unseen is not empty).
 */
export type KeywordFieldStrip = {
  /** the keyword field exactly as read. */
  before: string;
  /** the same field with keyword-only filler terms removed, order preserved. */
  after: string;
  /** the filler terms removed, in the order they appeared. */
  removed: string[];
  /** chars reclaimed — before.length − after.length. */
  reclaimedChars: number;
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
  /**
   * #322: the safe keyword-field tightening (before/after/removed), when there
   * is one. Omitted when nothing is safely strippable — never an empty no-op.
   */
  keywordFieldStrip?: KeywordFieldStrip | undefined;
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

/** Canonical field order — every `fields` list is reported in this order. */
const FIELD_ORDER: readonly CoverageField[] = ["name", "subtitle", "keywords"] as const;

/** Human label for a field list, e.g. "the name and keyword fields". */
function fieldPhrase(fields: CoverageField[]): string {
  const label = (f: CoverageField) => (f === "keywords" ? "keyword field" : `${f} field`);
  if (fields.length === 0) return "your listing"; // unreachable in practice
  if (fields.length === 1) return `your ${label(fields[0]!)}`;
  const names = fields.map(label);
  return `your ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

/**
 * Split a keyword field into its comma-separated entries, keeping each entry's
 * ORIGINAL text (including surrounding whitespace) so a rebuild preserves the
 * author's spacing style ("rain, thunder" stays spaced, "rain,thunder" doesn't).
 */
function splitKeywordEntries(keywords: string): string[] {
  return keywords.split(",");
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
        // By construction this rule only fires on the subtitle.
        fields: ["subtitle"],
        // Which field keeps the brand word is a judgement call, not an auto-fix.
        safeToStrip: false,
      });
    }
  }

  // ── duplicate: a non-brand term appearing in 2+ fields (counted once) ───────
  // #322: the per-field sets are no longer discarded — they ARE the answer to
  // "which field is this in?", the question the customer hits first.
  const fieldSets: Record<CoverageField, Set<string>> = {
    name: new Set(nameTokens),
    subtitle: new Set(subtitleTokens),
    keywords: new Set(keywordTokens),
  };
  /** The fields a term was actually tokenized out of, in canonical order. */
  const fieldsFor = (term: string): CoverageField[] =>
    FIELD_ORDER.filter((f) => fieldSets[f].has(term));

  const allNonBrand = new Set<string>([...nameTokens, ...subtitleTokens, ...keywordTokens]);
  for (const term of allNonBrand) {
    const fields = fieldsFor(term);
    if (fields.length >= 2) {
      pushWaste(waste, {
        kind: "duplicate",
        detail:
          `'${term}' repeats across ${fields.length} fields (${fields.join(", ")}) — Apple counts it once, ` +
          `so ${term.length} chars are doing nothing. Consolidate to one field and reclaim the space.`,
        chars: term.length,
        fields,
        // Which field should KEEP the term is the human's call, not ours.
        safeToStrip: false,
      });
    }
  }

  // ── filler: low-relevance terms (low scoreKeyword) — advisory, not a command ─
  // Dedup so a term flagged in two fields isn't counted twice as filler.
  //
  // #322 splits filler into two honestly different cases:
  //   • KEYWORD-FIELD-ONLY filler — Apple ignores prepositions/articles there for
  //     ranking, so removing it is pure reclaimed chars. Safe to strip, and we
  //     say what it costs instead of punting with "your call".
  //   • filler that appears in the NAME or SUBTITLE — that's customer-facing copy,
  //     so it's a READABILITY tradeoff. We surface the field and the text, but we
  //     do NOT invent a replacement keyword we have no winnability signal for;
  //     "your call" stays, which the issue explicitly allows.
  const seenFiller = new Set<string>();
  for (const term of allNonBrand) {
    if (seenFiller.has(term)) continue;
    seenFiller.add(term);
    if (termScore(term) >= FILLER_SCORE_FLOOR) continue;

    const fields = fieldsFor(term);
    const keywordOnly = fields.length === 1 && fields[0] === "keywords";
    const detail = keywordOnly
      ? `'${term}' is a low-relevance filler term sitting in your keyword field — ${term.length} chars ` +
        `Apple ignores for ranking there. Safe to strip: it reclaims the space with no change to what ` +
        `customers read.`
      : `'${term}' is a low-relevance filler term (low keyword value) in ${fieldPhrase(fields)} — ` +
        `${term.length} chars that likely aren't pulling ranking weight. That's customer-facing copy, so ` +
        `tightening it is a readability tradeoff; your call.`;

    pushWaste(waste, {
      kind: "filler",
      detail,
      chars: term.length,
      fields,
      safeToStrip: keywordOnly,
    });
  }

  // ── #322: the safe, reversible keyword-field tightening ────────────────────
  // Drop the keyword-field entries that are pure low-value filler, preserving
  // the author's original order and spacing. This is computed and SHOWN, never
  // applied — the caller renders before/after so the change is reviewable (the
  // same treatment the auto-fixed duplicate gets in the copy diff).
  //
  // A filler term that ALSO appears in the name/subtitle is still stripped HERE
  // (Apple ignores it in the keyword field regardless), but its waste item stays
  // safeToStrip:false, because the copy-side occurrence is the human's call.
  let keywordFieldStrip: KeywordFieldStrip | undefined;
  if (copy.keywords !== undefined) {
    const entries = splitKeywordEntries(copy.keywords);
    const removed: string[] = [];
    const kept: string[] = [];
    for (const entry of entries) {
      const token = entry.trim().toLowerCase();
      // Only single-token, non-brand, sub-floor entries are strippable. A
      // multi-word phrase is left alone — we don't rewrite phrases.
      const isStrippable =
        token !== "" &&
        !brandTokens.has(token) &&
        /^[a-z0-9]+$/.test(token) &&
        termScore(token) < FILLER_SCORE_FLOOR;
      if (isStrippable) removed.push(token);
      else kept.push(entry);
    }
    if (removed.length > 0) {
      // Rebuild from the KEPT entries verbatim, then normalise the seam: the
      // leading separator of the first kept entry is dropped so a removed head
      // term doesn't leave stray leading whitespace.
      const after = kept.join(",").replace(/^\s+/, "");
      keywordFieldStrip = {
        before: copy.keywords,
        after,
        removed,
        reclaimedChars: copy.keywords.length - after.length,
      };
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
    // Omitted entirely when nothing is safely strippable (exactOptional) — an
    // absent strip means "nothing to reclaim", never an empty no-op change.
    ...(keywordFieldStrip !== undefined ? { keywordFieldStrip } : {}),
    // topMissingValue deferred to the gap finder (#01) — omitted (exactOptional).
  };
}
