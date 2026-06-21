/**
 * The RLHF preference signal (#39 Part 2) is a PURE diff: per editable field it
 * pairs the agent's proposed value with the human-shipped final value and flags
 * whether the human actually changed it. Encryption + persistence happen later
 * (at the d1 layer); this module stays pure and carries the plaintext so it can
 * be unit-tested in the fast node env.
 *
 * Invariants pinned here:
 *   • one row per editable field the proposal actually carries (never invents a
 *     field the agent didn't propose),
 *   • edited = true only on a REAL change (case/space-only churn is NOT an edit —
 *     same norm as isNoOpProposal),
 *   • a 'rejected' decision STILL emits rows (a rejection is negative signal),
 *   • the carried values are the raw plaintext (no encryption here).
 */
import { describe, expect, it } from "vitest";
import { buildPreferenceRows, EDITABLE_FIELDS } from "./preferenceSignal.js";

const base = {
  name: "Heathen",
  subtitle: "Daily tarot & rituals",
  keywords: "tarot,occult,ritual",
  promo: "Read the cards.",
};

describe("buildPreferenceRows", () => {
  it("emits one row per editable field the proposal carries", () => {
    const rows = buildPreferenceRows({ proposed: base, final: base, decision: "approved" });
    expect(rows.map((r) => r.field).sort()).toEqual(["keywords", "name", "promo", "subtitle"]);
  });

  it("flags edited=true only on a real value change", () => {
    const final = { ...base, subtitle: "Tarot, rituals & moon phases" };
    const rows = buildPreferenceRows({ proposed: base, final, decision: "approved" });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.subtitle!.edited).toBe(true);
    expect(byField.subtitle!.proposed).toBe(base.subtitle);
    expect(byField.subtitle!.final).toBe(final.subtitle);
    expect(byField.name!.edited).toBe(false);
    expect(byField.keywords!.edited).toBe(false);
  });

  it.each([
    ["trailing/leading whitespace", "  Heathen  "],
    ["collapsed inner whitespace", "Heathen "],
    ["case-only change", "heathen"],
  ])("treats a %s change as NOT edited (isNoOpProposal norm)", (_label, name) => {
    const rows = buildPreferenceRows({ proposed: base, final: { ...base, name }, decision: "approved" });
    const nameRow = rows.find((r) => r.field === "name");
    expect(nameRow?.edited).toBe(false);
    // the plaintext carried is the ACTUAL final value (we still want the real text)
    expect(nameRow?.final).toBe(name);
  });

  it("still emits rows when the decision is 'rejected' (negative signal)", () => {
    const rows = buildPreferenceRows({ proposed: base, final: base, decision: "rejected" });
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.decision === "rejected")).toBe(true);
  });

  it("does NOT invent a field the agent never proposed", () => {
    const proposed = { name: "Heathen", subtitle: "Tarot", keywords: "tarot" };
    const rows = buildPreferenceRows({ proposed, final: proposed, decision: "approved" });
    expect(rows.map((r) => r.field).sort()).toEqual(["keywords", "name", "subtitle"]);
    expect(rows.find((r) => r.field === "promo")).toBeUndefined();
  });

  it("captures all editable fields including description + whatsNew when present", () => {
    const proposed = {
      ...base,
      description: "A long body.",
      whatsNew: "Bug fixes.",
    };
    const final = { ...proposed, whatsNew: "New tarot spreads." };
    const rows = buildPreferenceRows({ proposed, final, decision: "approved" });
    expect(rows.map((r) => r.field).sort()).toEqual(EDITABLE_FIELDS.slice().sort());
    expect(rows.find((r) => r.field === "whatsNew")?.edited).toBe(true);
  });

  it("missing field on final side (undefined) is treated as empty and not edited when proposed empty", () => {
    const proposed = { name: "Heathen", subtitle: "Tarot", keywords: "tarot", promo: "" };
    const final = { name: "Heathen", subtitle: "Tarot", keywords: "tarot" };
    const rows = buildPreferenceRows({ proposed, final, decision: "approved" });
    const promo = rows.find((r) => r.field === "promo");
    expect(promo?.edited).toBe(false);
    expect(promo?.final).toBe("");
  });
});
