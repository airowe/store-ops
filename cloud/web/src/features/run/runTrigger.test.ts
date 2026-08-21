/**
 * The agent's account of why it opened this run.
 *
 * `trigger` has ridden every persisted run since runs existed, and no surface
 * has ever rendered it. That is the gap this closes: the product's claim is that
 * the agent decides and the human approves, but the human was shown the decision
 * without the reason for it.
 *
 * These tests pin the honesty rules, not the wording: a cron run says what
 * crossed, a manual run does not pretend to be autonomous, and an empty reason
 * list never becomes an invented one.
 */
import { describe, expect, it } from "vitest";
import { runTrigger } from "./runTrigger.js";

describe("runTrigger", () => {
  it("names the agent as the actor on a cron run", () => {
    const t = runTrigger({ source: "cron", reasons: ["lead keyword fell 4 places"] });
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.actor).toBe("agent");
    expect(t.headline).toMatch(/ShipASO/);
  });

  it("carries the measured reasons through verbatim — they are evidence, not copy", () => {
    const reasons = ["lead keyword fell 4 places", "competitor changed subtitle"];
    const t = runTrigger({ source: "cron", reasons });
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.reasons).toEqual(reasons);
  });

  it("does not claim the agent decided when a human asked for the run", () => {
    const t = runTrigger({ source: "manual", reasons: [] });
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.actor).toBe("human");
    expect(t.headline).not.toMatch(/ShipASO (noticed|found|detected)/i);
  });

  it("treats a connect-time run as the first look, not a detection", () => {
    const t = runTrigger({ source: "connect", reasons: [] });
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.actor).toBe("system");
    expect(t.headline).toMatch(/first/i);
  });

  it("invents no reason when the trace carried none", () => {
    const t = runTrigger({ source: "cron", reasons: [] });
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.reasons).toEqual([]);
  });

  it("returns null for a missing trigger rather than guessing one", () => {
    expect(runTrigger(undefined)).toBeNull();
    expect(runTrigger(null)).toBeNull();
  });

  it("survives an unknown source added later without asserting an actor", () => {
    // Fails closed: a source this code has never seen must not be narrated as
    // the agent's decision.
    const t = runTrigger({ source: "webhook" as never, reasons: ["something"] });
    expect(t).not.toBeNull();
    expect(t?.actor).toBe("system");
  });
});
