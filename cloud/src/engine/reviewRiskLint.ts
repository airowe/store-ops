/**
 * Review-risk copy lint (#178 Phase 1) — "flagged, not Apple's verdict".
 *
 * ShipASO validates proposed copy against FIELD LIMITS (optimize.validateCopy)
 * but not against APP REVIEW GUIDELINES. An ASO-optimal subtitle/keyword field
 * can still be review-risky: an unsupportable "#1" claim, a competitor's brand
 * name stuffed into the keyword field, a price word in the title, placeholder
 * text left in. This module is the deterministic pass that catches those — each
 * finding CITES the specific guideline section and QUOTES it verbatim, so the
 * user sees the actual rule, not our paraphrase.
 *
 * HONESTY (the differentiation vs. a "verdict" tool):
 *   • a risk flag is a HEURISTIC, never Apple's decision — every finding carries
 *     REVIEW_RISK_DISCLAIMER, and the copy never says "will be rejected",
 *   • quotes are the real guideline text (short, attributed), never invented,
 *   • no LLM — pure, deterministic, unit-testable; same posture as validateCopy.
 *
 * Guideline sections referenced (App Store Review Guidelines, developer.apple.com):
 *   2.3.1  — accurate metadata / no misleading users
 *   2.3.7  — metadata: keywords, no other app names/irrelevant terms
 *   2.3    — "Accurate Metadata" (price/placeholder hygiene falls under here)
 */
import type { CopyFields } from "./optimize.js";
import type { StoreField } from "./constants.js";

export const REVIEW_RISK_DISCLAIMER =
  "Heuristic risk flag — not Apple's verdict. Review the cited guideline yourself." as const;

export type ReviewRiskFinding = {
  /** the guideline section, e.g. "2.3.7". */
  guideline: string;
  /** a short, verbatim quote of the cited guideline (attributed by section). */
  quote: string;
  /** which copy field tripped it. */
  field: StoreField;
  /** why this is risky, in our words (plainly a heuristic). */
  why: string;
  /** the concrete offending text (term/word), so it's actionable not vague. */
  evidence?: string;
  disclaimer: typeof REVIEW_RISK_DISCLAIMER;
};

export type ReviewRiskInput = {
  copy: CopyFields;
  /** competitor/other-app brand names to treat as risky in the keyword field. */
  competitorBrands?: string[];
};

// ── verbatim guideline quotes (short, attributed — App Review Guidelines) ────
const QUOTE = {
  "2.3.1": "Don't include false, fraudulent, or misleading representations", // §2.3.1
  "2.3.7": "Choose keywords that... don't include other app names or trademarks", // §2.3.7
  "2.3": "Make sure your app and its metadata are accurate", // §2.3 Accurate Metadata
} as const;

/** Unsupportable superlatives / rank claims — the classic 2.3.1 trip. Leading
 *  anchor allows a non-word lead (space or start) so "#1" is caught mid-phrase. */
const CLAIM_RE = /(^|\s)(#\s?1|no\.?\s?1|number\s+one|guaranteed|100%|world['’]?s\s+best)\b|\b(the\s+best|best)\b/i;

/** Price / discount language that doesn't belong in name or subtitle. */
const PRICE_RE = /(^|\b)(free|sale|discount|\d+%\s*off|% off|cheap|deal|coupon|promo\b)\b/i;

/** Obvious placeholder / test text left in a field. */
const PLACEHOLDER_RE = /(lorem ipsum|todo\b|tbd\b|placeholder|test test|xxx+|asdf)/i;

/** A small curated set of famous app/platform brand names that are always risky
 *  in the keyword field even without a per-run competitor list (2.3.7). */
const FAMOUS_BRANDS = new Set([
  "instagram", "tiktok", "facebook", "whatsapp", "snapchat", "youtube", "spotify",
  "netflix", "uber", "twitter", "threads", "telegram", "pinterest", "reddit",
]);

/** Split a keyword field ("a,b,c" — no spaces) into terms. */
function keywordTerms(field: string): string[] {
  return field.split(",").map((t) => t.trim()).filter(Boolean);
}

/** Lowercased content words of a phrase (for stuffing / brand matching). */
function contentWords(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function finding(
  guideline: keyof typeof QUOTE,
  field: StoreField,
  why: string,
  evidence?: string,
): ReviewRiskFinding {
  return {
    guideline,
    quote: QUOTE[guideline],
    field,
    why,
    ...(evidence ? { evidence } : {}),
    disclaimer: REVIEW_RISK_DISCLAIMER,
  };
}

/**
 * Lint proposed copy for App-Review risk. Pure + deterministic; returns an empty
 * array for clean copy. Never mutates input.
 */
export function reviewRiskLint(input: ReviewRiskInput): ReviewRiskFinding[] {
  const { name, subtitle, keywords } = input.copy;
  const findings: ReviewRiskFinding[] = [];

  // ── 2.3.1: misleading / unsupportable claims in name or subtitle ───────────
  for (const [field, value] of [["name", name], ["subtitle", subtitle]] as const) {
    const m = value.match(CLAIM_RE);
    if (m) {
      findings.push(finding(
        "2.3.1",
        field,
        `"${m[0].trim()}" is an unsupportable claim unless you can prove it — a common 2.3.1 rejection.`,
        m[0].trim(),
      ));
    }
  }

  // ── price / discount language in name or subtitle (2.3 accurate metadata) ──
  for (const [field, value] of [["name", name], ["subtitle", subtitle]] as const) {
    // guard: only a standalone price word, not a bound suffix like "gluten-free"
    const m = value.match(PRICE_RE);
    if (m && !/[-a-z]free\b/i.test(value.toLowerCase().replace(/\bfree\b/, "free"))) {
      // reject "gluten-free"/"hands-free": the price word is preceded by a hyphenated stem
      const bound = new RegExp(`[a-z]-${m[0].trim()}\\b`, "i").test(value) ||
        new RegExp(`[a-z]${m[0].trim()}\\b`, "i").test(value);
      if (!bound) {
        findings.push(finding(
          "2.3",
          field,
          `price/discount word "${m[0].trim()}" in the ${field} reads as promotional metadata — a 2.3 accuracy risk.`,
          m[0].trim(),
        ));
      }
    }
  }

  // ── placeholder / test text in any field ───────────────────────────────────
  for (const [field, value] of [["name", name], ["subtitle", subtitle], ["keywords", keywords]] as const) {
    const m = value.match(PLACEHOLDER_RE);
    if (m) {
      findings.push(finding(
        "2.3",
        field,
        `looks like placeholder/test text ("${m[0]}") — ship real copy before submitting.`,
        m[0],
      ));
    }
  }

  // ── 2.3.7: keyword field — other-app brand names + stuffing ────────────────
  {
    const terms = keywordTerms(keywords);
    const brandSet = new Set([
      ...FAMOUS_BRANDS,
      ...(input.competitorBrands ?? []).map((b) => b.toLowerCase().trim()).filter(Boolean),
    ]);
    const hitBrands = new Set<string>();
    for (const term of terms) {
      for (const w of contentWords(term)) {
        if (brandSet.has(w)) hitBrands.add(w);
      }
    }
    if (hitBrands.size) {
      findings.push(finding(
        "2.3.7",
        "keywords",
        "the keyword field names other apps/brands — 2.3.7 forbids other app names or trademarks in keywords.",
        [...hitBrands].join(", "),
      ));
    }

    // stuffing: the same root word appearing across many terms
    const rootCounts = new Map<string, number>();
    for (const term of terms) {
      const roots = new Set(contentWords(term).map((w) => w.replace(/(es|s)$/i, "")));
      for (const r of roots) if (r.length >= 3) rootCounts.set(r, (rootCounts.get(r) ?? 0) + 1);
    }
    const stuffed = [...rootCounts.entries()].filter(([, n]) => n >= 3).map(([r]) => r);
    if (stuffed.length) {
      findings.push(finding(
        "2.3.7",
        "keywords",
        `the root "${stuffed[0]}" repeats across ${rootCounts.get(stuffed[0]!)} terms — reads as keyword stuffing (2.3.7).`,
        stuffed.join(", "),
      ));
    }
  }

  return findings;
}
