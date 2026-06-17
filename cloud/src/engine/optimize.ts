/**
 * Copy optimization + validation — enforces the HARD App Store char limits
 * (from aso_copy_stub.py LIMITS, mirrored in CHAR_LIMITS) and the keyword-field
 * rules the product guarantees:
 *   • name ≤ 30, subtitle ≤ 30, keywords ≤ 100, promo ≤ 170, description ≤ 4000
 *   • keyword field: comma-separated, NO spaces, no title/subtitle word dupes
 *
 * `validateCopy` is a pure guard the agent runs before ever proposing copy — we
 * NEVER emit over-limit copy. `buildKeywordField` constructs a compliant keyword
 * field from candidate terms; `optimizeCopy` assembles a full proposed listing
 * from bucketed keywords + a base listing.
 */
import { CHAR_LIMITS, type StoreField } from "./constants.js";
import type { ScoredKeyword } from "./keywords.js";

export type CopyFields = {
  name: string;
  subtitle: string;
  keywords: string; // the keyword FIELD (comma-joined, no spaces)
  promo?: string;
  description?: string;
};

/**
 * Visibility into the authoring decisions the optimizer made — surfaced so
 * callers (and the run page) can SEE what happened rather than silently
 * degrading a thin proposal (#28).
 *   • `subtitleMode` — whether the subtitle was authored from scratch
 *     ("composed") or kept because the live value was already strong
 *     ("preserved").
 *   • `droppedKeywords` — gap terms that could NOT be placed for space even
 *     after displacing redundant existing terms. Never a silent no-op (#37.2).
 */
export type OptimizationNotes = {
  subtitleMode?: "composed" | "preserved";
  droppedKeywords?: string;
};

export type FieldCheck = {
  field: StoreField;
  value: string;
  count: number;
  limit: number;
  ok: boolean;
  issues: string[];
};

export type CopyValidation = {
  pass: boolean;
  checks: FieldCheck[];
};

/** Split a keyword field into terms (comma-separated). */
function splitKeywordField(field: string): string[] {
  return field
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Lowercased word set from a phrase (for dup detection vs title/subtitle). */
function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
}

/**
 * Validate a full set of copy fields. Returns pass/fail plus a per-field
 * breakdown with char counts and any rule violations. NEVER mutates input.
 */
export function validateCopy(fields: CopyFields): CopyValidation {
  const checks: FieldCheck[] = [];

  const simple = (field: StoreField, value: string): FieldCheck => {
    const limit = CHAR_LIMITS[field];
    const issues: string[] = [];
    if (value.length > limit) {
      issues.push(`over limit by ${value.length - limit} (${value.length}/${limit})`);
    }
    return { field, value, count: value.length, limit, ok: issues.length === 0, issues };
  };

  checks.push(simple("name", fields.name));
  checks.push(simple("subtitle", fields.subtitle));

  // keyword field: length + comma-separated + NO spaces + no title/subtitle dupes
  {
    const value = fields.keywords;
    const limit = CHAR_LIMITS.keywords;
    const issues: string[] = [];
    if (value.length > limit) {
      issues.push(`over limit by ${value.length - limit} (${value.length}/${limit})`);
    }
    if (/,\s/.test(value) || /\s,/.test(value)) {
      issues.push("keyword field must be comma-separated with NO spaces around commas");
    }
    const banned = new Set([...words(fields.name), ...words(fields.subtitle)]);
    const terms = splitKeywordField(value);
    const dupes = terms.filter((t) => [...words(t)].some((w) => banned.has(w)));
    if (dupes.length) {
      issues.push(`keyword field duplicates title/subtitle word(s): ${dupes.join(", ")}`);
    }
    checks.push({
      field: "keywords",
      value,
      count: value.length,
      limit,
      ok: issues.length === 0,
      issues,
    });
  }

  if (fields.promo !== undefined) checks.push(simple("promo", fields.promo));
  if (fields.description !== undefined) checks.push(simple("description", fields.description));

  return { pass: checks.every((c) => c.ok), checks };
}

/**
 * Build a compliant keyword field from candidate terms:
 *   • drops any term whose words collide with the title/subtitle,
 *   • lowercases + de-dupes terms,
 *   • joins comma-separated with NO spaces,
 *   • greedily packs terms up to the ≤100-char limit (never over).
 */
export function buildKeywordField(
  candidates: string[],
  { name = "", subtitle = "" }: { name?: string; subtitle?: string } = {},
): string {
  const banned = new Set([...words(name), ...words(subtitle)]);
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const raw of candidates) {
    const term = raw.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    if ([...words(term)].some((w) => banned.has(w))) continue;
    const candidate = picked.length ? `${picked.join(",")},${term}` : term;
    if (candidate.length > CHAR_LIMITS.keywords) continue;
    picked.push(term);
    seen.add(term);
  }
  return picked.join(",");
}

/** Truncate to a field's limit without splitting mid-word where avoidable. */
function fitToLimit(value: string, field: StoreField): string {
  const limit = CHAR_LIMITS[field];
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > limit * 0.6 ? cut.slice(0, lastSpace).trimEnd() : cut.trimEnd();
}

/** Sentence-case a single word (leave acronyms/casing of the rest intact). */
function sentenceCase(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * Compose a natural ≤30-char subtitle phrase from ordered candidate terms
 * (highest-value first). Deterministic — pure function of its input:
 *   • de-dupes by word so "calm" + "calm focus" don't repeat "calm",
 *   • greedily appends whole terms while they fit the budget (never truncates
 *     mid-term, never emits over-limit),
 *   • sentence-cases the lead word and lowercases the rest for a readable phrase,
 *   • emits NO trailing punctuation/whitespace.
 * A SINGLE usable term still yields that term (a one-word phrase) — the caller
 * decides whether one word is "weak"; this function just authors from what it
 * is given. Returns "" when there is nothing usable.
 */
export function composeSubtitle(terms: string[]): string {
  const limit = CHAR_LIMITS.subtitle;
  const usedWords = new Set<string>();
  const parts: string[] = [];
  for (const raw of terms) {
    const term = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!term) continue;
    const termWords = term.split(" ");
    // skip a term whose words are already all present (no new signal)
    if (termWords.every((w) => usedWords.has(w))) continue;
    const next = parts.length ? `${parts.join(" ")} ${term}` : term;
    if (next.length > limit) continue; // try the next (possibly shorter) term
    parts.push(term);
    for (const w of termWords) usedWords.add(w);
  }
  if (!parts.length) return "";
  const phrase = parts.join(" ");
  return sentenceCase(phrase);
}

/**
 * A live subtitle is STRONG (preserve it — #30 no-regression) when it carries
 * real authored signal: a multi-word phrase. An empty value or a single bare
 * keyword is WEAK → author from scratch (#38/#37.1). A human-authored two-word
 * phrase ("Calm mind") is strong regardless of length — never regress it.
 */
function isStrongSubtitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 2;
}

export type ProposedCopy = CopyFields & {
  validation: CopyValidation;
  optimization?: OptimizationNotes;
};

/**
 * Assemble a proposed listing from bucketed keywords + a base listing.
 * Primary anchors the name, Secondary the subtitle, Long-tail feeds the keyword
 * field. Output is guaranteed within limits (over-limit copy is never emitted).
 */
export function optimizeCopy(
  scored: ScoredKeyword[],
  base: { name: string; subtitle?: string; keywords?: string; promo?: string; description?: string },
  opts: { canWriteSubtitleKeywords?: boolean } = {},
): ProposedCopy {
  // #30: only propose subtitle/keywords when we could actually READ the live
  // values (ASC-connected). The public iTunes API can't return them, so without
  // a read we'd be overwriting blind — which downgraded a real listing (Heathen).
  // When we can't read them, we leave them out entirely rather than guess.
  const canWriteSubKw = opts.canWriteSubtitleKeywords ?? true;

  const primary = scored.filter((k) => k.bucket === "Primary").map((k) => k.keyword);
  const secondary = scored.filter((k) => k.bucket === "Secondary").map((k) => k.keyword);
  const longTail = scored.filter((k) => k.bucket === "Long-tail").map((k) => k.keyword);

  // Keep the base copy as the spine; the anchor terms inform it but we don't
  // blindly overwrite human copy — we ensure it fits and surface the anchors.
  const name = fitToLimit(base.name || (primary[0] ?? ""), "name");

  let subtitle = "";
  let keywords = "";
  const notes: OptimizationNotes = {};
  if (canWriteSubKw) {
    // COMPOSE vs EDIT (#38/#37.1/#37.3):
    //   • a STRONG live subtitle (multi-word, meaningful length) is PRESERVED —
    //     never regressed (the #30 guarantee);
    //   • an EMPTY or WEAK (single-word / too-short) value is AUTHORED from
    //     scratch — a natural multi-word phrase composed from the top scored
    //     terms + the brand name, NOT a lone bare keyword.
    const liveSubtitle = (base.subtitle ?? "").trim();
    if (isStrongSubtitle(liveSubtitle)) {
      subtitle = fitToLimit(liveSubtitle, "subtitle");
      notes.subtitleMode = "preserved";
    } else {
      // Author from the highest-value distinct terms; the brand name is a weak
      // tail cue so the phrase still reads naturally if room remains.
      const composed = composeSubtitle([...secondary, ...primary, ...longTail, name]);
      subtitle = fitToLimit(composed, "subtitle");
      notes.subtitleMode = "composed";
    }

    // Keyword field — the live field is a FLOOR (#30, non-negotiable): every
    // UNIQUE live term that fits is preserved. But the floor must NOT silently
    // STARVE new gap terms (#37.2). Strategy:
    //   1. Drop REDUNDANT existing terms — live terms whose signal a higher-value
    //      scored term already carries (same words) — to free space without
    //      losing any unique niche signal.
    //   2. Pack the (de-redundant) live floor FIRST so unique niche terms are
    //      never regressed.
    //   3. Append NEW gap terms into whatever room remains.
    //   4. SURFACE any gap term still unplaced as `droppedKeywords` — never a
    //      silent no-op.
    const existing = (base.keywords ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const existingSet = new Set(existing.map((t) => t.toLowerCase()));
    const scoredTerms = [...longTail, ...secondary, ...primary];
    const gapTerms = scoredTerms.filter((t) => !existingSet.has(t.trim().toLowerCase()));

    // A live term is REDUNDANT if every one of its words is already supplied by a
    // gap term — those are the only existing terms we'll let gap terms displace.
    const gapWords = new Set<string>();
    for (const g of gapTerms) for (const w of words(g)) gapWords.add(w);
    const nonRedundantExisting = existing.filter((t) => {
      const tw = [...words(t)];
      return tw.length === 0 || !tw.every((w) => gapWords.has(w));
    });

    // Floor first (unique niche signal preserved), then gap terms fill the rest.
    keywords = buildKeywordField([...nonRedundantExisting, ...gapTerms], { name, subtitle });

    // Surface any gap term that could not be placed for SPACE (not a
    // title/subtitle collision, which is a rule exclusion, not starvation).
    const placed = new Set(splitKeywordField(keywords).map((t) => t.toLowerCase()));
    const bannedKw = new Set([...words(name), ...words(subtitle)]);
    const dropped: string[] = [];
    const droppedSeen = new Set<string>();
    for (const t of gapTerms) {
      const lc = t.trim().toLowerCase();
      if (!lc || placed.has(lc) || droppedSeen.has(lc)) continue;
      if ([...words(lc)].some((w) => bannedKw.has(w))) continue;
      droppedSeen.add(lc);
      dropped.push(lc);
    }
    if (dropped.length) notes.droppedKeywords = dropped.join(",");
  }

  const fields: CopyFields = {
    name,
    subtitle,
    keywords,
    ...(base.promo !== undefined ? { promo: fitToLimit(base.promo, "promo") } : {}),
    ...(base.description !== undefined
      ? { description: fitToLimit(base.description, "description") }
      : {}),
  };

  const hasNotes = notes.subtitleMode !== undefined || notes.droppedKeywords !== undefined;
  return {
    ...fields,
    validation: validateCopy(fields),
    ...(hasNotes ? { optimization: notes } : {}),
  };
}
