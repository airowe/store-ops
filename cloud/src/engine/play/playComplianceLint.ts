/**
 * Play metadata compliance lint — the Android sibling of `../reviewRisk.ts`.
 * Deterministic checks on the app TITLE against Google Play's store-listing /
 * metadata policy (title format, store-performance terms, price/promo, program
 * affiliation). The App Store lint runs on the PROPOSED copy pre-submission;
 * this runs on the READ title, which is still worth flagging because Play runs
 * retroactive enforcement sweeps — a title that slipped through (or a competitor
 * with a policy-risky title) is a real, honest finding.
 *
 * Honesty, load-bearing:
 *   • a hit is FLAGGED, never "Google's verdict" — a heuristic, labelled as one,
 *   • each finding cites the specific Play policy + rule text (playPolicy.ts),
 *   • no LLM, no network — pure regex rules; a clean title emits NOTHING,
 *   • runs ONLY on a MEASURED title (`!== null`); an unread title yields no
 *     false positives (that surface is a lock, handled in playFindings).
 *
 * Rules are curated for PRECISION — a false "risky" is worse than a silent pass —
 * so bare "top"/"best"/"popular" (common in ordinary words) are NOT matched;
 * only unambiguous store-performance phrases are.
 */
import { type Finding, mk } from "../findings/core.js";
import type { NormalizedListing } from "../store/types.js";
import { citePlayPolicy, type PlayPolicyCiteKey } from "./playPolicy.js";

const SURFACE = "title";
const CAVEAT =
  "Flagged against Google Play's policy — a heuristic, not Google's verdict; review before you ship.";

/** Emoji (pictographic) or 3+ repeated non-alphanumeric symbols in a row. */
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const REPEATED_SPECIAL_RE = /([^\p{L}\p{N}\s])\1{2,}/u;

/** Store-performance / ranking / award claims (curated, high-precision). */
const PERFORMANCE_RE =
  /(#\s?1\b|\bno\.?\s?1\b|\bnumber\s?one\b|\bbest[-\s]?(?:selling|rated|in[-\s]?class)\b|\btop[-\s]?(?:rated|grossing|charts?)\b|\baward[-\s]?winning\b)/i;
/** Price / promotional wording that doesn't belong in a title. */
const PRICE_PROMO_RE =
  /\b(free|sale|\d{1,3}\s*%\s*off|discount|cash\s?back|(?:for a )?limited[-\s]?time)\b/i;
/** Terms implying a relationship to a Google Play program. */
const PROGRAM_RE = /(\beditors?'?\s*choice\b|\bgoogle\s*play\b|\bplay\s*store\b)/i;

/** Emoji / emoticon / repeated special characters in a title. (best practices) */
export function hasEmojiOrRepeatedSpecials(text: string): boolean {
  return EMOJI_RE.test(text) || REPEATED_SPECIAL_RE.test(text);
}
/** An unambiguous store-performance / rank / award claim. (best practices) */
export function hasPerformanceClaim(text: string): boolean {
  return PERFORMANCE_RE.test(text);
}
/** Price / promotional wording. (best practices) */
export function hasPlayPricePromo(text: string): boolean {
  return PRICE_PROMO_RE.test(text);
}
/** A term implying affiliation with a Google Play program. (best practices) */
export function impliesPlayProgram(text: string): boolean {
  return PROGRAM_RE.test(text);
}

function finding(
  id: string,
  title: string,
  detail: string,
  fix: string,
  cite: PlayPolicyCiteKey,
): Finding {
  return mk({
    id,
    surface: SURFACE,
    severity: "warn",
    impact: "trust",
    title,
    detail: `${detail} ${CAVEAT}`,
    fix,
    evidence: citePlayPolicy(cite),
  });
}

/**
 * Lint the listing's title against Play policy. Returns [] for a clean title or
 * an unread one (never a false positive on a surface we couldn't see). Pure +
 * deterministic.
 */
export function playComplianceFindings(listing: NormalizedListing): Finding[] {
  const title = listing.title;
  if (title === null) return []; // unread → the title surface is a lock, not this
  const t = title.trim();
  if (t === "") return []; // measured-empty → handled by play_title_missing
  const out: Finding[] = [];

  if (hasEmojiOrRepeatedSpecials(t)) {
    out.push(
      finding(
        "play_title_format_risk",
        "Emoji or decorative characters in your title",
        "Google Play's store-listing rules disallow emoji, emoticons, and repeated special characters in the app title — they're a common metadata-enforcement trigger.",
        "Remove the emoji / repeated symbols from the title.",
        "title_format",
      ),
    );
  }
  if (hasPerformanceClaim(t)) {
    out.push(
      finding(
        "play_title_performance_claim",
        "Store-performance claim in your title",
        "Ranking or award claims (“#1”, “best-selling”, “top-rated”, “award-winning”) in the title are disallowed and are a frequent takedown reason in Play's metadata sweeps.",
        "Drop the claim or replace it with a factual benefit.",
        "performance_terms",
      ),
    );
  }
  if (hasPlayPricePromo(t)) {
    out.push(
      finding(
        "play_title_price_promo",
        "Price or promo wording in your title",
        "Price/promotion words (“free”, “sale”, “% off”) don't belong in the title under Play's store-listing rules — promotions belong in the description, not the title.",
        "Move any price or promotion wording out of the title.",
        "price_promo",
      ),
    );
  }
  if (impliesPlayProgram(t)) {
    out.push(
      finding(
        "play_title_program_affiliation",
        "Title implies a Google Play program affiliation",
        "Terms like “Editors' Choice” or “Google Play” in the title imply an affiliation with a Play program and are disallowed unless granted.",
        "Remove the program/affiliation wording from the title.",
        "program_affiliation",
      ),
    );
  }
  return out;
}
