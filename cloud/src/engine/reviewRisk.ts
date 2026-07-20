/**
 * Review-risk copy lint (#178 Phase 1) — deterministic checks on the PROPOSED
 * metadata against well-known App Store review-rejection causes. Today we
 * validate proposed copy against field LIMITS (optimize.ts `validateCopy`); this
 * adds the missing REVIEW-guideline lens so an ASO-optimal-but-risky proposal is
 * flagged before submission.
 *
 * Honesty, load-bearing:
 *   • a hit is FLAGGED, never "Apple's verdict" — a heuristic, labelled as one,
 *   • each finding cites the specific App Review Guideline section AND quotes it
 *     VERBATIM (#178 Phase 2, from reviewGuidelines.ts) — never a paraphrase
 *     presented as authoritative,
 *   • no LLM, no network — pure regex rules on the user's own proposed copy, so
 *     it's deterministic and testable. Clean copy emits NOTHING (no fake risk).
 *
 * These are the metadata-rejection causes that are safely detectable by rule;
 * subtler judgement calls stay out (a false "risky" is worse than a silent pass).
 */
import type { Finding } from "./findings/core.js";
import type { CopyFields } from "./optimize.js";
import { deriveBrandTokens } from "./localizeCopy.js";
import { citeEvidence, type GuidelineCiteKey } from "./reviewGuidelines.js";

const SURFACE = "reviewRisk";

/** Price / promotional words don't belong in the name or subtitle (Guideline 2.3.7). */
const PRICE_RE = /\b(free|sale|\d{1,3}\s*%\s*off|discount|deal|bogo|half[-\s]?price|lowest price)\b/i;
/** Unverifiable rank/superlative claims (Guideline 2.3.7 — no unverifiable product claims). */
const SUPERLATIVE_RE = /(#\s?1\b|\bno\.?\s?1\b|\bnumber\s?one\b|world'?s\s+(?:best|#\s?1|number\s?one)|\bbest[-\s]?in[-\s]?class\b)/i;
/** Placeholder / boilerplate text left in metadata (Guideline 2.3 — accurate metadata). */
const PLACEHOLDER_RE = /\b(lorem ipsum|placeholder|your app name(?: here)?|to ?do|tbd|xxxx?)\b/i;

const CAVEAT = "Flagged as a review risk — a heuristic, not Apple's verdict; review before you submit.";

/**
 * Famous app/platform names that must not appear in the keyword field (2.3.7 —
 * "don't pack your metadata with trademarked terms, popular app names …"). A
 * small curated set; callers may add confirmed competitor brands per run.
 */
const FAMOUS_APP_BRANDS = [
  "instagram", "tiktok", "facebook", "whatsapp", "snapchat", "youtube", "spotify",
  "netflix", "uber", "twitter", "threads", "telegram", "pinterest", "reddit",
] as const;

/** Split a keyword field into normalized, non-empty terms. */
function keywordTerms(keywords: string): string[] {
  return keywords.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * A crude English root: strip a trailing plural/possessive so "recipe",
 * "recipes", "recipe's" collapse to one root for the stuffing check. Multi-word
 * terms use their FIRST word ("recipe app" → "recipe"), which is where stuffing
 * repeats show up.
 */
function root(term: string): string {
  const head = (term.split(/\s+/)[0] ?? term).replace(/['’]s$/, "");
  // Strip a trailing plural "s" so "recipe"/"recipes" share a root. We only strip
  // a bare "s" (not "es"), which would over-collapse distinct words like
  // "class"→"clas"; a 4+-char guard avoids butchering short terms.
  return head.length > 3 && head.endsWith("s") && !head.endsWith("ss") ? head.slice(0, -1) : head;
}

/**
 * Shared claim predicates (#178 Phase 3) — the SAME rules the copy lint uses,
 * exported so the screenshot-compliance lens can apply them to OCR'd screenshot
 * text without duplicating (and drifting from) the regexes.
 */
/** Price/promo wording that doesn't belong in a metadata field (Guideline 2.3.7). */
export function hasPricePromo(text: string): boolean {
  return PRICE_RE.test(text);
}
/** An unverifiable superlative / "#1 / best" claim (Guideline 2.3.7). */
export function hasUnverifiableClaim(text: string): boolean {
  return SUPERLATIVE_RE.test(text);
}

function finding(id: string, title: string, detail: string, fix: string, cite: GuidelineCiteKey): Finding {
  return { id, surface: SURFACE, severity: "warn", impact: "trust", title, detail: `${detail} ${CAVEAT}`, fix, evidence: citeEvidence(cite) };
}

/**
 * Lint the proposed copy for review-rejection risk. Returns [] for clean copy or
 * no copy. Only the name/subtitle/keywords are inspected — the fields the agent
 * proposes and the ones that actually trip metadata review.
 */
export function reviewRiskFindings(
  copy: Partial<CopyFields> | undefined,
  opts?: { competitorBrands?: string[] },
): Finding[] {
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
      "price_in_metadata",
    ));
  }
  if (titleText && SUPERLATIVE_RE.test(titleText)) {
    out.push(finding(
      "review_risk_superlative",
      "Unverifiable “#1 / best” claim in your metadata",
      "Rank or superlative claims (“#1”, “number one”, “world’s best”) are rejected unless you can substantiate them.",
      "Drop the claim or replace it with a factual benefit.",
      "unverifiable_claim",
    ));
  }
  const anyText = `${titleText} ${keywords}`.trim();
  if (anyText && PLACEHOLDER_RE.test(anyText)) {
    out.push(finding(
      "review_risk_placeholder",
      "Placeholder text left in your metadata",
      "Placeholder or boilerplate text (“lorem ipsum”, “your app name”, “TODO”) in submitted metadata is an automatic rejection.",
      "Replace the placeholder with real copy.",
      "accurate_metadata",
    ));
  }
  // The app's own brand is already indexed from the name — repeating it in the
  // keyword field wastes the 100-char budget and reads as keyword misuse.
  const brand = deriveBrandTokens(name)[0]?.toLowerCase();
  const terms = keywords ? keywordTerms(keywords) : [];
  if (brand && terms.includes(brand)) {
    out.push(finding(
      "review_risk_brand_in_keywords",
      "Your app name is in the keyword field",
      `“${brand}” is already indexed from your app name, so repeating it in keywords wastes budget and can read as keyword-field misuse.`,
      "Remove your brand from the keyword field and use the space for a term you don’t already rank for.",
      "keyword_packing",
    ));
  }

  // OTHER apps' / competitors' names in the keyword field — a classic 2.3.7
  // rejection (piggybacking on trademarked / popular app names). Curated famous
  // set + any confirmed-competitor brands the caller passes.
  if (terms.length) {
    const banned = new Set<string>([
      ...FAMOUS_APP_BRANDS,
      ...(opts?.competitorBrands ?? []).map((b) => b.trim().toLowerCase()).filter(Boolean),
    ]);
    const hit = terms.find((t) => banned.has(t));
    if (hit) {
      out.push(finding(
        "review_risk_other_app_in_keywords",
        "Another app’s name in your keyword field",
        `“${hit}” is another app’s / a trademarked name — using it in keywords to piggyback on their traffic is a common 2.3.7 rejection.`,
        "Remove other apps’ names from the keyword field and rank on your own value terms.",
        "keyword_packing",
      ));
    }
  }

  // Keyword STUFFING — the same root repeated across ≥3 comma-separated terms
  // (e.g. recipe, recipes, recipe app, best recipe) reads as gaming the field.
  if (terms.length >= 3) {
    const counts = new Map<string, number>();
    for (const t of terms) {
      const r = root(t);
      if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    let stuffed: string | null = null;
    for (const [r, n] of counts) {
      if (n >= 3) { stuffed = r; break; }
    }
    if (stuffed) {
      out.push(finding(
        "review_risk_keyword_stuffing",
        "Keyword stuffing in your keyword field",
        `“${stuffed}” appears as the root of 3+ of your keyword terms — repeating one word to fill the field reads as stuffing, not relevance.`,
        "Keep one strong form of the term and use the reclaimed space for distinct keywords.",
        "keyword_packing",
      ));
    }
  }
  return out;
}
