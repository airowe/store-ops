/**
 * Google Play keyword model — Play's ranking inputs, NOT iOS's keyword field.
 *
 * Play has NO keyword field. It indexes the title (30), short description (80)
 * and long description (4000), ranking on the long description's term coverage /
 * frequency. So this model is fundamentally different from the iOS keyword-field
 * packing in `optimize.ts`/`keywords.ts`:
 *   • There is NO comma keyword field to build, and NO `buildKeywordField`.
 *   • Bucket intent for Play (handled by the optimizer, not here): Primary → the
 *     title, Secondary → the short description, Long-tail → woven into the long
 *     description body, Aspirational → tracked only.
 *   • The lever is COVERAGE/DENSITY of target terms in the indexed text, plus a
 *     STUFFING guard (over-repetition is a Play risk — the inverse of iOS's
 *     "fill the field").
 *
 * HONESTY (constraint #1): we report term PRESENCE and OCCURRENCE COUNTS — these
 * are MEASURED (we read the text). We report NO search volume or keyword "value":
 * Play publishes none, so we never put a number on it (the same reason iOS
 * declines to show fake keyword-volume numbers).
 *
 * Pure + deterministic; no fetch/Date/random. Targets are supplied by the caller
 * (typically grounded via `keywordReasoner` against the long description) — this
 * module only measures how the listing covers them.
 */

/** How one target term is covered across the indexed Play fields. */
export type PlayTermCoverage = {
  /** the normalized target term. */
  term: string;
  inTitle: boolean;
  inShortDescription: boolean;
  /** present at least once in the long description. */
  inDescription: boolean;
  /** MEASURED occurrences in the long description (never extrapolated to volume). */
  descriptionCount: number;
  /** present anywhere in the indexed text. */
  covered: boolean;
};

export type PlayKeywordReport = {
  /** per-target coverage, in input order (deduped). */
  terms: PlayTermCoverage[];
  /** targets ABSENT from the long description — the keyword surface they miss. */
  missingFromDescription: string[];
  /** targets present in NO indexed field at all. */
  uncovered: string[];
  /** targets OVER-repeated in the long description (stuffing risk) — never a rank claim. */
  stuffed: string[];
};

export type PlayKeywordInput = {
  title?: string | undefined;
  shortDescription?: string | undefined;
  description?: string | undefined;
  /** target search terms to measure coverage for (single- or multi-word). */
  targets: string[];
};

export type PlayKeywordOptions = {
  /** occurrences in the long description above which a term reads as stuffing. */
  stuffingMax?: number | undefined;
};

const DEFAULT_STUFFING_MAX = 6;

/** Normalize a term/text fragment for word-boundary comparison. */
function norm(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Dedupe normalized terms, preserving first-seen order; drop empties. */
function uniqTargets(targets: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of targets) {
    const n = norm(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Whole-word/phrase presence of `term` in `text` (both pre-normalized). */
function contains(text: string, term: string): boolean {
  if (!term) return false;
  return ` ${text} `.includes(` ${term} `);
}

/** Count non-overlapping whole-word/phrase occurrences of `term` in `text`. */
function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  const padded = ` ${text} `;
  let count = 0;
  let from = 0;
  const needle = ` ${term} `;
  // Overlapping pads (the trailing space of one match is the leading space of the
  // next) mean we step back one char so adjacent repeats are both counted.
  for (;;) {
    const i = padded.indexOf(needle, from);
    if (i < 0) break;
    count++;
    from = i + needle.length - 1;
  }
  return count;
}

/**
 * Measure how a Play listing's indexed text covers a set of target terms. Pure.
 * Presence + counts are MEASURED; no value/volume is invented.
 */
export function analyzePlayKeywords(
  input: PlayKeywordInput,
  opts: PlayKeywordOptions = {},
): PlayKeywordReport {
  const stuffingMax = opts.stuffingMax ?? DEFAULT_STUFFING_MAX;
  const title = norm(input.title);
  const short = norm(input.shortDescription);
  const description = norm(input.description);

  const terms: PlayTermCoverage[] = uniqTargets(input.targets).map((term) => {
    const inTitle = contains(title, term);
    const inShortDescription = contains(short, term);
    const descriptionCount = countOccurrences(description, term);
    const inDescription = descriptionCount > 0;
    return {
      term,
      inTitle,
      inShortDescription,
      inDescription,
      descriptionCount,
      covered: inTitle || inShortDescription || inDescription,
    };
  });

  return {
    terms,
    missingFromDescription: terms.filter((t) => !t.inDescription).map((t) => t.term),
    uncovered: terms.filter((t) => !t.covered).map((t) => t.term),
    stuffed: terms.filter((t) => t.descriptionCount > stuffingMax).map((t) => t.term),
  };
}
