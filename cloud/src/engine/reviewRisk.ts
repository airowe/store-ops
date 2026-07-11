/**
 * Review-risk copy lint (#178 Phase 1) — deterministic checks on the PROPOSED
 * metadata against well-known App Store review-rejection causes. Today we
 * validate proposed copy against field LIMITS (optimize.ts `validateCopy`); this
 * adds the missing REVIEW-guideline lens so an ASO-optimal-but-risky proposal is
 * flagged before submission.
 *
 * Honesty, load-bearing:
 *   • a hit is FLAGGED, never "Apple's verdict" — a heuristic, labelled as one,
 *   • each finding cites the specific App Review Guideline section (verbatim
 *     reference, never a paraphrase presented as authoritative),
 *   • no LLM, no network — pure regex rules on the user's own proposed copy, so
 *     it's deterministic and testable. Clean copy emits NOTHING (no fake risk).
 *
 * These are the metadata-rejection causes that are safely detectable by rule;
 * subtler judgement calls stay out (a false "risky" is worse than a silent pass).
 */
import type { Finding } from "./findings/core.js";
import type { CopyFields } from "./optimize.js";
import { deriveBrandTokens } from "./localizeCopy.js";

const SURFACE = "reviewRisk";

/** Price / promotional words don't belong in the name or subtitle (Guideline 2.3.7). */
const PRICE_RE = /\b(free|sale|\d{1,3}\s*%\s*off|discount|deal|bogo|half[-\s]?price|lowest price)\b/i;
/** Unverifiable rank/superlative claims (Guideline 2.3.1 — accurate metadata). */
const SUPERLATIVE_RE = /(#\s?1\b|\bno\.?\s?1\b|\bnumber\s?one\b|world'?s\s+(?:best|#\s?1|number\s?one)|\bbest[-\s]?in[-\s]?class\b)/i;
/** Placeholder / boilerplate text left in metadata (Guideline 2.3.8). */
const PLACEHOLDER_RE = /\b(lorem ipsum|placeholder|your app name(?: here)?|to ?do|tbd|xxxx?)\b/i;

const CAVEAT = "Flagged as a review risk — a heuristic, not Apple's verdict; review before you submit.";

function finding(id: string, title: string, detail: string, fix: string, guideline: string): Finding {
  return { id, surface: SURFACE, severity: "warn", impact: "trust", title, detail: `${detail} ${CAVEAT}`, fix, evidence: `App Review Guideline ${guideline}` };
}

/**
 * Lint the proposed copy for review-rejection risk. Returns [] for clean copy or
 * no copy. Only the name/subtitle/keywords are inspected — the fields the agent
 * proposes and the ones that actually trip metadata review.
 */
export function reviewRiskFindings(copy: Partial<CopyFields> | undefined): Finding[] {
  if (!copy) return [];
  const out: Finding[] = [];
  const name = (copy.name ?? "").trim();
  const subtitle = (copy.subtitle ?? "").trim();
  const keywords = (copy.keywords ?? "").trim();
  const titleText = `${name} ${subtitle}`.trim();

  if (titleText && PRICE_RE.test(titleText)) {
    out.push(finding(
      "review_risk_price_in_title",
      "Pricing/promo words in your title or subtitle",
      "Words like “free”, “sale”, or “% off” in the name/subtitle are a common metadata rejection — promotions belong in the promotional text, not the title.",
      "Move any price or promotion wording out of the name and subtitle.",
      "2.3.7",
    ));
  }
  if (titleText && SUPERLATIVE_RE.test(titleText)) {
    out.push(finding(
      "review_risk_superlative",
      "Unverifiable “#1 / best” claim in your metadata",
      "Rank or superlative claims (“#1”, “number one”, “world’s best”) are rejected unless you can substantiate them.",
      "Drop the claim or replace it with a factual benefit.",
      "2.3.1",
    ));
  }
  const anyText = `${titleText} ${keywords}`.trim();
  if (anyText && PLACEHOLDER_RE.test(anyText)) {
    out.push(finding(
      "review_risk_placeholder",
      "Placeholder text left in your metadata",
      "Placeholder or boilerplate text (“lorem ipsum”, “your app name”, “TODO”) in submitted metadata is an automatic rejection.",
      "Replace the placeholder with real copy.",
      "2.3.8",
    ));
  }
  // The app's own brand is already indexed from the name — repeating it in the
  // keyword field wastes the 100-char budget and reads as keyword misuse.
  const brand = deriveBrandTokens(name)[0]?.toLowerCase();
  if (brand && keywords) {
    const terms = keywords.toLowerCase().split(",").map((t) => t.trim());
    if (terms.includes(brand)) {
      out.push(finding(
        "review_risk_brand_in_keywords",
        "Your app name is in the keyword field",
        `“${brand}” is already indexed from your app name, so repeating it in keywords wastes budget and can read as keyword-field misuse.`,
        "Remove your brand from the keyword field and use the space for a term you don’t already rank for.",
        "2.3.7",
      ));
    }
  }
  return out;
}
