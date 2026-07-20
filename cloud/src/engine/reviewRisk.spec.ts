import { describe, expect, it } from "vitest";
import { reviewRiskFindings } from "./reviewRisk.js";

const ids = (
  copy: Parameters<typeof reviewRiskFindings>[0],
  opts?: Parameters<typeof reviewRiskFindings>[1],
) => reviewRiskFindings(copy, opts).map((f) => f.id);

describe("reviewRiskFindings", () => {
  it("clean copy emits nothing (no fabricated risk)", () => {
    expect(reviewRiskFindings({ name: "Weatherly", subtitle: "Honest forecasts", keywords: "weather,forecast,radar" })).toEqual([]);
  });

  it("no copy → []", () => {
    expect(reviewRiskFindings(undefined)).toEqual([]);
    expect(reviewRiskFindings({})).toEqual([]);
  });

  it("flags price/promo words in the title or subtitle (2.3.7)", () => {
    expect(ids({ name: "Weatherly — 50% off" })).toContain("review_risk_price_in_title");
    expect(ids({ subtitle: "Free forever" })).toContain("review_risk_price_in_title");
  });

  it("flags unverifiable #1 / superlative claims (2.3.1)", () => {
    expect(ids({ name: "Weatherly #1 Weather" })).toContain("review_risk_superlative");
    expect(ids({ subtitle: "The world's best forecast" })).toContain("review_risk_superlative");
  });

  it("flags placeholder text in any field (2.3.8)", () => {
    expect(ids({ subtitle: "Your app name here" })).toContain("review_risk_placeholder");
    expect(ids({ keywords: "weather,lorem ipsum,radar" })).toContain("review_risk_placeholder");
  });

  it("flags the app's own brand repeated in the keyword field (2.3.7)", () => {
    expect(ids({ name: "Weatherly - Forecasts", keywords: "weatherly,radar" })).toContain("review_risk_brand_in_keywords");
    // brand NOT in keywords → no flag
    expect(ids({ name: "Weatherly", keywords: "radar,forecast" })).not.toContain("review_risk_brand_in_keywords");
  });

  it("flags a famous OTHER-app name in the keyword field (2.3.7)", () => {
    // piggybacking on a well-known app's name in keywords is a classic 2.3.7 rejection
    expect(ids({ name: "Weatherly", keywords: "weather,instagram,forecast" })).toContain("review_risk_other_app_in_keywords");
    // a term that merely CONTAINS a brand substring is not flagged (word-boundary)
    expect(ids({ name: "Weatherly", keywords: "weather,forecaster,radar" })).not.toContain("review_risk_other_app_in_keywords");
  });

  it("flags a per-run competitor brand in the keyword field (2.3.7)", () => {
    expect(ids({ name: "Weatherly", keywords: "weather,acmecast,radar" }, { competitorBrands: ["AcmeCast"] }))
      .toContain("review_risk_other_app_in_keywords");
    // without the competitor list, that term is just a normal keyword
    expect(ids({ name: "Weatherly", keywords: "weather,acmecast,radar" })).not.toContain("review_risk_other_app_in_keywords");
  });

  it("flags keyword stuffing — the same root repeated across ≥3 terms (2.3.7)", () => {
    expect(ids({ name: "Recipe Box", keywords: "recipe,recipes,recipe app,best recipe" })).toContain("review_risk_keyword_stuffing");
    // two variants of a root is fine (normal pluralization), not stuffing
    expect(ids({ name: "Recipe Box", keywords: "recipe,recipes,dinner,meal plan" })).not.toContain("review_risk_keyword_stuffing");
  });

  it("every finding cites a guideline (with a verbatim quote) and carries the 'not Apple's verdict' caveat", () => {
    const f = reviewRiskFindings({ name: "Best #1 App", subtitle: "Free deal" })[0]!;
    expect(f.surface).toBe("reviewRisk");
    expect(f.severity).toBe("warn");
    expect(f.impact).toBe("trust");
    // #178 Phase 2: the evidence now carries the section reference AND the verbatim quote.
    expect(f.evidence).toMatch(/App Review Guideline 2\.3/);
    expect(f.evidence).toMatch(/“.+”/); // a quoted guideline sentence
    expect(f.detail).toMatch(/not Apple's verdict/i);
  });

  it("quotes the guideline VERBATIM in each finding's evidence (#178 Phase 2)", () => {
    const price = reviewRiskFindings({ name: "Weatherly 50% off" }).find((f) => f.id === "review_risk_price_in_title")!;
    expect(price.evidence).toContain("should not include prices, terms, or descriptions");
    const placeholder = reviewRiskFindings({ subtitle: "Your app name here" }).find((f) => f.id === "review_risk_placeholder")!;
    // corrected citation: placeholder text is 2.3 (accurate metadata), not 2.3.8 (age rating)
    expect(placeholder.evidence).toContain("App Review Guideline 2.3 ");
    expect(placeholder.evidence).toContain("accurately reflect the app's core experience");
  });
});
