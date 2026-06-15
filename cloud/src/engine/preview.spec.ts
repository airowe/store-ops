import { describe, expect, it } from "vitest";
import { buildPreview } from "./preview.js";
import type { AgentResult } from "./agent.js";

function makeResult(over: Partial<AgentResult> = {}): AgentResult {
  return {
    audit: {
      app: "Calm",
      bundleId: "com.calm.calmapp",
      liveName: "Calm",
      screenshots: { count: 5, score: 78, grade: "B", findings: ["Add a 6th shot"] } as never,
    },
    ranks: [
      { keyword: "meditation", rank: 4, foundName: "Calm", total: 200, limit: 200, error: "" },
      { keyword: "sleep", rank: 12, foundName: "Calm", total: 200, limit: 200, error: "" },
      { keyword: "calm", rank: null, foundName: "", total: 200, limit: 200, error: "" },
    ],
    competitors: { listings: [], changes: [] as never, digest: "" },
    reasoning: [
      { keyword: "meditation", volume: 70, difficulty: 30, relevance: 90, score: 82, bucket: "Primary" } as never,
      { keyword: "sleep", volume: 60, difficulty: 40, relevance: 80, score: 70, bucket: "Secondary" } as never,
    ],
    proposedCopy: { name: "Calm", subtitle: "Sleep & meditation", keywords: "sleep,meditation", validation: { pass: true, checks: [] } } as never,
    pushCommands: [],
    ...over,
  };
}

describe("buildPreview — teaser-safe subset of a run for logged-out visitors", () => {
  it("surfaces the app name + audit grade", () => {
    const p = buildPreview(makeResult());
    expect(p.appName).toBe("Calm");
    expect(p.auditGrade).toBe("B");
  });

  it("reports the lead keyword (best ranked) and its position", () => {
    const p = buildPreview(makeResult());
    expect(p.leadKeyword).toBe("meditation"); // rank 4 is the best
    expect(p.leadRank).toBe(4);
  });

  it("counts keywords checked and how many land in the top 10", () => {
    const p = buildPreview(makeResult());
    expect(p.keywordsChecked).toBe(3);
    expect(p.inTop10).toBe(1); // only meditation@4
  });

  it("includes a small ranked sample, but NOT the full proposal/copy", () => {
    const p = buildPreview(makeResult());
    expect(Array.isArray(p.sample)).toBe(true);
    expect(p.sample.length).toBeGreaterThan(0);
    // the payoff (proposed copy, push commands, full reasoning) is gated behind signup
    expect("proposedCopy" in p).toBe(false);
    expect("pushCommands" in p).toBe(false);
  });

  it("handles a listing with no ranked keywords (lead is null)", () => {
    const p = buildPreview(
      makeResult({
        ranks: [{ keyword: "x", rank: null, foundName: "", total: 100, limit: 200, error: "" }],
      }),
    );
    expect(p.leadRank).toBeNull();
    expect(p.inTop10).toBe(0);
  });

  it("tolerates a missing screenshot audit (grade null, not a throw)", () => {
    const p = buildPreview(makeResult({ audit: { app: "X", bundleId: "b", liveName: "X", screenshots: null } }));
    expect(p.auditGrade).toBeNull();
  });
});
