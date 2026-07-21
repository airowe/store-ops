/**
 * Grade-delta projection (#26 Studio) — project the grade a generated screenshot
 * set would reach, from the CURRENT ShotScore + the levers the set addresses.
 *
 * Invariants pinned here:
 *   • PROJECTED, never promised — uses the SAME gradeFor + shotLevers as the audit,
 *   • no over-sell: A-grade / no-headroom / unreadable → improved:false,
 *   • a set that addresses no lever → no bump (never a fabricated improvement),
 *   • the finding carries the "projected, not a promise" caveat + the driver levers.
 */
import { describe, expect, it } from "vitest";
import type { ShotScore } from "./screenshotScore.js";
import { shotLevers } from "./screenshotScore.js";
import { projectGrade, leversAddressedByPlan, gradeProjectionFinding } from "./gradeProjection.js";

/** A C-grade set (few iPhone shots → a real "count" lever with headroom). */
function cScore(over: Partial<ShotScore> = {}): ShotScore {
  return {
    app: "Weatherly",
    iphoneCount: 3,
    ipadCount: 0,
    score: 60, // C (>=50)
    grade: "C",
    findings: [],
    aspectHint: "",
    screenshotUrls: [],
    ...over,
  } as ShotScore;
}

describe("projectGrade", () => {
  it("sums the addressed levers' deltas and grades the result via gradeFor", () => {
    const s = cScore();
    const levers = shotLevers(s);
    expect(levers.length).toBeGreaterThan(0);
    const countLever = levers.find((l) => l.id === "count")!;
    const proj = projectGrade(s, ["count"]);
    expect(proj.fromScore).toBe(60);
    expect(proj.toScore).toBe(60 + countLever.delta);
    expect(proj.improved).toBe(true);
    expect(proj.addressed.map((l) => l.id)).toEqual(["count"]);
  });

  it("addressing NO lever → no bump (improved:false, no fabricated gain)", () => {
    const proj = projectGrade(cScore(), []);
    expect(proj.improved).toBe(false);
    expect(proj.toScore).toBe(proj.fromScore);
  });

  it("an unreadable ('?') / null-score set → no projection", () => {
    const proj = projectGrade(cScore({ grade: "?", score: null }), ["count"]);
    expect(proj.improved).toBe(false);
  });

  it("an A-grade set (no headroom) → no projection (never over-sell)", () => {
    // A grade → shotLevers returns [] → nothing to address
    const proj = projectGrade(cScore({ grade: "A", score: 90, iphoneCount: 8 }), ["count"]);
    expect(proj.improved).toBe(false);
    expect(proj.addressed).toEqual([]);
  });

  it("caps the projected score at 100", () => {
    const proj = projectGrade(cScore({ score: 98, grade: "A" }), ["count"]);
    expect(proj.toScore).toBeLessThanOrEqual(100);
  });
});

describe("leversAddressedByPlan", () => {
  it("claims 'count' only when the plan actually ships the recommended count", () => {
    const s = cScore({ iphoneCount: 3 }); // needs more shots
    expect(leversAddressedByPlan({ shotCount: 6, hasIpad: false, atTargetAspect: false }, s)).toContain("count");
    // a plan that ships only 3 shots doesn't satisfy the count lever
    expect(leversAddressedByPlan({ shotCount: 3, hasIpad: false, atTargetAspect: false }, s)).not.toContain("count");
  });

  it("is conservative — never claims a lever the plan doesn't satisfy", () => {
    const s = cScore();
    const addressed = leversAddressedByPlan({ shotCount: 6, hasIpad: false, atTargetAspect: false }, s);
    expect(addressed).not.toContain("ipad"); // plan has no iPad
  });
});

describe("gradeProjectionFinding", () => {
  it("quotes both grades + carries the 'projected, not a promise' caveat + drivers", () => {
    const proj = projectGrade(cScore(), ["count"]);
    const f = gradeProjectionFinding(proj)!;
    expect(f.surface).toBe("screenshots");
    expect(f.detail).toMatch(/projected/i);
    expect(f.detail.toLowerCase()).toMatch(/not a promise|not a guarantee/);
    expect(f.detail).toContain(proj.toGrade);
  });

  it("no improvement → null finding (silent)", () => {
    expect(gradeProjectionFinding(projectGrade(cScore(), []))).toBeNull();
  });
});
