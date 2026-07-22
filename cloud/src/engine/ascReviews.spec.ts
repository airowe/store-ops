import { describe, expect, it } from "vitest";
import { mapAscReview } from "./ascReviews.js";

describe("mapAscReview", () => {
  const raw = {
    id: "REV123",
    attributes: {
      rating: 4,
      title: "Great app",
      body: "Love the localization feature",
      reviewerNickname: "asoFan",
      createdDate: "2026-07-01T12:00:00Z",
      territory: "USA",
    },
  };

  it("normalizes a review row and lowercases the territory to country", () => {
    const r = mapAscReview(raw)!;
    expect(r.ascReviewId).toBe("REV123");
    expect(r.id).toBe("REV123");
    expect(r.rating).toBe(4);
    expect(r.title).toBe("Great app");
    expect(r.content).toBe("Love the localization feature");
    expect(r.author).toBe("asoFan");
    expect(r.country).toBe("usa");
    expect(r.createdDate).toBe("2026-07-01T12:00:00Z");
    expect(r.responseState).toBe("none");
    expect(r.existingResponseId).toBeUndefined();
  });

  it("reads an existing response into responseState + existingResponseId", () => {
    const withResp = {
      ...raw,
      relationships: { response: { data: { id: "RESP9", type: "customerReviewResponses" } } },
    };
    const r = mapAscReview(withResp)!;
    expect(r.responseState).toBe("published");
    expect(r.existingResponseId).toBe("RESP9");
  });

  it("returns null for a row missing id or body", () => {
    expect(mapAscReview({ id: "X", attributes: { rating: 5 } })).toBeNull();
    expect(mapAscReview({ attributes: { body: "hi", rating: 5 } })).toBeNull();
    expect(mapAscReview(null)).toBeNull();
  });

  it("coerces a missing rating to null rather than dropping the row", () => {
    const noRating = { id: "R2", attributes: { body: "text", reviewerNickname: "x" } };
    expect(mapAscReview(noRating)!.rating).toBeNull();
  });
});
