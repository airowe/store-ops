import { describe, it, expect } from "vitest";
import {
  type Reasoner,
  type PlannerInputs,
  type PlannedShot,
  reconcilePlan,
  planScreenshots,
  lintHeadline,
  TEMPLATE_IDS,
} from "./screenshotPlanner";

// The recurring fixture: a rank-tracking ASO app whose audit says it has only 3
// shots (needs 6), grades C, and leads with a settings screen instead of a hook.
const INPUTS: PlannerInputs = {
  appName: "ShipASO - Rank Tracker",
  subtitle: "Prove your keyword ranks moved",
  keywords: ["aso", "keyword rank", "app store optimization", "rank tracker"],
  rawScreens: ["dashboard", "rank-graph", "keyword-list", "settings"],
  audit: {
    grade: "C",
    recommendedCount: 6,
    findings: [
      "Only 3 screenshots — plan for 6",
      "Shot 1 leads with a settings screen, not a benefit hook",
    ],
  },
  brandPalette: ["#34d399", "#0d0f14", "#eef1f6"],
};

/** A fake reasoner returning canned model text (mirrors keywordReasoner.spec). */
const fakeReasoner =
  (canned: string): Reasoner =>
  async () =>
    canned;

const validPlan = () => ({
  narrative: "Lead with the rank-proof hook, then show the graph and keywords.",
  shots: [
    { sourceScreen: "rank-graph", headline: "Prove your rank moved", templateId: "headline-top", accent: "#34d399" },
    { sourceScreen: "dashboard", headline: "See every keyword", subline: "One dashboard", templateId: "headline-bottom" },
    { sourceScreen: "keyword-list", headline: "Track what matters", templateId: "full-bleed" },
  ],
});

// ── lintHeadline — the honesty guard ─────────────────────────────────────────
describe("lintHeadline — length + no unmeasured claims", () => {
  it("passes a short benefit-first headline", () => {
    expect(lintHeadline("Prove your rank moved").ok).toBe(true);
  });

  it("fails a headline longer than 6 words", () => {
    const r = lintHeadline("Prove that your app store keyword rank actually moved up");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/6 words/i);
  });

  it("fails an unmeasured superlative claim (#1 / best / number one)", () => {
    for (const claim of ["#1 ASO app", "The best rank tracker", "Number one for ASO"]) {
      expect(lintHeadline(claim).ok).toBe(false);
    }
  });

  it("fails an empty headline", () => {
    expect(lintHeadline("   ").ok).toBe(false);
  });
});

// ── reconcilePlan — schema validation + honesty guardrails ────────────────────
describe("reconcilePlan — validate the model's plan against the inputs", () => {
  it("accepts a well-formed plan", () => {
    const plan = reconcilePlan(JSON.stringify(validPlan()), INPUTS);
    expect(plan.shots.length).toBe(3);
    expect(plan.shots[0]!.headline).toBe("Prove your rank moved");
  });

  it("throws on unparseable model output (orchestrator catches → degrades)", () => {
    expect(() => reconcilePlan("not json at all", INPUTS)).toThrow();
  });

  it("marks a shot whose sourceScreen is NOT a real raw screen as MISSING", () => {
    const p = validPlan();
    p.shots[0]!.sourceScreen = "a-screen-that-was-never-captured";
    const plan = reconcilePlan(JSON.stringify(p), INPUTS);
    expect(plan.shots[0]!.sourceScreen).toBe("MISSING");
    // and it carries an honest note rather than a fabricated screen
    expect(plan.shots[0]!.missingReason).toBeTruthy();
  });

  it("keeps an explicit MISSING the model itself declared (honest gap)", () => {
    const p = validPlan();
    p.shots[1]!.sourceScreen = "MISSING";
    const plan = reconcilePlan(JSON.stringify(p), INPUTS);
    expect(plan.shots[1]!.sourceScreen).toBe("MISSING");
  });

  it("rejects a shot with an unknown templateId (falls back to a known one)", () => {
    const p = validPlan();
    (p.shots[2] as { templateId: string }).templateId = "spinny-3d-carousel";
    const plan = reconcilePlan(JSON.stringify(p), INPUTS);
    expect(TEMPLATE_IDS).toContain(plan.shots[2]!.templateId);
  });

  it("drops (does not ship) a shot whose headline fails the lint", () => {
    const p = validPlan();
    p.shots[0]!.headline = "The #1 best app store optimization tool ever made";
    const plan = reconcilePlan(JSON.stringify(p), INPUTS);
    // the offending shot is flagged for review, never silently shipped as-is
    const flagged = plan.shots.find((s: PlannedShot) => s.needsReview);
    expect(flagged).toBeTruthy();
    expect(flagged?.headlineIssue).toMatch(/6 words|claim/i);
  });

  it("rejects an accent not in the brand palette (uses a palette color)", () => {
    const p = validPlan();
    p.shots[0]!.accent = "#ff00ff"; // not in brandPalette
    const plan = reconcilePlan(JSON.stringify(p), INPUTS);
    expect(INPUTS.brandPalette).toContain(plan.shots[0]!.accent);
  });

  it("carries the machine-generated draft label", () => {
    const plan = reconcilePlan(JSON.stringify(validPlan()), INPUTS);
    expect(plan.label).toMatch(/draft/i);
  });
});

// ── planScreenshots — async wrapper + degrade path ───────────────────────────
describe("planScreenshots — end to end over a Reasoner", () => {
  it("returns the reconciled plan on good model output", async () => {
    const plan = await planScreenshots(INPUTS, fakeReasoner(JSON.stringify(validPlan())));
    expect(plan.shots.length).toBe(3);
    expect(plan.degraded).toBe(false);
  });

  it("degrades to a deterministic plan when the model errors", async () => {
    const throwing: Reasoner = async () => {
      throw new Error("model unavailable");
    };
    const plan = await planScreenshots(INPUTS, throwing);
    // deterministic plan still produces the recommendedCount shots, grounded in
    // real raw screens, and is honestly marked degraded.
    expect(plan.degraded).toBe(true);
    expect(plan.shots.length).toBe(INPUTS.audit.recommendedCount);
    expect(plan.shots.every((s: PlannedShot) => s.sourceScreen === "MISSING" || INPUTS.rawScreens.includes(s.sourceScreen))).toBe(true);
  });

  it("degrades on garbage (unparseable) model output too", async () => {
    const plan = await planScreenshots(INPUTS, fakeReasoner("```lol not json```"));
    expect(plan.degraded).toBe(true);
  });

  it("with no reasoner at all, returns the deterministic plan", async () => {
    const plan = await planScreenshots(INPUTS, undefined);
    expect(plan.degraded).toBe(true);
    expect(plan.shots.length).toBe(INPUTS.audit.recommendedCount);
  });
});
