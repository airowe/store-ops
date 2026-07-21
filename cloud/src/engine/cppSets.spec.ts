/**
 * CPP sets (#154 Part 2) — cluster tracked keywords into intents, then run the
 * ShipShots planner once per intent to produce a proposed CPP set.
 *
 * Invariants pinned here:
 *   • SPARSE-DATA FLOOR: fewer than MIN_INTENTS distinct intents (each clearing
 *     MIN_KEYWORDS_PER_INTENT) → an honest refusal, never a guessed set,
 *   • each intent's plan is grounded in THAT intent's keywords,
 *   • the shared audit findings ride into every intent's plan,
 *   • no reasoner → deterministic fallback plans (still a real set),
 *   • the LLM never paints pixels — this returns PLANS.
 */
import { describe, expect, it } from "vitest";
import {
  buildCppSets,
  intentToPlannerInputs,
  MIN_INTENTS,
  MIN_KEYWORDS_PER_INTENT,
  type CppSetInputs,
} from "./cppSets.js";

function inputs(p: Partial<CppSetInputs> = {}): CppSetInputs {
  return {
    appName: "Weatherly",
    subtitle: "Honest forecasts",
    keywords: ["weather radar", "weather map", "trip forecast", "trip planner"],
    rawScreens: ["home", "map", "timeline"],
    auditGrade: "C",
    findings: ["Only 3 screenshots — plan for 6"],
    brandPalette: ["#34d399"],
    recommendedCount: 3,
    ...p,
  };
}

describe("intentToPlannerInputs", () => {
  it("carries the intent's own keywords + the shared audit context", () => {
    const pi = intentToPlannerInputs({ label: "trip", keywords: ["trip forecast", "trip planner"] }, inputs());
    expect(pi.keywords).toEqual(["trip forecast", "trip planner"]);
    expect(pi.appName).toBe("Weatherly");
    expect(pi.audit.findings).toEqual(["Only 3 screenshots — plan for 6"]);
    expect(pi.audit.grade).toBe("C");
    expect(pi.rawScreens).toEqual(["home", "map", "timeline"]);
    expect(pi.brandPalette).toEqual(["#34d399"]);
  });
});

describe("buildCppSets", () => {
  it("refuses when there aren't enough measured keywords for >=2 intents (no guessing)", async () => {
    const res = await buildCppSets(inputs({ keywords: ["weather"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not enough measured keywords/i);
  });

  it("refuses on empty keywords", async () => {
    const res = await buildCppSets(inputs({ keywords: [] }));
    expect(res.ok).toBe(false);
  });

  it("produces one plan per intent when >=MIN_INTENTS distinct intents exist", async () => {
    // two clear intents: weather* and trip*
    const res = await buildCppSets(inputs());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sets.length).toBeGreaterThanOrEqual(MIN_INTENTS);
      const labels = res.sets.map((s) => s.intent.label).sort();
      expect(labels).toContain("trip");
      expect(labels).toContain("weather");
      // each set's plan exists and is a real ScreenshotPlan
      for (const s of res.sets) {
        expect(s.plan.shots.length).toBeGreaterThan(0);
        expect(s.plan.label).toMatch(/draft/i);
      }
    }
  });

  it("grounds each intent's plan in its OWN keywords (via a capturing reasoner)", async () => {
    const promptsByCall: string[] = [];
    const reasoner = async (prompt: string) => {
      promptsByCall.push(prompt);
      // return garbage → each falls back deterministically, but we captured the prompt
      return "not json";
    };
    const res = await buildCppSets(inputs(), reasoner);
    expect(res.ok).toBe(true);
    // one prompt per intent, and the trip prompt mentions trip keywords, not weather ones
    const tripPrompt = promptsByCall.find((p) => p.includes("trip forecast"));
    expect(tripPrompt).toBeDefined();
    expect(tripPrompt).not.toMatch(/weather radar/);
  });

  it("without a reasoner, still returns a set via deterministic fallback plans", async () => {
    const res = await buildCppSets(inputs()); // no reasoner
    expect(res.ok).toBe(true);
    if (res.ok) {
      // deterministic plans are honestly marked degraded
      expect(res.sets.every((s) => s.plan.degraded)).toBe(true);
    }
  });

  it("only counts intents that clear MIN_KEYWORDS_PER_INTENT", async () => {
    // "weather"x3 forms one strong intent; "solo" is a 1-keyword intent → doesn't count
    const res = await buildCppSets(inputs({ keywords: ["weather radar", "weather map", "weather alerts", "solo"] }));
    // only ONE intent clears the floor → refuse
    expect(res.ok).toBe(false);
    expect(MIN_KEYWORDS_PER_INTENT).toBeGreaterThanOrEqual(2);
  });
});
