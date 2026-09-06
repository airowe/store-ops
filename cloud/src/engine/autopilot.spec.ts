import { describe, expect, it } from "vitest";
import { autopilotGate, nextVersionString, planAutopilot, shippedFrom } from "./autopilot.js";

/**
 * Autopilot never widens what a person could do by hand: the gate is the
 * manual write gate plus the flag plus a stored key. Every step is planned as
 * done / skipped / failed, and 'shipped' has one meaning.
 */
const open = { flagOn: true, tier: "startup" as const, optedIn: true, autopilot: true, runStatus: "approved", hasStoredKey: true };

describe("autopilotGate", () => {
  it("allows only when every manual precondition AND the flag AND a stored key hold", () => {
    expect(autopilotGate(open)).toEqual({ allowed: true });
  });
  it.each([
    ["flag off", { autopilot: false }, /off for this account/],
    ["deployment flag off", { flagOn: false }, /not enabled/],
    ["free tier", { tier: "free" as const }, /cannot write/],
    ["no opt-in", { optedIn: false }, /opted in/],
    ["not approved", { runStatus: "awaiting_approval" }, /not approved/],
    ["shipped already", { runStatus: "shipped" }, /not approved/],
    ["no stored key", { hasStoredKey: false }, /no stored/],
  ])("refuses with a reason when %s", (_l, over, re) => {
    const g = autopilotGate({ ...open, ...over });
    expect(g.allowed).toBe(false);
    if (!g.allowed) expect(g.reason).toMatch(re);
  });
});

const copy = { name: "Heathen", subtitle: "Secular meditation", keywords: "meditation,secular" };
const de = { name: "Heathen", subtitle: "Weltliche Meditation", keywords: "meditation" };

describe("planAutopilot", () => {
  it("version, storefront metadata, each other approved locale, then the two honest skips", () => {
    const steps = planAutopilot({ proposedCopy: copy, localizedCopy: { "de-DE": de, "en-US": copy } }, "en-US");
    expect(steps.map((s) => s.step)).toEqual(["version", "metadata", "locale:de-DE", "screenshots", "experiment"]);
    expect(steps[1]).toMatchObject({ locale: "en-US", copy });
    expect(steps[2]).toMatchObject({ locale: "de-DE", copy: de });
    expect(steps[3]).toMatchObject({ skip: expect.stringMatching(/server-side/) });
    expect(steps[4]).toMatchObject({ skip: expect.stringMatching(/proposed no/) });
  });
  it("a run with a treatment brief still skips the experiment, saying why", () => {
    const steps = planAutopilot({ proposedCopy: copy, ppoTreatment: { hypothesis: "x" } }, "en-US");
    expect(steps.at(-1)).toMatchObject({ step: "experiment", skip: expect.stringMatching(/rendered screenshots/) });
  });
  it("no proposed copy means no metadata step, not an empty push", () => {
    expect(planAutopilot({}, "en-US").map((s) => s.step)).toEqual(["version", "screenshots", "experiment"]);
  });
});

describe("nextVersionString", () => {
  it("bumps the patch of the highest version, padding short strings", () => {
    expect(nextVersionString(["1.0.0", "1.0.1", "0.9.9"])).toBe("1.0.2");
    expect(nextVersionString(["2", "1.9.9"])).toBe("2.0.1");
    expect(nextVersionString(["1.2"])).toBe("1.2.1");
  });
  it("is null when nothing parses — never a made-up 1.0.0", () => {
    expect(nextVersionString([])).toBeNull();
    expect(nextVersionString(["beta"])).toBeNull();
  });
});

describe("shippedFrom", () => {
  it("is true only for a done metadata step", () => {
    expect(shippedFrom([{ step: "version", status: "done", detail: "" }, { step: "metadata", status: "done", detail: "" }])).toBe(true);
    expect(shippedFrom([{ step: "version", status: "done", detail: "" }, { step: "metadata", status: "failed", detail: "409" }])).toBe(false);
    expect(shippedFrom([{ step: "locale:de-DE", status: "done", detail: "" }])).toBe(false);
  });
});
