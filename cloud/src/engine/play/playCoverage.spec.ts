import { describe, expect, it } from "vitest";
import { playCoverage } from "./playCoverage.js";

describe("playCoverage — field fill + seen flag", () => {
  it("uses the Play 30/80/4000 budget", () => {
    const r = playCoverage({ title: "x", shortDescription: "y", description: "z" });
    const limits = Object.fromEntries(r.fieldFill.map((f) => [f.field, f.limit]));
    expect(limits).toEqual({ title: 30, shortDescription: 80, description: 4000 });
  });

  it("marks an UNSEEN field (undefined) as seen:false with 0 fill, never a false 0/limit", () => {
    const r = playCoverage({ title: "Spotify" }); // short + long unseen
    const short = r.fieldFill.find((f) => f.field === "shortDescription")!;
    const desc = r.fieldFill.find((f) => f.field === "description")!;
    expect(short.seen).toBe(false);
    expect(short.used).toBe(0);
    expect(short.fillPct).toBe(0);
    expect(desc.seen).toBe(false);
  });

  it("marks a MEASURED empty field seen:true (it WAS read, it's just empty)", () => {
    const r = playCoverage({ title: "x", shortDescription: "", description: "" });
    expect(r.fieldFill.find((f) => f.field === "shortDescription")!.seen).toBe(true);
  });
});

describe("playCoverage — stuffing is the waste model (not iOS cross-field dupes)", () => {
  const stuffed = `meditation `.repeat(9) + "calm sleep relax breathe focus"; // 9× "meditation"

  it("flags a term over-repeated in the long description", () => {
    const r = playCoverage({ title: "Calm", description: stuffed }, { stuffingMax: 6 });
    expect(r.stuffingRisk).toBe(true);
    const w = r.waste.find((x) => x.kind === "stuffing");
    expect(w?.term).toBe("meditation");
    expect(w?.count).toBe(9);
  });

  it("does NOT flag a healthy spread (no term over the threshold)", () => {
    const r = playCoverage({
      title: "Calm",
      description: "meditation sleep relax breathe focus calm mindfulness quiet",
    });
    expect(r.stuffingRisk).toBe(false);
    expect(r.waste.filter((w) => w.kind === "stuffing")).toEqual([]);
  });

  it("ignores stopword repetition (repeating 'the' is not stuffing)", () => {
    const r = playCoverage({ title: "X", description: `the `.repeat(20) + "calm sleep" });
    expect(r.stuffingRisk).toBe(false);
  });

  it("only counts the EXCESS repeats against the coverage score", () => {
    // 9× "meditation" with max 6 → 3 excess × 10 chars = 30 waste chars of 4110.
    const r = playCoverage({ title: "Calm", description: stuffed }, { stuffingMax: 6 });
    expect(r.coverageScore).toBeGreaterThan(99); // tiny dent, not a cliff
    expect(r.coverageScore).toBeLessThan(100);
  });
});

describe("playCoverage — brand burn in the short description", () => {
  it("flags the brand word burned in the short description", () => {
    const r = playCoverage(
      { title: "Calm", shortDescription: "Calm helps you sleep", description: "sleep relax" },
      { brand: "Calm" },
    );
    const w = r.waste.find((x) => x.kind === "brand_repeat");
    expect(w?.term).toBe("calm");
  });

  it("does not flag brand burn when the brand is absent from the short description", () => {
    const r = playCoverage(
      { title: "Calm", shortDescription: "Sleep better tonight", description: "sleep" },
      { brand: "Calm" },
    );
    expect(r.waste.some((w) => w.kind === "brand_repeat")).toBe(false);
  });
});

describe("playCoverage — honesty + score framing", () => {
  it("an empty listing (no distinct terms) floors coverage at 0, not 100", () => {
    expect(playCoverage({ title: "", shortDescription: "", description: "" }).coverageScore).toBe(0);
  });

  it("a clean, term-rich listing scores ~100 (no waste)", () => {
    const r = playCoverage({
      title: "Calm: Sleep & Meditation",
      shortDescription: "Sleep stories and guided meditation",
      description: "Guided meditation, sleep stories, breathing exercises, and relaxing music.",
    });
    expect(r.coverageScore).toBe(100);
    expect(r.distinctTerms).toBeGreaterThan(5);
  });
});
