import { describe, expect, it } from "vitest";
import { mapAscReview, fetchAscReviews } from "./ascReviews.js";

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

function page(ids: string[], next?: string) {
  return {
    ok: true,
    json: async () => ({
      data: ids.map((id) => ({ id, attributes: { body: `body ${id}`, rating: 5, territory: "USA" } })),
      links: next ? { next } : {},
    }),
  } as unknown as Response;
}

describe("fetchAscReviews", () => {
  it("follows cursor paging up to maxPages and returns ok with all reviews", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return url.includes("cursor=2")
        ? page(["C", "D"])
        : page(["A", "B"], "https://api.appstoreconnect.apple.com/v1/apps/1/customerReviews?cursor=2");
    };
    const res = await fetchAscReviews(fetchFn, { token: "t", appId: "1", maxPages: 5 });
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.reviews.map((r) => r.id)).toEqual(["A", "B", "C", "D"]);
    expect(calls.length).toBe(2);
  });

  it("returns permission_required on 401/403", async () => {
    const fetchFn = async () => ({ ok: false, status: 403 }) as Response;
    expect((await fetchAscReviews(fetchFn, { token: "t", appId: "1" })).state).toBe("permission_required");
  });

  it("returns unavailable on other non-OK and never throws on a network error", async () => {
    const bad = async () => ({ ok: false, status: 500 }) as Response;
    expect((await fetchAscReviews(bad, { token: "t", appId: "1" })).state).toBe("unavailable");
    const boom = async () => { throw new Error("network"); };
    expect((await fetchAscReviews(boom, { token: "t", appId: "1" })).state).toBe("unavailable");
  });

  it("stops at maxReviews", async () => {
    const fetchFn = async () => page(["A", "B", "C"]);
    const res = await fetchAscReviews(fetchFn, { token: "t", appId: "1", maxReviews: 2 });
    if (res.state === "ok") expect(res.reviews.length).toBe(2);
  });
});
