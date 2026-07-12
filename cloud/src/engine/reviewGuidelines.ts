/**
 * A tiny, hand-curated corpus of the App Store Review Guidelines sections the
 * review-risk lint cites (#178 Phase 2). Each entry carries the section number
 * and the VERBATIM guideline text (copied word-for-word from Apple's public
 * guidelines at developer.apple.com/app-store/review/guidelines/, "2.3 Accurate
 * Metadata"), so a review-risk finding quotes the actual rule rather than a
 * paraphrase presented as authoritative.
 *
 * Honesty, load-bearing:
 *   • quotes are VERBATIM — full sentences, no mid-sentence elision, no
 *     rewording. If Apple changes the wording, this corpus is updated to match;
 *     we never "improve" the quote.
 *   • the citation is a REFERENCE, not a verdict — the finding still labels the
 *     hit as a heuristic ("flagged, not Apple's verdict").
 *
 * NOTE: guidelines are re-worded by Apple a few times a year. When they drift,
 * re-copy the exact text here (the section numbers are stable far longer than
 * the prose). Keep every `quote` a verbatim substring of the live page.
 */

/** A cited guideline: the section number + the verbatim rule text. */
export type GuidelineCite = { section: string; quote: string };

/**
 * Keyed by an internal rule id (NOT the section, because several rules cite the
 * same section with different sentences). Every `quote` is a complete, verbatim
 * sentence from the guidelines page.
 */
export const REVIEW_GUIDELINE_CITES = {
  /** Prices/terms don't belong in metadata fields — 2.3.7. */
  price_in_metadata: {
    section: "2.3.7",
    quote:
      "Metadata such as app names, subtitles, screenshots, and previews should not include prices, terms, or descriptions that are not specific to the metadata type.",
  },
  /** Subtitles (and by extension names) must not make unverifiable claims — 2.3.7. */
  unverifiable_claim: {
    section: "2.3.7",
    quote:
      "App subtitles are a great way to provide additional context for your app; they must follow our standard metadata rules and should not include inappropriate content, reference other apps, or make unverifiable product claims.",
  },
  /** Don't pack metadata with trademarks, popular names, or irrelevant phrases — 2.3.7. */
  keyword_packing: {
    section: "2.3.7",
    quote:
      "Choose a unique app name, assign keywords that accurately describe your app, and don't try to pack any of your metadata with trademarked terms, popular app names, pricing information, or other irrelevant phrases just to game the system.",
  },
  /** Metadata must be accurate + complete (placeholder text isn't) — 2.3 intro. */
  accurate_metadata: {
    section: "2.3",
    quote:
      "Customers should know what they're getting when they download or buy your app, so make sure all your app metadata, including privacy information, your app description, screenshots, and previews accurately reflect the app's core experience and remember to keep them up-to-date with new versions.",
  },
} as const satisfies Record<string, GuidelineCite>;

export type GuidelineCiteKey = keyof typeof REVIEW_GUIDELINE_CITES;

/**
 * The `evidence` string for a finding: the section reference + the verbatim
 * quote, so the citation is self-substantiating on the findings card.
 */
export function citeEvidence(key: GuidelineCiteKey): string {
  const { section, quote } = REVIEW_GUIDELINE_CITES[key];
  return `App Review Guideline ${section} — “${quote}”`;
}

/**
 * The verbatim rule text for a guideline SECTION (e.g. "2.3.7"), or null when the
 * section isn't in our curated corpus. Several rules can cite one section; we
 * return the first cite's quote (each is a real, verbatim sentence of it). Used
 * by the post-rejection assistant to quote the guideline a rejection cites —
 * honestly null (never a paraphrase) when we don't hold that section's text.
 */
export function guidelineQuoteForSection(section: string): string | null {
  const s = section.trim();
  for (const cite of Object.values(REVIEW_GUIDELINE_CITES)) {
    if (cite.section === s) return cite.quote;
  }
  return null;
}
