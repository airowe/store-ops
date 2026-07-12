import { describe, expect, it } from "vitest";
import { extractLocaleKeywords, type MarketListing } from "./localeKeywords.js";

const L = (name: string, subtitle = ""): MarketListing => ({ name, subtitle });

describe("extractLocaleKeywords", () => {
  it("no usable listings → [] (never a fabricated candidate)", () => {
    expect(extractLocaleKeywords("jp", [])).toEqual([]);
    expect(extractLocaleKeywords("jp", [{ error: "timeout" }, L("", "")])).toEqual([]);
  });

  it("surfaces terms real market apps use, attributed to them, sorted by usage", () => {
    const out = extractLocaleKeywords("de", [
      L("Wetter Radar", "Regen Vorhersage"),
      L("Regen Alarm", "Wetter live"),
      L("Sturm Warnung", "Wetter Karte"),
    ]);
    // "wetter" appears in all three → top candidate
    expect(out[0]!.term).toBe("wetter");
    expect(out[0]!.usedByCount).toBe(3);
    expect(out[0]!.market).toBe("de");
    expect(out[0]!.usedBy).toEqual(["Regen Alarm", "Sturm Warnung", "Wetter Radar"]);
  });

  it("excludes your brand and your existing targets (not new signal)", () => {
    const out = extractLocaleKeywords(
      "de",
      [L("Wetter Radar", "Regen live"), L("Regen Alarm", "Wetter")],
      { brandTokens: ["Regen"], existingTerms: ["wetter"] },
    );
    const terms = out.map((c) => c.term);
    expect(terms).not.toContain("regen");
    expect(terms).not.toContain("wetter");
    expect(terms).toContain("radar");
  });

  it("excludes a competitor's OWN single-word brand", () => {
    // "Calm" is a pure brand word (single-token name) — not a transferable target
    const out = extractLocaleKeywords("us", [L("Calm", "meditation and sleep")]);
    expect(out.map((c) => c.term)).not.toContain("calm");
    expect(out.map((c) => c.term)).toEqual(expect.arrayContaining(["meditation", "sleep"]));
  });

  it("drops stopwords and one-char noise", () => {
    const out = extractLocaleKeywords("us", [L("The Best App", "for you")]);
    expect(out).toEqual([]); // every token is a stopword
  });

  it("lowercases the market + terms (attribution keeps the app's real name)", () => {
    // Same listings, market casing varies → identical output (market normalized).
    const a = extractLocaleKeywords("JP", [L("Sleep Tracker", "sleep sounds")]);
    const b = extractLocaleKeywords("jp", [L("Sleep Tracker", "sleep sounds")]);
    expect(a).toEqual(b);
    expect(a[0]!.market).toBe("jp");
    expect(a.every((c) => c.term === c.term.toLowerCase())).toBe(true);
    // the candidate for "sounds" is attributed to the real display name, verbatim
    expect(a.find((c) => c.term === "sounds")!.usedBy).toEqual(["Sleep Tracker"]);
  });

  it("handles space-less script segments without inventing tokenization", () => {
    // Japanese has no spaces; a two-app overlap on a segment still surfaces it.
    const out = extractLocaleKeywords("jp", [L("天気 レーダー"), L("天気 予報")]);
    const top = out.find((c) => c.term === "天気");
    expect(top?.usedByCount).toBe(2);
  });
});
