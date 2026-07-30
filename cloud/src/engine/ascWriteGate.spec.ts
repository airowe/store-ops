/**
 * #374: the single decision "may ShipASO write to this user's App Store listing
 * right now?".
 *
 * Extracted as a pure function on purpose. The existing ASC write routes
 * (`ascPushRoute`, `ascCreateVersionRoute`) inline their guards, and grepping
 * for `"approval required before"` finds it ONLY in index.ts — those checks have
 * no test coverage at all. A permission check nothing tests is a permission
 * check that can be quietly removed.
 *
 * Four independent conditions, each of which alone must block:
 *   1. the deployment flag       (operator kill switch)
 *   2. the tier                  (#405 — writes are a paid convenience)
 *   3. the user's own opt-in     (#405 — a purchase is not consent)
 *   4. an approved run           (approving is the terminus)
 */
import { describe, expect, it } from "vitest";
import { ascWriteGate, type AscWriteGateInput } from "./ascWriteGate.js";

const allow: AscWriteGateInput = {
  flagOn: true,
  tier: "startup",
  optedIn: true,
  runStatus: "approved",
};

describe("ascWriteGate", () => {
  it("allows only when every condition holds", () => {
    expect(ascWriteGate(allow)).toEqual({ allowed: true });
  });

  it("accepts a shipped run as well as an approved one", () => {
    expect(ascWriteGate({ ...allow, runStatus: "shipped" }).allowed).toBe(true);
  });

  // Each condition, alone, must block — no combination compensates for another.
  it.each([
    ["the deployment flag is off", { flagOn: false }, 403],
    ["the tier cannot write", { tier: "free" as const }, 402],
    ["the user has not opted in", { optedIn: false }, 403],
    ["the run is not approved", { runStatus: "awaiting_approval" }, 403],
    ["the run was rejected", { runStatus: "rejected" }, 403],
  ])("blocks when %s", (_label, override, status) => {
    const got = ascWriteGate({ ...allow, ...override } as AscWriteGateInput);
    expect(got.allowed).toBe(false);
    expect(got.allowed === false && got.status).toBe(status);
  });

  /**
   * 402 vs 403 is a product distinction, not cosmetic: a free user CAN unblock
   * themselves by upgrading (402, same as the existing app-limit gate), while a
   * user who has not opted in must make a choice, not a payment (403).
   */
  it("distinguishes 'upgrade to unlock' from 'you have not consented'", () => {
    const paywalled = ascWriteGate({ ...allow, tier: "free" });
    const notConsented = ascWriteGate({ ...allow, optedIn: false });
    expect(paywalled.allowed === false && paywalled.status).toBe(402);
    expect(notConsented.allowed === false && notConsented.status).toBe(403);
    // and the reasons must be distinguishable to a caller, not generic
    expect(paywalled.allowed === false && paywalled.reason).toMatch(/plan|upgrade/i);
    expect(notConsented.allowed === false && notConsented.reason).toMatch(/opt|settings|enable/i);
  });

  /**
   * Consent must not be inferable from payment. This is the whole reason the
   * two are separate columns (#405) — a paid user who never opted in is still
   * blocked, on every paid tier.
   */
  it("never lets a paid tier substitute for consent", () => {
    for (const tier of ["indie", "startup", "scale"] as const) {
      expect(ascWriteGate({ ...allow, tier, optedIn: false }).allowed, tier).toBe(false);
    }
  });

  it("never lets consent substitute for the deployment flag", () => {
    // The operator kill switch outranks everything, including an opted-in
    // paying user on an approved run.
    expect(ascWriteGate({ ...allow, flagOn: false }).allowed).toBe(false);
  });

  it("fails closed on an unknown run status", () => {
    expect(ascWriteGate({ ...allow, runStatus: "something_new" }).allowed).toBe(false);
  });
});
