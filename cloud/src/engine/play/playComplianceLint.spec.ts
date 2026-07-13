/**
 * Play metadata compliance lint. Honesty invariants:
 *   • a clean title flags NOTHING (no fabricated risk),
 *   • an UNREAD title (null) flags nothing (no false positive on an unseen field),
 *   • every hit cites the Play policy it's based on and is labelled a heuristic.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "../store/types.js";
import {
  hasEmojiOrRepeatedSpecials,
  hasPerformanceClaim,
  hasPlayPricePromo,
  impliesPlayProgram,
  playComplianceFindings,
} from "./playComplianceLint.js";

function listing(title: string | null): NormalizedListing {
  return {
    store: "googleplay",
    appId: "com.demo.app",
    title,
    tagline: null,
    keywordField: null,
    longDescription: null,
    screenshots: [],
    category: null,
    reliable: false,
  };
}

const ids = (l: NormalizedListing) => playComplianceFindings(l).map((f) => f.id);

describe("playComplianceLint — predicates (precision-first)", () => {
  it("flags emoji and repeated special chars, not ordinary punctuation", () => {
    expect(hasEmojiOrRepeatedSpecials("Weatherly 🌦️")).toBe(true);
    expect(hasEmojiOrRepeatedSpecials("SALE!!!")).toBe(true);
    expect(hasEmojiOrRepeatedSpecials("Weatherly — Forecasts")).toBe(false);
    expect(hasEmojiOrRepeatedSpecials("Notes & Lists")).toBe(false);
  });

  it("flags unambiguous performance claims, not bare 'top'/'best' in words", () => {
    expect(hasPerformanceClaim("Weatherly #1 Forecast")).toBe(true);
    expect(hasPerformanceClaim("Best-Selling Planner")).toBe(true);
    expect(hasPerformanceClaim("Award-Winning Timer")).toBe(true);
    expect(hasPerformanceClaim("Top-Rated Radar")).toBe(true);
    // ordinary words containing best/top must NOT trip it
    expect(hasPerformanceClaim("Bestie Chat")).toBe(false);
    expect(hasPerformanceClaim("Laptop Manager")).toBe(false);
  });

  it("flags price/promo wording", () => {
    expect(hasPlayPricePromo("Weatherly Free")).toBe(true);
    expect(hasPlayPricePromo("50% off Planner")).toBe(true);
    expect(hasPlayPricePromo("Radar")).toBe(false);
  });

  it("flags Play-program affiliation terms", () => {
    expect(impliesPlayProgram("Editors' Choice Weather")).toBe(true);
    expect(impliesPlayProgram("Weatherly for Google Play")).toBe(true);
    expect(impliesPlayProgram("Weatherly")).toBe(false);
  });
});

describe("playComplianceLint — findings", () => {
  it("a clean, compliant title flags nothing", () => {
    expect(playComplianceFindings(listing("Weatherly — Honest Forecasts"))).toEqual([]);
  });

  it("an UNREAD title (null) flags nothing (no false positive on an unseen field)", () => {
    expect(playComplianceFindings(listing(null))).toEqual([]);
  });

  it("a measured-empty title flags nothing (handled elsewhere as 'missing')", () => {
    expect(playComplianceFindings(listing("   "))).toEqual([]);
  });

  it("flags each risky title with a cited, heuristic-labelled finding", () => {
    expect(ids(listing("Weatherly 🌦️"))).toContain("play_title_format_risk");
    expect(ids(listing("#1 Weather Radar"))).toContain("play_title_performance_claim");
    expect(ids(listing("Weatherly — Free"))).toContain("play_title_price_promo");
    expect(ids(listing("Editors' Choice Weather"))).toContain("play_title_program_affiliation");

    const f = playComplianceFindings(listing("#1 Weather"))[0]!;
    expect(f.evidence).toMatch(/Google Play .* policy/);
    expect(f.detail).toMatch(/not Google's verdict/);
    expect(f.severity).toBe("warn");
  });

  it("stacks multiple independent violations in one title", () => {
    // emoji + performance + price all present
    expect(ids(listing("#1 Weather 🌦️ Free"))).toEqual(
      expect.arrayContaining([
        "play_title_format_risk",
        "play_title_performance_claim",
        "play_title_price_promo",
      ]),
    );
  });
});
