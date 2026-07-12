import { describe, expect, it } from "vitest";
import { REVIEW_GUIDELINE_CITES, citeEvidence } from "./reviewGuidelines.js";

describe("review guideline corpus", () => {
  it("every cite carries a section number and a non-empty verbatim quote", () => {
    for (const [key, cite] of Object.entries(REVIEW_GUIDELINE_CITES)) {
      expect(cite.section, key).toMatch(/^2\.3(\.\d+)?$/);
      expect(cite.quote.length, key).toBeGreaterThan(40);
      // a verbatim sentence, not a fragment with an elision presented as whole
      expect(cite.quote, key).not.toContain("...");
      expect(cite.quote, key).not.toContain("…");
    }
  });

  it("cites the price rule to 2.3.7 with the prices-in-metadata sentence", () => {
    expect(REVIEW_GUIDELINE_CITES.price_in_metadata.section).toBe("2.3.7");
    expect(REVIEW_GUIDELINE_CITES.price_in_metadata.quote).toContain("should not include prices");
  });

  it("cites placeholder/incomplete copy to 2.3 (accurate metadata), NOT 2.3.8 (age rating)", () => {
    expect(REVIEW_GUIDELINE_CITES.accurate_metadata.section).toBe("2.3");
    expect(REVIEW_GUIDELINE_CITES.accurate_metadata.quote).toContain("accurately reflect the app's core experience");
  });

  it("cites keyword packing to 2.3.7 with the don't-pack-metadata sentence", () => {
    expect(REVIEW_GUIDELINE_CITES.keyword_packing.section).toBe("2.3.7");
    expect(REVIEW_GUIDELINE_CITES.keyword_packing.quote).toContain("don't try to pack any of your metadata");
  });

  it("citeEvidence renders the section reference AND the verbatim quote", () => {
    const ev = citeEvidence("unverifiable_claim");
    expect(ev).toContain("App Review Guideline 2.3.7");
    expect(ev).toContain("unverifiable product claims");
  });
});
