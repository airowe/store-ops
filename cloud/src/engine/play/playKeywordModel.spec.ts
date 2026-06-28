import { describe, expect, it } from "vitest";
import { analyzePlayKeywords } from "./playKeywordModel.js";

const LISTING = {
  title: "Calm: Sleep & Meditation",
  shortDescription: "Guided meditation and sleep stories",
  description:
    "Calm is the app for sleep and meditation. Guided meditation, sleep stories, and breathing exercises help you relax. Meditation for anxiety and focus.",
};

describe("analyzePlayKeywords — coverage across the indexed fields", () => {
  it("measures presence of a target in title / short / long", () => {
    const r = analyzePlayKeywords({ ...LISTING, targets: ["meditation"] });
    const t = r.terms[0]!;
    expect(t.term).toBe("meditation");
    expect(t.inTitle).toBe(true);
    expect(t.inShortDescription).toBe(true);
    expect(t.inDescription).toBe(true);
    expect(t.covered).toBe(true);
  });

  it("counts MEASURED occurrences in the long description (never volume)", () => {
    const r = analyzePlayKeywords({ ...LISTING, targets: ["meditation"] });
    expect(r.terms[0]!.descriptionCount).toBe(3); // counted, not estimated
  });

  it("matches whole words/phrases, not substrings ('art' is not in 'smart')", () => {
    const r = analyzePlayKeywords({ description: "smart cooking", targets: ["art"] });
    expect(r.terms[0]!.inDescription).toBe(false);
    expect(r.terms[0]!.descriptionCount).toBe(0);
  });

  it("handles multi-word phrase targets", () => {
    const r = analyzePlayKeywords({
      description: "guided meditation for sleep stories every night",
      targets: ["sleep stories"],
    });
    expect(r.terms[0]!.inDescription).toBe(true);
    expect(r.terms[0]!.descriptionCount).toBe(1);
  });

  it("dedupes and normalizes targets", () => {
    const r = analyzePlayKeywords({ description: "x", targets: ["Sleep", "sleep", " SLEEP "] });
    expect(r.terms).toHaveLength(1);
    expect(r.terms[0]!.term).toBe("sleep");
  });
});

describe("analyzePlayKeywords — gaps + stuffing", () => {
  it("reports targets missing from the long description (the keyword surface)", () => {
    const r = analyzePlayKeywords({
      title: "Calm",
      description: "sleep and relaxation",
      targets: ["sleep", "anxiety", "focus"],
    });
    expect(r.missingFromDescription).toEqual(["anxiety", "focus"]);
  });

  it("reports fully uncovered targets (present in NO indexed field)", () => {
    const r = analyzePlayKeywords({
      title: "Calm",
      shortDescription: "sleep app",
      description: "sleep and relaxation",
      targets: ["sleep", "journaling"],
    });
    expect(r.uncovered).toEqual(["journaling"]);
  });

  it("flags a target OVER-repeated in the long description as stuffed", () => {
    const r = analyzePlayKeywords(
      { description: `meditation `.repeat(8) + "sleep", targets: ["meditation", "sleep"] },
      { stuffingMax: 6 },
    );
    expect(r.stuffed).toEqual(["meditation"]);
  });

  it("carries NO volume/score field — presence + counts only (honesty #1)", () => {
    const r = analyzePlayKeywords({ description: "sleep", targets: ["sleep"] });
    // The shape exposes measured presence/counts and gaps — never a 'volume',
    // 'score', or 'value' that would imply unmeasured search demand.
    expect(Object.keys(r.terms[0]!).sort()).toEqual(
      ["covered", "descriptionCount", "inDescription", "inShortDescription", "inTitle", "term"].sort(),
    );
  });

  it("an empty target list yields empty, never throws", () => {
    const r = analyzePlayKeywords({ description: "sleep", targets: [] });
    expect(r).toEqual({ terms: [], missingFromDescription: [], uncovered: [], stuffed: [] });
  });
});
