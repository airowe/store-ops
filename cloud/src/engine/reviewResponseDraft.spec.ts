import { describe, expect, it } from "vitest";
import { draftResponse, templatedDraft } from "./reviewResponseDraft.js";
import type { AscReview } from "./ascReviews.js";

const review: AscReview = {
  id: "R1", ascReviewId: "R1", author: "sam", rating: 2,
  title: "Crashes on launch", content: "The app crashes every time I open it on iOS 18.",
  version: "3.1.0", country: "usa", createdDate: "2026-07-01T00:00:00Z", responseState: "none",
};

describe("templatedDraft", () => {
  it("produces a low-rating apology for a 1-2 star review", () => {
    const t = templatedDraft(review);
    expect(t.toLowerCase()).toContain("sorry");
    expect(t.length).toBeGreaterThan(0);
  });
  it("produces a thank-you for a 4-5 star review", () => {
    const t = templatedDraft({ ...review, rating: 5 });
    expect(t.toLowerCase()).toContain("thank");
  });
});

describe("draftResponse", () => {
  it("uses the reasoner output when grounded and marks grounded:true", async () => {
    const reasoner = async () => "Sorry about the crash on iOS 18 — a fix is on the way.";
    const d = await draftResponse(review, reasoner);
    expect(d.ascReviewId).toBe("R1");
    expect(d.grounded).toBe(true);
    expect(d.text).toContain("crash");
    expect(d.truncated).toBe(false);
  });

  it("degrades to the templated draft when the reasoner throws", async () => {
    const reasoner = async () => { throw new Error("model down"); };
    const d = await draftResponse(review, reasoner);
    expect(d.grounded).toBe(false);
    expect(d.text).toBe(templatedDraft(review));
  });

  it("degrades to templated when the reasoner returns empty/garbage", async () => {
    expect((await draftResponse(review, async () => "")).grounded).toBe(false);
    expect((await draftResponse(review, async () => "   ")).grounded).toBe(false);
  });

  it("truncates to the length cap and sets truncated:true", async () => {
    const long = "x".repeat(7000);
    const d = await draftResponse(review, async () => long);
    expect(d.text.length).toBe(5970);
    expect(d.truncated).toBe(true);
  });

  it("uses the templated draft when no reasoner is provided", async () => {
    const d = await draftResponse(review);
    expect(d.grounded).toBe(false);
    expect(d.text).toBe(templatedDraft(review));
  });
});
