import { describe, it, expect } from "vitest";
import { creativeAssetBrief, type CreativeAssetBriefInput } from "./creativeAssetBrief.js";
import type { Opportunity } from "./rankOpportunity.js";

const opp = (o: Partial<Opportunity>): Opportunity => ({
  keyword: "secular meditation",
  rank: 12,
  opportunityScore: 80,
  scored: true,
  why: "close to top 10, weak competitors",
  reachability: "reachable",
  drivers: { distance: 60, competitorWeakness: 70, momentum: 55 },
  ...o,
}) as Opportunity;

const input = (o: Partial<CreativeAssetBriefInput> = {}): CreativeAssetBriefInput => ({
  appName: "Heathen",
  subtitle: "Secular meditation",
  ...o,
});

/** Every human-readable string the brief emits, flattened. */
function allCopy(b: ReturnType<typeof creativeAssetBrief>): string {
  return [b.note, ...b.assets.flatMap((a) => [a.focus, a.rationale, a.keyword ?? ""])].join(" ");
}

describe("creativeAssetBrief", () => {
  it("plans both surfaces Apple announced", () => {
    const b = creativeAssetBrief(input({ opportunities: [opp({})] }));
    expect(b.assets.map((a) => a.surface).sort()).toEqual(["productPageHeader", "searchResult"]);
  });

  it("the search-results asset leads with the top winnable keyword", () => {
    const b = creativeAssetBrief(
      input({
        opportunities: [
          opp({ keyword: "meditation", opportunityScore: 30 }),
          opp({ keyword: "secular meditation", opportunityScore: 90 }),
        ],
      }),
    );
    const search = b.assets.find((a) => a.surface === "searchResult")!;
    expect(search.keyword).toBe("secular meditation");
  });

  // The header's job is what screenshots cannot do. Stuffing it with the
  // keyword would cargo-cult the search asset's job onto a surface nobody
  // searches — and is the specific mistake the PRD calls out.
  it("the header is brand/seasonal — NOT a second keyword asset", () => {
    const b = creativeAssetBrief(input({ opportunities: [opp({ keyword: "secular meditation" })] }));
    const header = b.assets.find((a) => a.surface === "productPageHeader")!;
    expect(header.keyword).toBeUndefined();
  });

  /**
   * The load-bearing honesty test. Apple published NO dimensions, ratios or
   * durations. A brief that names one would be a fabricated measurement the
   * user builds against.
   */
  it("never states a dimension, ratio or duration while specs are unpublished", () => {
    const b = creativeAssetBrief(
      input({ opportunities: [opp({})], competitors: ["Calm"], brandPalette: ["#10b981"] }),
    );
    expect(b.assets.every((a) => a.specsKnown === false)).toBe(true);

    const copy = allCopy(b);
    expect(copy).not.toMatch(/\d{3,}\s*[x×]\s*\d{3,}/i); // 1200x630
    expect(copy).not.toMatch(/\b\d+\s*(?:px|pt)\b/i); // 1290px
    expect(copy).not.toMatch(/\b\d+\s*:\s*\d+\b/); // 16:9
    expect(copy).not.toMatch(/\b\d+\s*(?:seconds?|secs?|s)\b(?!\w)/i); // 30 seconds
  });

  it("says specs are unpublished rather than staying silent about it", () => {
    const b = creativeAssetBrief(input());
    expect(b.note.toLowerCase()).toMatch(/spec|dimension|size/);
    expect(b.note.toLowerCase()).toMatch(/not (yet )?published|unpublished|hasn.t published/);
  });

  // Conversion lane. A search-results asset changes whether someone CHOOSES
  // you; it does not move rank. Claiming otherwise is the exact over-promise
  // the honesty bar forbids.
  it("never promises a ranking improvement", () => {
    const b = creativeAssetBrief(input({ opportunities: [opp({})] }));
    const copy = allCopy(b).toLowerCase();
    expect(copy).not.toMatch(/rank (higher|better)|improve your rank|boost your rank|climb the rank/);
    // "not a guarantee" is the honest frame, so match the PROMISE, not the word.
    expect(copy).not.toMatch(/\bwe guarantee|is guaranteed|will (increase|boost|double)/);
  });

  it("says outright that these do not move rank", () => {
    const b = creativeAssetBrief(input({ opportunities: [opp({})] }));
    expect(b.note.toLowerCase()).toMatch(/do not move your position|not.*rank/);
  });

  it("degrades to a sound structure with no opportunities and no ASC data", () => {
    const b = creativeAssetBrief(input());
    expect(b.assets).toHaveLength(2);
    const search = b.assets.find((a) => a.surface === "searchResult")!;
    // No measured opportunity → no keyword invented. Absent, never a guess.
    expect(search.keyword).toBeUndefined();
    expect(search.focus.length).toBeGreaterThan(0);
    expect(search.rationale.length).toBeGreaterThan(0);
  });

  /**
   * #65: an unscored opportunity's 42.5 is an ARTIFACT of absent data, not a
   * measurement. Leading the search asset with it would present a default as a
   * finding.
   */
  it("ignores unscored opportunities — a default is not a measurement", () => {
    const b = creativeAssetBrief(
      input({
        opportunities: [
          opp({ keyword: "unscored term", opportunityScore: 99, scored: false }),
          opp({ keyword: "measured term", opportunityScore: 50, scored: true }),
        ],
      }),
    );
    const search = b.assets.find((a) => a.surface === "searchResult")!;
    expect(search.keyword).toBe("measured term");
  });

  it("with only unscored opportunities, names no keyword at all", () => {
    const b = creativeAssetBrief(
      input({ opportunities: [opp({ keyword: "unscored", scored: false })] }),
    );
    expect(b.assets.find((a) => a.surface === "searchResult")!.keyword).toBeUndefined();
  });

  it("names a rival to differentiate from when competitors are known", () => {
    const b = creativeAssetBrief(input({ opportunities: [opp({})], competitors: ["Calm", "Headspace"] }));
    expect(allCopy(b)).toContain("Calm");
  });

  /**
   * The brief must not INVENT a rival to differentiate from. It cannot forbid
   * the word outright: `Opportunity.why` legitimately says "weak competitors",
   * and quoting measured evidence is the point. So this pins the named rival
   * from the previous test — with no competitors supplied, "Calm" cannot appear.
   */
  it("names no rival when none are known", () => {
    const named = creativeAssetBrief(input({ opportunities: [opp({})], competitors: ["Calm"] }));
    expect(allCopy(named)).toContain("Calm");

    const b = creativeAssetBrief(input({ opportunities: [opp({})] }));
    expect(allCopy(b)).not.toContain("Calm");
    // and no dangling "Say what  does not." from an undefined rival
    expect(allCopy(b)).not.toMatch(/\s{2,}|undefined/);
  });

  it("a header with a brand palette draws from it rather than free-form colour", () => {
    const b = creativeAssetBrief(input({ brandPalette: ["#10b981", "#0b1120"] }));
    const header = b.assets.find((a) => a.surface === "productPageHeader")!;
    expect(header.rationale + header.focus).toContain("#10b981");
  });

  it("is pure — the same input twice yields an equal brief", () => {
    const i = input({ opportunities: [opp({})], competitors: ["Calm"] });
    expect(creativeAssetBrief(i)).toEqual(creativeAssetBrief(i));
  });
});
