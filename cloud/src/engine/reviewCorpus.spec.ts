import { describe, expect, it } from "vitest";
import { loadReviewCorpus } from "./reviewCorpus.js";
import type { AscReview } from "./ascReviews.js";

const ascReview: AscReview = {
  id: "A1", ascReviewId: "A1", author: "x", rating: 5, title: "t", content: "great localization",
  version: "1.0", country: "usa", createdDate: "2026-07-01T00:00:00Z", responseState: "none",
};

describe("loadReviewCorpus", () => {
  it("uses the ASC corpus when a credential is present and permitted", async () => {
    const deps = {
      fetchAscReviews: async () => ({ state: "ok" as const, reviews: [ascReview] }),
      fetchReviewsForBundle: async () => { throw new Error("RSS should not be called"); },
      analyzeSentiment: async (reviews: any[]) => ({ n: reviews.length, score: 100, confidence: "ok" as const, label: "x", topics: [] }),
    };
    const res = await loadReviewCorpus(deps as any, { token: "t", appId: "1", bundleId: "com.x" });
    expect(res.source).toBe("asc");
    expect(res.reviews[0]!.id).toBe("A1");
    expect(res.sentiment.n).toBe(1);
  });

  it("falls back to RSS when no token is provided", async () => {
    const deps = {
      fetchAscReviews: async () => { throw new Error("ASC should not be called"); },
      fetchReviewsForBundle: async () => [{ id: "RSS1", author: "y", rating: 4, title: "t", content: "ok", version: "1", country: "us" }],
      analyzeSentiment: async (reviews: any[]) => ({ n: reviews.length, score: 75, confidence: "ok" as const, label: "x", topics: [] }),
    };
    const res = await loadReviewCorpus(deps as any, { appId: "1", bundleId: "com.x" });
    expect(res.source).toBe("rss");
    expect(res.reviews[0]!.id).toBe("RSS1");
  });

  it("falls back to RSS when the ASC read returns permission_required", async () => {
    const deps = {
      fetchAscReviews: async () => ({ state: "permission_required" as const }),
      fetchReviewsForBundle: async () => [{ id: "RSS2", author: "y", rating: 3, title: "t", content: "meh", version: "1", country: "us" }],
      analyzeSentiment: async (reviews: any[]) => ({ n: reviews.length, score: 50, confidence: "ok" as const, label: "x", topics: [] }),
    };
    const res = await loadReviewCorpus(deps as any, { token: "t", appId: "1", bundleId: "com.x" });
    expect(res.source).toBe("rss");
    expect(res.reviews[0]!.id).toBe("RSS2");
  });
});
