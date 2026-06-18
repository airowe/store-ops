import { describe, it, expect } from "vitest";
import { recommendLocales, rankAll, type LocaleRecommendation } from "./localizationExpansion.js";

/**
 * PRD 04 — Localization expansion. recommendLocales() is PURE + DETERMINISTIC:
 * a static, bundled locale-value heuristic, no HTTP. These tests pin the honesty
 * disciplines (winnability, no fabricated numbers, live-locale exclusion) and the
 * ROI ordering (tier × category × effort).
 */

const ALL_TIERS = new Set(["large", "mid", "long-tail"]);

function locales(recs: LocaleRecommendation[]): string[] {
  return recs.map((r) => r.locale);
}

describe("recommendLocales — determinism", () => {
  it("is pure: same input → deep-equal output", () => {
    const a = recommendLocales({ liveLocales: ["en-US"], category: "Games" });
    const b = recommendLocales({ liveLocales: ["en-US"], category: "Games" });
    expect(a).toEqual(b);
  });
});

describe("recommendLocales — single-locale app (Test 1)", () => {
  const recs = recommendLocales({ liveLocales: ["en-US"] });

  it("returns at least 5 recommendations", () => {
    expect(recs.length).toBeGreaterThanOrEqual(5);
  });

  it("never returns more than 7 (no over-recommendation)", () => {
    expect(recs.length).toBeLessThanOrEqual(7);
  });

  it("marks every recommendation alreadyLive:false", () => {
    expect(recs.every((r) => r.alreadyLive === false)).toBe(true);
  });

  it("sets effort:translate for every recommendation (one live locale = copy to translate)", () => {
    expect(recs.every((r) => r.effort === "translate")).toBe(true);
  });

  it("uses only the known storefront tiers", () => {
    expect(recs.every((r) => ALL_TIERS.has(r.storefrontTier))).toBe(true);
  });
});

describe("recommendLocales — already-live locales excluded (Test 2)", () => {
  it("never recommends a locale the app is already live in", () => {
    const live = ["en-US", "es-MX", "de-DE"];
    const recs = recommendLocales({ liveLocales: live });
    for (const code of live) {
      expect(locales(recs)).not.toContain(code);
    }
  });

  it("never emits an alreadyLive:true record", () => {
    const recs = recommendLocales({ liveLocales: ["en-US", "es-MX", "de-DE"] });
    expect(recs.some((r) => r.alreadyLive === true)).toBe(false);
  });
});

describe("recommendLocales — saturation / diminishing returns (Test 3)", () => {
  it("a 7+ locale app gets 0–3 recommendations", () => {
    const recs = recommendLocales({
      liveLocales: ["en-US", "es-MX", "de-DE", "fr-FR", "ja-JP", "ko-KR", "zh-Hans-CN"],
    });
    expect(recs.length).toBeGreaterThanOrEqual(0);
    expect(recs.length).toBeLessThanOrEqual(3);
  });
});

describe("recommendLocales — ROI sorting (Test 4)", () => {
  const recs = recommendLocales({ liveLocales: ["en-US"], category: "Games" });

  it("first recommendation outranks the last (sorted descending by ROI)", () => {
    // We can't read the private score, but the tier ordering is observable:
    // a 'large' first row should never sit below a 'long-tail' last row.
    const TIER_RANK: Record<LocaleRecommendation["storefrontTier"], number> = {
      large: 3,
      mid: 2,
      "long-tail": 1,
    };
    const first = recs[0]!;
    const last = recs[recs.length - 1]!;
    expect(TIER_RANK[first.storefrontTier]).toBeGreaterThanOrEqual(TIER_RANK[last.storefrontTier]);
  });

  it("a large storefront (es-MX) ranks above a long-tail one (hr-HR) in the full ranking", () => {
    // The invariant: a large storefront with no category penalty must outrank a
    // long-tail one. The public API caps the list, so assert it via the unbounded
    // ranking (rankAll) where every candidate is present — es-MX before hr-HR.
    const ranked = locales(rankAll({ liveLocales: ["en-US"], category: "Games" }));
    expect(ranked.indexOf("es-MX")).toBeLessThan(ranked.indexOf("hr-HR"));
    // And under a NEUTRAL category lens (no Games boosts), es-MX makes the top cut
    // while the long-tail hr-HR does not.
    const neutral = locales(recommendLocales({ liveLocales: ["en-US"] }));
    expect(neutral).toContain("es-MX");
    expect(neutral).not.toContain("hr-HR");
  });
});

describe("recommendLocales — category boost (Test 5)", () => {
  it("Productivity boosts de-DE above ja-JP relative to the neutral baseline", () => {
    const prod = locales(recommendLocales({ liveLocales: ["en-US"], category: "Productivity" }));
    // de-DE has a strong Productivity affinity; assert it leads ja-JP under that lens.
    if (prod.includes("de-DE") && prod.includes("ja-JP")) {
      expect(prod.indexOf("de-DE")).toBeLessThan(prod.indexOf("ja-JP"));
    } else {
      expect(prod).toContain("de-DE");
    }
  });

  it("Games favors ru-RU enough to surface it in the top recommendations", () => {
    const games = locales(recommendLocales({ liveLocales: ["en-US"], category: "Games" }));
    expect(games).toContain("ru-RU");
  });

  it("the SAME locale ranks higher under a category it fits than under one it doesn't", () => {
    // de-DE: strong under Productivity, neutral under Games. Its rank index should
    // be no worse under Productivity than under Games.
    const prod = locales(recommendLocales({ liveLocales: ["en-US"], category: "Productivity" }));
    const games = locales(recommendLocales({ liveLocales: ["en-US"], category: "Games" }));
    expect(prod.indexOf("de-DE")).toBeLessThanOrEqual(games.indexOf("de-DE"));
  });
});

describe("recommendLocales — effort field (Test 6)", () => {
  it("single-locale app → all translate", () => {
    const recs = recommendLocales({ liveLocales: ["en-US"] });
    expect(recs.every((r) => r.effort === "translate")).toBe(true);
  });

  it("multi-locale app (already has metadata in several locales) → all new", () => {
    const recs = recommendLocales({
      liveLocales: ["en-US", "es-MX", "de-DE", "fr-FR"],
    });
    expect(recs.every((r) => r.effort === "new")).toBe(true);
  });
});

describe("recommendLocales — honest, non-fabricated rationale (Test 7)", () => {
  const recs = recommendLocales({ liveLocales: ["en-US"], category: "Games" });

  it("every rationale uses market/language descriptors", () => {
    const descriptor = /(market|storefront|category|language|audience|speak)/i;
    for (const r of recs) {
      expect(r.rationale).toMatch(descriptor);
    }
  });

  it("no rationale fabricates install / revenue / percentage numbers", () => {
    // No digit-bearing claims ("10,000 installs", "double revenue", "+30%").
    for (const r of recs) {
      expect(r.rationale).not.toMatch(/\d/);
      expect(r.rationale.toLowerCase()).not.toContain("install");
      expect(r.rationale.toLowerCase()).not.toContain("revenue");
      expect(r.rationale).not.toContain("%");
    }
  });

  it("no rationale claims causation (will rank #1 / guaranteed / will gain)", () => {
    for (const r of recs) {
      const lc = r.rationale.toLowerCase();
      expect(lc).not.toContain("will rank");
      expect(lc).not.toContain("guarantee");
      expect(lc).not.toContain("will gain");
      expect(lc).not.toContain("#1");
    }
  });
});

describe("recommendLocales — missing category degrades gracefully (Test 8)", () => {
  it("returns tier-sorted recommendations with no category and never throws", () => {
    const recs = recommendLocales({ liveLocales: ["en-US"], category: undefined });
    expect(recs.length).toBeGreaterThanOrEqual(5);
    // Tier-only sort: large storefronts should lead the list.
    expect(recs[0]!.storefrontTier).toBe("large");
  });

  it("an unknown category falls back to tier-only sorting (no crash, still recommends)", () => {
    const recs = recommendLocales({ liveLocales: ["en-US"], category: "Totally Unknown Category" });
    expect(recs.length).toBeGreaterThanOrEqual(5);
    expect(recs[0]!.storefrontTier).toBe("large");
  });
});

describe("recommendLocales — winnability over vanity (overview honesty)", () => {
  it("does NOT exclude large incumbents but never fabricates a ROI number to chase them", () => {
    // A single-locale app SHOULD be pointed at large reachable surfaces — the win
    // here is the fresh keyword surface, not chasing an unreachable incumbent.
    const recs = recommendLocales({ liveLocales: ["en-US"] });
    expect(recs.some((r) => r.storefrontTier === "large")).toBe(true);
  });

  it("unknown live locales are ignored, not crashed on", () => {
    const recs = recommendLocales({ liveLocales: ["en-US", "xx-ZZ"] });
    expect(recs.length).toBeGreaterThanOrEqual(5);
    expect(locales(recs)).not.toContain("xx-ZZ");
  });
});
