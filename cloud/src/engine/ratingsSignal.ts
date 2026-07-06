/**
 * Ratings-histogram signal — storefront-intel PRD 01
 * (`docs/prd/storefront-intel/01-ratings-histogram.md`).
 *
 * The storefront page seam (`audit.storefront.ratings`) carries Apple's own
 * ratings read: `{ average, count, histogram[5] }` — the 1★→5★ distribution
 * over the WHOLE ratings base, not the RSS review sample `reviewSentiment`
 * sees. This module turns it into a pure signal: verbatim facts plus shape
 * fields (shares, polarization) derived ONLY from a readable histogram.
 *
 * Honesty contract (binding):
 *  - `undefined` in → `undefined` out: an unread page stays unknown.
 *  - The extractor's `histogram: []` fallback means UNREADABLE, not "all
 *    zeros": shape fields are absent, never fabricated — while `average` and
 *    `count` (independently measured) still carry.
 *  - `average`/`count` are Apple's numbers, passed through verbatim — never
 *    recomputed, rounded, or blended with the review sample.
 *  - "Thin" is a statement about the COUNT (Apple's own "Not Enough Ratings"
 *    stance), never a claim about the app's quality.
 *
 * Pure, deterministic, no bindings, no fetch — engine rules.
 */
import type { StorefrontIntel } from "./agent.js";

export type StorefrontRatings = NonNullable<StorefrontIntel["ratings"]>;

export type RatingsSignal = {
  /** Apple's number, verbatim. */
  average: number;
  /** Apple's number, verbatim. */
  count: number;
  /** 1★→5★ shares (sum ≈ 1) — present ONLY when the histogram was readable
   *  (exactly 5 buckets, sum > 0). Absent histogram ⇒ absent shares, never zeros. */
  shares?: [number, number, number, number, number];
  /** share(1★)+share(5★), and the bimodal call — absent whenever shares are. */
  polarization?: { score: number; bimodal: boolean };
  /** Apple-count-is-thin status: count < RATINGS_THIN. */
  thin: boolean;
};

/** Below this count, don't editorialize the shape — echo Apple's own
 *  "Not Enough Ratings" stance instead. */
export const RATINGS_THIN = 50;

/** Below this count, never call a distribution "polarized" — small bases make
 *  any shape claim noise. */
export const MIN_RATINGS_FOR_SHAPE = 200;

/** Bimodal call thresholds (tunable proposals — PRD 01 open question 1). */
export const BIMODAL_MIN_ONE_STAR_SHARE = 0.15;
export const BIMODAL_MIN_FIVE_STAR_SHARE = 0.5;

/** A histogram is readable only when it has exactly the 5 star buckets and a
 *  positive total — `[]` (and any other surprise) means UNREADABLE, not zeros. */
function readableShares(histogram: number[]): RatingsSignal["shares"] | undefined {
  if (histogram.length !== 5) return undefined;
  const total = histogram.reduce((sum, n) => sum + n, 0);
  if (!(total > 0)) return undefined;
  return histogram.map((n) => n / total) as [number, number, number, number, number];
}

/**
 * Turn Apple's storefront ratings read into an honest signal, or `undefined`
 * when the page carried none. A missing histogram degrades the shape fields
 * only — never the measured facts (safe-degrade everywhere).
 */
export function ratingsSignal(ratings: StorefrontRatings | undefined): RatingsSignal | undefined {
  if (!ratings) return undefined;
  const { average, count, histogram } = ratings;
  const thin = count < RATINGS_THIN;

  const shares = readableShares(histogram);
  if (!shares) return { average, count, thin };

  const bimodal =
    shares[0] >= BIMODAL_MIN_ONE_STAR_SHARE &&
    shares[4] >= BIMODAL_MIN_FIVE_STAR_SHARE &&
    count >= MIN_RATINGS_FOR_SHAPE;

  return {
    average,
    count,
    shares,
    polarization: { score: shares[0] + shares[4], bimodal },
    thin,
  };
}
