/**
 * "May ShipASO write to this user's App Store listing right now?" — one pure
 * decision, so every write route asks the same question the same way (#374).
 *
 * Extracted rather than inlined because the existing ASC write routes
 * (`ascPushRoute`, `ascCreateVersionRoute`) inline their guards and NOTHING
 * tests them — `"approval required before"` appears only in index.ts, in no
 * spec. A permission check nothing tests is one that can be quietly removed.
 *
 * Four independent conditions. Each alone blocks; none compensates for another:
 *
 *   1. flagOn     the operator kill switch (ASC_WRITE_ENABLED)
 *   2. tier       writes are a paid convenience (#405, canAscWrite)
 *   3. optedIn    the user's OWN consent (#405, users.asc_write_opt_in)
 *   4. runStatus  approval is the terminus — never write on an undecided run
 *
 * Conditions 2 and 3 are deliberately separate: subscribing is a purchase
 * decision, not permission to mutate a live listing with a borrowed credential.
 */
import { canAscWrite } from "../billing.js";
import type { Tier } from "../d1.js";

export type AscWriteGateInput = {
  flagOn: boolean;
  tier: Tier;
  optedIn: boolean;
  /** The run's status; only an explicitly decided run may be pushed. */
  runStatus: string;
};

export type AscWriteGateResult =
  | { allowed: true }
  | { allowed: false; status: 402 | 403; reason: string };

/** Statuses that represent a user decision to proceed. */
const DECIDED = new Set(["approved", "shipped"]);

export function ascWriteGate(input: AscWriteGateInput): AscWriteGateResult {
  // The kill switch outranks everything, including an opted-in paying user on
  // an approved run — it exists so an operator can stop all outward writes.
  if (!input.flagOn) {
    return {
      allowed: false,
      status: 403,
      reason: "App Store Connect writes are not enabled on this deployment",
    };
  }

  // 402, matching the existing app-limit gate: this is a state the user can
  // resolve by upgrading, which is materially different from not consenting.
  if (!canAscWrite(input.tier)) {
    return {
      allowed: false,
      status: 402,
      reason: `your ${input.tier} plan does not include App Store Connect writes — upgrade to let ShipASO push for you`,
    };
  }

  // 403, not 402: this is not a paywall. The user has to make a choice, and no
  // amount of paying substitutes for it.
  if (!input.optedIn) {
    return {
      allowed: false,
      status: 403,
      reason:
        "you have not enabled App Store Connect writes — turn them on in settings to let ShipASO push for you",
    };
  }

  // Fails closed: anything not explicitly decided (awaiting_approval, rejected,
  // or a status added later) blocks.
  if (!DECIDED.has(input.runStatus)) {
    return { allowed: false, status: 403, reason: "approval required before writing" };
  }

  return { allowed: true };
}
