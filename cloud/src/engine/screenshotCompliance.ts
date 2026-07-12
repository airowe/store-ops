/**
 * Screenshot claim-compliance lens (#178 Phase 3). Screenshots are REVIEWED
 * metadata, and the same claim rules that trip a title/subtitle trip a
 * screenshot caption: an unverifiable "#1 / best" claim or price/promo wording
 * baked into the art is a rejection risk (Guideline 2.3.7). This runs the
 * copy-lint claim predicates over the OCR'd first-screenshot caption (#182) so
 * the risk is caught before submission — same findings card, no new UI.
 *
 * Honesty, load-bearing:
 *   • the caption is MEASURED (OCR'd from the user's real screenshot, quoted
 *     verbatim), and each finding cites the guideline VERBATIM (reviewGuidelines),
 *   • a hit is FLAGGED, never "Apple's verdict" — a labelled heuristic,
 *   • MEASURED-OR-ABSENT: no caption (OCR off / unreadable) → nothing. Clean
 *     caption text → nothing.
 *
 * Scope note: this is the CLAIM-TEXT half of screenshot compliance. Pixel checks
 * (status bars, frame sizing, format) need image analysis and are out of scope —
 * a false "compliant" is worse than a silent pass, so we only flag what the
 * measured caption text substantiates.
 *
 * Pure + deterministic. The OCR that produces the caption lives in the API
 * adapter (aiCaptionVision.ts); this module is the lint, unit-testable with text.
 */
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";
import { hasPricePromo, hasUnverifiableClaim } from "./reviewRisk.js";
import { citeEvidence } from "./reviewGuidelines.js";

const CAVEAT = "Flagged as a review risk — a heuristic, not Apple's verdict; review before you submit.";

/**
 * Lint an OCR'd screenshot caption for review-risky claims. Returns [] for no
 * caption or clean text. At most one finding per rule (claim, price).
 */
export function screenshotClaimFindings(caption: string | null | undefined): Finding[] {
  const text = (caption ?? "").trim();
  if (!text) return [];
  const out: Finding[] = [];

  if (hasUnverifiableClaim(text)) {
    out.push(
      mk({
        id: "screenshot_claim_unverifiable",
        surface: "screenshots",
        severity: "warn",
        impact: "trust",
        title: "Unverifiable “#1 / best” claim in your screenshot",
        detail:
          `Your first screenshot's headline (“${text}”) makes a rank/superlative claim. Screenshots are ` +
          `reviewed metadata, so an unsubstantiated “#1 / best” there is the same rejection risk as in your title. ${CAVEAT}`,
        fix: "Drop the claim from the screenshot art or replace it with a factual, substantiated benefit.",
        evidence: citeEvidence("unverifiable_claim"),
      }),
    );
  }
  if (hasPricePromo(text)) {
    out.push(
      mk({
        id: "screenshot_claim_price",
        surface: "screenshots",
        severity: "warn",
        impact: "trust",
        title: "Pricing/promo wording baked into your screenshot",
        detail:
          `Your first screenshot's headline (“${text}”) includes price or promotion wording. Prices don't belong ` +
          `in reviewed metadata art — they change, and Apple flags them. ${CAVEAT}`,
        fix: "Move any price or promotion out of the screenshot art into your promotional text.",
        evidence: citeEvidence("price_in_metadata"),
      }),
    );
  }
  return out;
}
