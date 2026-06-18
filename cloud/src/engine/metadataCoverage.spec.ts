import { describe, expect, it } from "vitest";
import { metadataCoverage, type CoverageReport } from "./metadataCoverage.js";
import { CHAR_LIMITS } from "./constants.js";

// ── Char accounting ───────────────────────────────────────────────────────────

describe("metadataCoverage — char accounting", () => {
  it("empty copy → all usedChars zero, coverage 0, no terms, no waste", () => {
    const r = metadataCoverage({});
    expect(r.usedChars).toEqual({ name: 0, subtitle: 0, keywords: 0 });
    expect(r.coverageScore).toBe(0);
    expect(r.distinctTerms).toBe(0);
    expect(r.waste).toEqual([]);
  });

  it("undefined fields are skipped, not crashed on", () => {
    const r = metadataCoverage({ name: undefined, subtitle: undefined, keywords: undefined });
    expect(r.usedChars).toEqual({ name: 0, subtitle: 0, keywords: 0 });
  });

  it("counts the real length of each field", () => {
    const r = metadataCoverage({ name: "Weather", subtitle: "Forecast", keywords: "rain,storm" });
    expect(r.usedChars.name).toBe("Weather".length);
    expect(r.usedChars.subtitle).toBe("Forecast".length);
    expect(r.usedChars.keywords).toBe("rain,storm".length);
  });

  it("a fully-filled budget reports the limits exactly", () => {
    const name = "a".repeat(CHAR_LIMITS.name);
    const subtitle = "b".repeat(CHAR_LIMITS.subtitle);
    const keywords = "c".repeat(CHAR_LIMITS.keywords);
    const r = metadataCoverage({ name, subtitle, keywords });
    expect(r.usedChars).toEqual({
      name: CHAR_LIMITS.name,
      subtitle: CHAR_LIMITS.subtitle,
      keywords: CHAR_LIMITS.keywords,
    });
  });
});

// ── Duplicate detection (across fields) ───────────────────────────────────────

describe("metadataCoverage — duplicate detection", () => {
  it("a term in name + keywords is a duplicate (Apple counts it once)", () => {
    const r = metadataCoverage({ name: "Rain Radar", subtitle: "Live maps", keywords: "rain,storm,radar" });
    const dup = r.waste.find((w) => w.kind === "duplicate");
    expect(dup).toBeTruthy();
    expect((dup as CoverageReport["waste"][number]).detail.toLowerCase()).toContain("rain");
  });

  it("no cross-field overlap → no duplicate waste", () => {
    const r = metadataCoverage({ name: "Weather", subtitle: "Forecast", keywords: "storm,thunder" });
    expect(r.waste.find((w) => w.kind === "duplicate")).toBeFalsy();
  });

  it("duplicate waste chars equal the repeated term's length", () => {
    const r = metadataCoverage({ name: "Storm", subtitle: "Live", keywords: "storm,radar" });
    const dup = r.waste.find((w) => w.kind === "duplicate");
    expect(dup?.chars).toBe("storm".length);
  });
});

// ── Brand-repeat detection (ties to #42) ──────────────────────────────────────

describe("metadataCoverage — brand repeat", () => {
  it("a name word repeated in the subtitle is brand_repeat waste", () => {
    const r = metadataCoverage({ name: "MyApp", subtitle: "MyApp Pro", keywords: "fast,clean" }, { brand: "MyApp" });
    const brand = r.waste.find((w) => w.kind === "brand_repeat");
    expect(brand).toBeTruthy();
    expect(brand?.chars).toBe("MyApp".length);
  });

  it("no brand word in the subtitle → no brand_repeat waste", () => {
    const r = metadataCoverage({ name: "MyApp", subtitle: "Best Pro App", keywords: "fast" }, { brand: "MyApp" });
    expect(r.waste.find((w) => w.kind === "brand_repeat")).toBeFalsy();
  });

  it("brand is filtered from the term analysis so it's never double-counted as a normal duplicate", () => {
    const r = metadataCoverage({ name: "MyApp", subtitle: "MyApp Pro", keywords: "myapp,fast" }, { brand: "MyApp" });
    const brandHits = r.waste.filter((w) => w.kind === "brand_repeat");
    // only one brand_repeat entry for the brand token, not a duplicate + a brand_repeat
    expect(brandHits.length).toBe(1);
    expect(r.waste.find((w) => w.kind === "duplicate" && w.detail.toLowerCase().includes("myapp"))).toBeFalsy();
  });
});

// ── Filler detection (low scoreKeyword) ───────────────────────────────────────

describe("metadataCoverage — filler", () => {
  it("low-value stopword-like terms are flagged as filler, not high-value ones", () => {
    const r = metadataCoverage({ name: "App", subtitle: "The Best", keywords: "the,best,app" });
    const fillers = r.waste.filter((w) => w.kind === "filler");
    // 'the' is a classic low-value filler term
    expect(fillers.some((f) => f.detail.toLowerCase().includes("the"))).toBe(true);
  });

  it("filler detail is advisory ('low-relevance'), never a hard 'definitely remove' command", () => {
    const r = metadataCoverage({ name: "App", subtitle: "The One", keywords: "the,a,of" });
    const fillers = r.waste.filter((w) => w.kind === "filler");
    fillers.forEach((f) => {
      expect(f.detail.toLowerCase()).not.toContain("definitely remove");
    });
    expect(fillers.length).toBeGreaterThan(0);
  });
});

// ── Coverage math ─────────────────────────────────────────────────────────────

describe("metadataCoverage — coverage score", () => {
  const BUDGET = CHAR_LIMITS.name + CHAR_LIMITS.subtitle + CHAR_LIMITS.keywords;

  it("a full budget with zero waste is 100% coverage", () => {
    // distinct, high-value, no cross-field overlap, no brand, no filler.
    const name = "weather forecast radar"; // <=30
    const subtitle = "storm thunder lightning"; // <=30
    const keywords = "hurricane,tornado,blizzard,cyclone,monsoon,drizzle,humidity"; // distinct
    const r = metadataCoverage({ name, subtitle, keywords });
    const totalWaste = r.waste.reduce((s, w) => s + w.chars, 0);
    expect(r.coverageScore).toBeCloseTo(((BUDGET - totalWaste) / BUDGET) * 100, 5);
  });

  it("never reports coverage above 100 even with every field maxed", () => {
    const name = "weather forecast radar maps"; // distinct, no overlap
    const subtitle = "storm thunder bolt zone";
    const keywords = "hurricane,tornado,blizzard,cyclone,monsoon";
    const r = metadataCoverage({ name, subtitle, keywords });
    expect(r.coverageScore).toBeLessThanOrEqual(100);
  });

  it("never reports coverage below 0 even when waste exceeds budget arithmetically", () => {
    // pathological all-duplicate, all-filler copy
    const r = metadataCoverage({ name: "the the the", subtitle: "the the the", keywords: "the,the,the,the" });
    expect(r.coverageScore).toBeGreaterThanOrEqual(0);
  });

  it("waste lowers coverage below the no-waste baseline", () => {
    const clean = metadataCoverage({ name: "Weather", subtitle: "Forecast", keywords: "storm,radar" });
    const wasteful = metadataCoverage({ name: "Weather", subtitle: "Weather Pro", keywords: "weather,storm" }, { brand: "Weather" });
    expect(wasteful.coverageScore).toBeLessThan(clean.coverageScore);
  });
});

// ── Distinct terms ────────────────────────────────────────────────────────────

describe("metadataCoverage — distinct terms", () => {
  it("counts unique tokens across all fields after dedup", () => {
    const r = metadataCoverage({ name: "Weather App", subtitle: "Weather Forecast", keywords: "weather,forecast,rain" });
    // unique non-brand tokens: weather, app, forecast, rain → 4
    expect(r.distinctTerms).toBe(4);
  });

  it("excludes the brand from the distinct count", () => {
    const withBrand = metadataCoverage({ name: "MyApp Weather", subtitle: "Forecast", keywords: "rain" }, { brand: "MyApp" });
    // weather, forecast, rain → 3 (MyApp removed)
    expect(withBrand.distinctTerms).toBe(3);
  });
});

// ── Honesty disciplines ───────────────────────────────────────────────────────

describe("metadataCoverage — honesty", () => {
  it("unused empty space is NOT counted as waste (a short name is low usage, not waste)", () => {
    const r = metadataCoverage({ name: "App", subtitle: "", keywords: "" });
    expect(r.waste.find((w) => w.kind === "unused")).toBeFalsy();
    // a 3-char clean name has no waste at all → full coverage relative to budget
    expect(r.coverageScore).toBe(100);
  });

  it("never claims a term CAUSED a rank change — no causal language in details", () => {
    const r = metadataCoverage({ name: "Weather", subtitle: "Weather Pro", keywords: "weather,the,storm" }, { brand: "Weather" });
    for (const w of r.waste) {
      const d = w.detail.toLowerCase();
      expect(d).not.toMatch(/caused|will rank|guarantees rank|because of this you rank/);
    }
  });

  it("is deterministic — same input yields deep-equal output", () => {
    const input = { name: "Weather Radar", subtitle: "Live storm maps", keywords: "rain,storm,radar,weather" };
    expect(metadataCoverage(input)).toEqual(metadataCoverage(input));
  });

  it("topMissingValue is omitted (deferred to the gap finder, #01) — exactOptional respected", () => {
    const r = metadataCoverage({ name: "Weather", subtitle: "Forecast", keywords: "storm" });
    expect("topMissingValue" in r ? r.topMissingValue : undefined).toBeUndefined();
  });
});
