import { describe, expect, it } from "vitest";
import {
  coverageFromLanguages,
  recommendLocalesFromLanguages,
} from "./languageCoverage.js";

/**
 * Storefront-intel PRD 03 — measured localization coverage for KEYLESS runs
 * from the public page's language list. Language-level, honestly labeled;
 * conservative exclusion (every locale of a listed language is covered).
 */

describe("coverageFromLanguages (pure)", () => {
  it("maps English to all its model locale codes and labels the source storefront", () => {
    const c = coverageFromLanguages(["English"]);
    expect(c.source).toBe("storefront");
    expect(c.languages).toEqual(["English"]);
    // conservative: every English locale in the model is 'covered'
    expect(c.coveredLocales).toEqual(expect.arrayContaining(["en-US", "en-GB", "en-AU", "en-CA"]));
    expect(c.coveredLocales.every((l) => l.startsWith("en-"))).toBe(true);
    expect(c.unmappedLanguages).toEqual([]);
  });

  it("surfaces an unknown language name in unmappedLanguages, covering nothing for it", () => {
    const c = coverageFromLanguages(["English", "Klingon"]);
    expect(c.unmappedLanguages).toEqual(["Klingon"]);
    expect(c.coveredLocales.every((l) => l.startsWith("en-"))).toBe(true);
  });

  it("empty input yields empty coverage (unknown, not a claim)", () => {
    expect(coverageFromLanguages([])).toEqual({
      source: "storefront",
      languages: [],
      coveredLocales: [],
      unmappedLanguages: [],
    });
  });

  it("is deterministic — same input, identical output", () => {
    expect(coverageFromLanguages(["English", "German"])).toEqual(
      coverageFromLanguages(["English", "German"]),
    );
  });
});

describe("recommendLocalesFromLanguages", () => {
  it("EN-only → translate effort, ≥5 recs, none English", () => {
    const { recommendations, coverage } = recommendLocalesFromLanguages({ languages: ["English"] });
    expect(recommendations.length).toBeGreaterThanOrEqual(5);
    expect(recommendations.every((r) => r.effort === "translate")).toBe(true);
    // no recommendation is an English locale (conservative exclusion by language)
    expect(recommendations.every((r) => !r.locale.startsWith("en-"))).toBe(true);
    expect(coverage.source).toBe("storefront");
  });

  it("effort/cap is driven by LANGUAGE count, not the expanded locale count", () => {
    // 1 language expands to 4 English codes; effort must still be 'translate'
    // (feeding 4 codes into liveLocales would falsely taper to 'new').
    const { recommendations } = recommendLocalesFromLanguages({ languages: ["English"] });
    expect(recommendations[0]!.effort).toBe("translate");
  });

  it("more languages taper the count and flip effort to new", () => {
    const many = recommendLocalesFromLanguages({
      languages: ["English", "German", "French", "Spanish", "Italian"],
    });
    const one = recommendLocalesFromLanguages({ languages: ["English"] });
    expect(many.recommendations.length).toBeLessThanOrEqual(one.recommendations.length);
    expect(many.recommendations.every((r) => r.effort === "new")).toBe(true);
    // none of the listed languages' locales are recommended
    expect(many.recommendations.every((r) => !/^(en|de|fr|es|it)-/.test(r.locale))).toBe(true);
  });

  it("empty languages → empty recs and empty coverage", () => {
    const { recommendations, coverage } = recommendLocalesFromLanguages({ languages: [] });
    expect(recommendations).toEqual([]);
    expect(coverage.coveredLocales).toEqual([]);
  });

  it("respects category boost (passes category through to scoring)", () => {
    const withCat = recommendLocalesFromLanguages({ languages: ["English"], category: "Games" });
    const without = recommendLocalesFromLanguages({ languages: ["English"] });
    // category may reorder; both stay valid non-empty translate-effort lists
    expect(withCat.recommendations.length).toBeGreaterThan(0);
    expect(withCat.recommendations.every((r) => r.effort === "translate")).toBe(true);
    expect(without.recommendations.length).toBeGreaterThan(0);
  });
});
