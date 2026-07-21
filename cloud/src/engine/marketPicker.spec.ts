/**
 * Market picker (#180 Phase 2) — "your next N markets", reasoned only from
 * MEASURED language coverage + the category. No fabricated market-size numbers.
 *
 * Invariants:
 *   • already-localized markets are never re-recommended,
 *   • capped at `limit` (default 3),
 *   • each pick carries its measured reason (a rationale string, no TAM number),
 *   • empty coverage → [].
 */
import { describe, expect, it } from "vitest";
import { pickMarkets, marketPickerFindings } from "./marketPicker.js";

describe("pickMarkets", () => {
  it("recommends markets from coverage, excluding already-localized ones", () => {
    const picks = pickMarkets({
      currentLanguages: ["en-US"],
      categoryName: "Weather",
      alreadyLocalized: [],
      limit: 3,
    });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(3);
    // each pick has a locale + a measured reason (no bare number as the whole reason)
    for (const p of picks) {
      expect(p.locale).toBeTruthy();
      expect(p.reason).toBeTruthy();
      expect(p.reason).not.toMatch(/^\$?\d[\d,]*$/); // reason isn't just a fabricated size
    }
  });

  it("never re-recommends a locale that's already localized", () => {
    const all = pickMarkets({ currentLanguages: ["en-US"], categoryName: "Weather", alreadyLocalized: [] });
    const first = all[0]!.locale;
    const filtered = pickMarkets({
      currentLanguages: ["en-US"],
      categoryName: "Weather",
      alreadyLocalized: [first],
    });
    expect(filtered.map((p) => p.locale)).not.toContain(first);
  });

  it("caps at the limit", () => {
    const picks = pickMarkets({ currentLanguages: ["en-US"], categoryName: "Weather", alreadyLocalized: [], limit: 2 });
    expect(picks.length).toBeLessThanOrEqual(2);
  });

  it("empty languages → no picks", () => {
    expect(pickMarkets({ currentLanguages: [], alreadyLocalized: [] })).toEqual([]);
  });
});

describe("marketPickerFindings", () => {
  it("produces one 'next markets' finding listing picks + reasons", () => {
    const picks = pickMarkets({ currentLanguages: ["en-US"], categoryName: "Weather", alreadyLocalized: [], limit: 3 });
    const f = marketPickerFindings(picks)[0]!;
    expect(f.surface).toBe("localization");
    expect(f.detail).toContain(picks[0]!.locale);
  });

  it("no picks → no findings", () => {
    expect(marketPickerFindings([])).toEqual([]);
  });
});
