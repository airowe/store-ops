/**
 * Source-switch: feed the AUTHENTICATED ASC corpus into analyzeSentiment when a
 * credential is present and permitted; otherwise fall back to the keyless RSS
 * path. Both feed the identical sentiment engine — RSS is never deleted.
 */
import type { AscReviewsResult } from "./ascReviews.js";
import type { Reasoner, Review, ReviewSentiment } from "./reviewSentiment.js";

export type CorpusSource = "asc" | "rss";
export type CorpusResult = { source: CorpusSource; reviews: Review[]; sentiment: ReviewSentiment };

export type CorpusDeps = {
  fetchAscReviews: (opts: { token: string; appId: string }) => Promise<AscReviewsResult>;
  fetchReviewsForBundle: (bundleId: string, opts?: { country?: string }) => Promise<Review[]>;
  analyzeSentiment: (reviews: Review[], reasoner?: Reasoner) => Promise<ReviewSentiment>;
};

export async function loadReviewCorpus(
  deps: CorpusDeps,
  opts: {
    appId: string;
    bundleId: string;
    token?: string;
    country?: string;
    reasoner?: Reasoner;
  },
): Promise<CorpusResult> {
  // Prefer the authenticated corpus when we have a token AND the read is permitted.
  if (opts.token) {
    const res = await deps.fetchAscReviews({ token: opts.token, appId: opts.appId });
    if (res.state === "ok") {
      const reviews: Review[] = res.reviews; // AscReview is a superset of Review
      return { source: "asc", reviews, sentiment: await deps.analyzeSentiment(reviews, opts.reasoner) };
    }
    // permission_required / unavailable → fall through to RSS
  }
  const countryOpts = opts.country ? { country: opts.country } : {};
  const rss = await deps.fetchReviewsForBundle(opts.bundleId, countryOpts);
  return { source: "rss", reviews: rss, sentiment: await deps.analyzeSentiment(rss, opts.reasoner) };
}
