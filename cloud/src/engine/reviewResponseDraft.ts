/**
 * Pure, no-network developer-response DRAFT generation. Grounded in the review
 * text, length-capped to Apple's limit, degrades to a safe templated draft on any
 * reasoner failure. NEVER publishes — publishResponse (ascReviewResponses.ts) is a
 * separate call with a human gate between.
 */
import type { AscReview } from "./ascReviews.js";
import type { Reasoner } from "./reviewSentiment.js";
import { APP_STORE_RESPONSE_MAX } from "./ascReviewResponses.js";

export type ResponseDraft = {
  ascReviewId: string;
  text: string;
  grounded: boolean;
  truncated: boolean;
};

/** Deterministic fallback grounded ONLY in the star rating — never a promise. */
export function templatedDraft(review: AscReview): string {
  const low = review.rating !== null && review.rating <= 2;
  return low
    ? "We're sorry the app didn't meet your expectations. Thank you for the detailed feedback — it helps us prioritize what to fix."
    : "Thank you for taking the time to leave a review — we really appreciate the support and are glad you're enjoying the app.";
}

/** Build the model prompt: reply grounded ONLY in this review's text. */
function buildPrompt(review: AscReview): string {
  return [
    "You are the app's developer writing a PUBLIC reply to this App Store review.",
    "Reply ONLY to what the review actually says. Do NOT promise specific features,",
    "dates, or fixes that the review does not mention. Be brief, warm, and human.",
    "",
    `Review (${review.rating ?? "?"}★): ${review.title}\n${review.content}`,
    "",
    "Return ONLY the reply text, no preamble.",
  ].join("\n");
}

/** True when the draft shares meaningful, non-trivial word overlap with the review
 *  (a coarse anti-hallucination check: a reply about nothing in the review is dropped). */
function isGrounded(text: string, review: AscReview): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return false;
  const reviewText = `${review.title} ${review.content}`.toLowerCase();
  const reviewWords = reviewText.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (reviewWords.length === 0) return true; // nothing to ground against → accept
  const textWordSet = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  return reviewWords.some((rw) => textWordSet.has(rw));
}

export async function draftResponse(review: AscReview, reasoner?: Reasoner): Promise<ResponseDraft> {
  const cap = (s: string): { text: string; truncated: boolean } =>
    s.length > APP_STORE_RESPONSE_MAX
      ? { text: s.slice(0, APP_STORE_RESPONSE_MAX), truncated: true }
      : { text: s, truncated: false };

  if (reasoner) {
    try {
      const raw = (await reasoner(buildPrompt(review))).trim();
      if (raw && isGrounded(raw, review)) {
        const { text, truncated } = cap(raw);
        return { ascReviewId: review.ascReviewId, text, grounded: true, truncated };
      }
    } catch {
      // fall through to templated
    }
  }
  return {
    ascReviewId: review.ascReviewId,
    text: templatedDraft(review),
    grounded: false,
    truncated: false,
  };
}
