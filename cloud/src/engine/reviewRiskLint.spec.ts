import { describe, it, expect } from "vitest";
import {
  reviewRiskLint,
  REVIEW_RISK_DISCLAIMER,
  type ReviewRiskInput,
} from "./reviewRiskLint";

const CLEAN: ReviewRiskInput = {
  copy: {
    name: "Mangia",
    subtitle: "Plan meals and groceries",
    keywords: "recipe,pantry,grocery,meal plan",
  },
};

/** Convenience: run the lint and return the guideline sections it flagged. */
const sectionsFor = (input: ReviewRiskInput): string[] =>
  reviewRiskLint(input).map((f) => f.guideline);

describe("reviewRiskLint — deterministic, guideline-cited, no LLM", () => {
  it("passes clean, compliant copy with no findings", () => {
    expect(reviewRiskLint(CLEAN)).toEqual([]);
  });

  it("every finding cites a guideline section AND quotes it verbatim", () => {
    const findings = reviewRiskLint({
      copy: { ...CLEAN.copy, name: "#1 Best Recipe App", keywords: "recipe,tiktok,instagram" },
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.guideline).toMatch(/^\d+(\.\d+)*$/); // e.g. "2.3.7"
      expect(f.quote.length).toBeGreaterThan(0);
      expect(f.field).toBeTruthy();
      expect(f.why).toBeTruthy();
      // honest framing: a heuristic flag, never Apple's verdict
      expect(f.disclaimer).toBe(REVIEW_RISK_DISCLAIMER);
    }
  });

  // ── 2.3.1 — misleading / unsupportable claims ──────────────────────────────
  it("flags an unsupportable superlative in the name (2.3.1)", () => {
    expect(sectionsFor({ copy: { ...CLEAN.copy, name: "The #1 Recipe App" } })).toContain("2.3.1");
    expect(sectionsFor({ copy: { ...CLEAN.copy, subtitle: "Best meal planner ever" } })).toContain("2.3.1");
  });

  it("does NOT flag an ordinary benefit subtitle as a claim", () => {
    expect(sectionsFor({ copy: { ...CLEAN.copy, subtitle: "Plan meals in minutes" } })).not.toContain("2.3.1");
  });

  // ── 2.3.7 — keyword field: competitor/other-app names, stuffing ────────────
  it("flags a competitor/other-app brand name in the keyword field (2.3.7)", () => {
    const findings = reviewRiskLint({
      copy: { ...CLEAN.copy, keywords: "recipe,instagram,tiktok" },
      competitorBrands: ["instagram", "tiktok"],
    });
    const s237 = findings.filter((f) => f.guideline === "2.3.7");
    expect(s237.length).toBeGreaterThan(0);
    // it names the offending term(s) as evidence, not a vague warning
    expect(s237.some((f) => /instagram|tiktok/i.test(f.evidence ?? ""))).toBe(true);
  });

  it("flags a well-known platform brand in keywords even without a competitor list (2.3.7)", () => {
    // a curated set of famous app names is always risky in the keyword field
    expect(sectionsFor({ copy: { ...CLEAN.copy, keywords: "recipe,facebook" } })).toContain("2.3.7");
  });

  it("flags keyword stuffing: the same root repeated across terms (2.3.7)", () => {
    expect(sectionsFor({ copy: { ...CLEAN.copy, keywords: "recipe,recipes,recipe app,best recipe" } })).toContain("2.3.7");
  });

  // ── price in the title/subtitle (metadata rejection) ───────────────────────
  it("flags a price/discount word in the name or subtitle", () => {
    expect(sectionsFor({ copy: { ...CLEAN.copy, name: "Recipes Free" } }).length).toBeGreaterThan(0);
    expect(sectionsFor({ copy: { ...CLEAN.copy, subtitle: "50% off recipes" } }).length).toBeGreaterThan(0);
  });

  it("does NOT flag 'free' when it is part of an ordinary phrase like 'gluten-free'", () => {
    // 'free' as a bound suffix is not a price claim
    expect(reviewRiskLint({ copy: { ...CLEAN.copy, subtitle: "Gluten-free recipes" } })
      .some((f) => /price/i.test(f.why))).toBe(false);
  });

  // ── placeholder / test text ────────────────────────────────────────────────
  it("flags obvious placeholder text left in a field", () => {
    for (const ph of ["lorem ipsum dolor", "TODO write subtitle", "test test test"]) {
      expect(reviewRiskLint({ copy: { ...CLEAN.copy, subtitle: ph } }).length).toBeGreaterThan(0);
    }
  });

  // ── determinism + purity ───────────────────────────────────────────────────
  it("is deterministic (same input → same findings)", () => {
    const input = { copy: { ...CLEAN.copy, name: "#1 Best App" } };
    expect(reviewRiskLint(input)).toEqual(reviewRiskLint(input));
  });

  it("never mutates its input", () => {
    const input: ReviewRiskInput = { copy: { ...CLEAN.copy, name: "#1 App" } };
    const snapshot = JSON.stringify(input);
    reviewRiskLint(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("degrades gracefully on empty/missing optional fields", () => {
    expect(reviewRiskLint({ copy: { name: "", subtitle: "", keywords: "" } })).toEqual([]);
  });
});
