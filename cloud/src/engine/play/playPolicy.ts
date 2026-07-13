/**
 * A tiny, hand-curated corpus of the Google Play policy rules the Play metadata
 * compliance lint cites — the Android sibling of `../reviewGuidelines.ts`.
 *
 * Sources (Google Play Developer Program policy + Play Console Help):
 *   • Metadata policy — support.google.com/googleplay/android-developer/answer/9898842
 *   • Store-listing best practices (title) — .../answer/13393723
 *   • Spam & Minimum Functionality — play.google/developer-content-policy/
 *
 * Honesty, load-bearing (same discipline as the App Store corpus):
 *   • Each cite carries the policy NAME + source URL + the rule as Google states
 *     it, so a finding references the actual policy, not our opinion.
 *   • A hit is a HEURISTIC flag, never "Google's verdict" — the finding says so.
 *   • ⚠️ Unlike the App Store corpus (copied verbatim from a page we could fetch),
 *     Google's support pages block automated fetch, so these `text` values are
 *     best-effort from Google's own indexed wording. Treat them as citations to
 *     re-confirm against the live page on drift — never "improve" them, and if a
 *     page's wording changes, re-copy it here (the policy areas are stable far
 *     longer than the prose).
 */

/** A cited Play policy rule: the policy name, its URL, and the rule text. */
export type PlayPolicyCite = { policy: string; url: string; text: string };

/**
 * Keyed by an internal rule id (several rules can reference the same policy page
 * with a different requirement).
 */
export const PLAY_POLICY_CITES = {
  /** Misleading / excessive / inappropriate metadata — Metadata policy. */
  misleading_metadata: {
    policy: "Metadata",
    url: "https://support.google.com/googleplay/android-developer/answer/9898842",
    text:
      "We don't allow apps with misleading, improperly formatted, non-descriptive, irrelevant, excessive, or inappropriate metadata, including but not limited to the app's description, developer name, title, icon, screenshots, and promotional images.",
  },
  /** Title length ceiling — store-listing best practices. */
  title_length: {
    policy: "Store listing (title)",
    url: "https://support.google.com/googleplay/android-developer/answer/13393723",
    text: "App titles are limited to 30 characters.",
  },
  /** Emoji / repeated special chars / ALL CAPS in the title — best practices. */
  title_format: {
    policy: "Store listing (title)",
    url: "https://support.google.com/googleplay/android-developer/answer/13393723",
    text:
      "Avoid emojis, emoticons, repeated special characters, and ALL CAPS (unless part of your brand name) in the app title.",
  },
  /** Store-performance / ranking terms in the title — best practices. */
  performance_terms: {
    policy: "Store listing (title)",
    url: "https://support.google.com/googleplay/android-developer/answer/13393723",
    text:
      "Don't include terms that reference store performance, ranking, or awards (for example “#1”, “Best”, “Top”, “Popular”) in the app title.",
  },
  /** Price / promotional info in the title — best practices. */
  price_promo: {
    policy: "Store listing (title)",
    url: "https://support.google.com/googleplay/android-developer/answer/13393723",
    text:
      "Don't include price or promotional information (for example “free”, “sale”, “% off”) in the app title.",
  },
  /** Terms implying a relationship to a Google Play program — best practices. */
  program_affiliation: {
    policy: "Store listing (title)",
    url: "https://support.google.com/googleplay/android-developer/answer/13393723",
    text:
      "Don't use terms that imply store performance or affiliation with a Google Play program (for example “Editors' Choice”) unless it has been granted.",
  },
} as const satisfies Record<string, PlayPolicyCite>;

export type PlayPolicyCiteKey = keyof typeof PLAY_POLICY_CITES;

/**
 * The `evidence` string for a Play finding: the policy name + rule text + URL,
 * so the citation is self-substantiating on the findings card.
 */
export function citePlayPolicy(key: PlayPolicyCiteKey): string {
  const { policy, url, text } = PLAY_POLICY_CITES[key];
  return `Google Play ${policy} policy — “${text}” (${url})`;
}
