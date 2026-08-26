/**
 * Spend bounds on the agent-drivable write tools (WebMCP decisions 4 and 5).
 *
 * A page agent can trigger runs and set cadence. Both spend money on OUR
 * inference key — a run reasons with the Anthropic client, and cadence
 * multiplies how often that recurs. The tools are legitimate; an unbounded loop
 * is not.
 *
 * These are PURE decisions over already-counted inputs, so the policy is
 * testable without a DB and the caller owns the counting.
 *
 * HONESTY: these are bounds, not spend caps. Like publicReportGuard's limiter,
 * they damp a runaway; they do not account for money. The tests say so.
 */
import { describe, expect, it } from "vitest";
import { checkDailyCadenceBound, checkRunTriggerBound } from "./agentBounds.js";

describe("checkRunTriggerBound", () => {
  it("ALLOWS a first agent-triggered run", () => {
    expect(checkRunTriggerBound({ runsInWindow: 0, tier: "free" })).toEqual({ ok: true });
  });

  it("REFUSES once the window's allowance is spent", () => {
    const v = checkRunTriggerBound({ runsInWindow: 3, tier: "free" });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error).toMatch(/limit|too many|slow down/i);
      // the human must be able to act — never a dead end with no explanation
      expect(v.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("gives paid tiers more headroom than free", () => {
    const free = checkRunTriggerBound({ runsInWindow: 3, tier: "free" });
    const scale = checkRunTriggerBound({ runsInWindow: 3, tier: "scale" });
    expect(free.ok).toBe(false);
    expect(scale.ok).toBe(true);
  });

  it("is monotonic — more runs never becomes MORE permissive", () => {
    for (const tier of ["free", "indie", "startup", "scale"] as const) {
      let refused = false;
      for (let n = 0; n <= 200; n++) {
        const ok = checkRunTriggerBound({ runsInWindow: n, tier }).ok;
        if (refused) expect(ok).toBe(false);
        if (!ok) refused = true;
      }
      // every tier is bounded — none is effectively infinite
      expect(refused).toBe(true);
    }
  });
});

describe("checkDailyCadenceBound", () => {
  it("ALLOWS setting a weekly or biweekly cadence unconditionally", () => {
    for (const cadence of ["weekly", "biweekly"] as const) {
      expect(checkDailyCadenceBound({ cadence, dailyAppCount: 999, tier: "free" })).toEqual({
        ok: true,
      });
    }
  });

  it("ALLOWS the first daily app", () => {
    expect(checkDailyCadenceBound({ cadence: "daily", dailyAppCount: 0, tier: "free" })).toEqual({
      ok: true,
    });
  });

  it("REFUSES daily beyond the tier's allowance", () => {
    const v = checkDailyCadenceBound({ cadence: "daily", dailyAppCount: 1, tier: "free" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/daily/i);
  });

  it("scales the daily allowance with tier", () => {
    expect(checkDailyCadenceBound({ cadence: "daily", dailyAppCount: 2, tier: "scale" }).ok).toBe(true);
    expect(checkDailyCadenceBound({ cadence: "daily", dailyAppCount: 2, tier: "free" }).ok).toBe(false);
  });

  it("counts the app being CHANGED, so re-setting an already-daily app is allowed", () => {
    // dailyAppCount excludes this app (the caller's contract); at the limit with
    // this app already counted out, setting it daily must still succeed.
    const atLimit = checkDailyCadenceBound({ cadence: "daily", dailyAppCount: 0, tier: "free" });
    expect(atLimit.ok).toBe(true);
  });

  it("every tier is bounded — no tier may set unlimited daily apps", () => {
    for (const tier of ["free", "indie", "startup", "scale"] as const) {
      expect(checkDailyCadenceBound({ cadence: "daily", dailyAppCount: 10_000, tier }).ok).toBe(false);
    }
  });
});
