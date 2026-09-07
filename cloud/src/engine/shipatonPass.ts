/**
 * The Shipaton Pass (docs/gtm/founders-pass.md, "The Shipaton entrants"):
 * Startup, free, through the end of 2026, for anyone building a Shipaton app.
 * Self-serve — a code typed once in Settings › Plan — because the entrant pool
 * is hundreds of people and a named list does not scale to it.
 *
 * Pure decision. The route reads the account, calls this, and writes the tier;
 * nothing here touches storage. The dates are product facts and live here so
 * the landing copy, the settings copy, and the server agree on one source.
 *
 * What a claim never does: demote. An account already on Startup or Scale is
 * refused with a 409 rather than having its paid tier replaced by a free one.
 */
import type { Tier } from "../d1.js";
import { tierRank } from "../billing.js";

export const SHIPATON_PASS = {
  tier: "startup" as const satisfies Tier,
  /** the pass itself ends here; the cron demotes comped rows past this date. */
  validUntil: "2026-12-31T23:59:59.000Z",
  /** claims close with judging (Oct 1–13); the winners are announced Oct 21. */
  claimUntil: "2026-10-13T23:59:59.000Z",
  /** `users.status` for a claimed pass — `comped:` so nothing gates on it, and
   *  a suffix so claims can be counted apart from a named-list grant. */
  status: "comped:shipaton-2026",
} as const;

export type ClaimVerdict =
  | { ok: true; tier: Tier; until: string; status: string }
  | { ok: false; status: 400 | 409 | 410 | 503; reason: string };

function normalizeCode(code: string | undefined): string {
  return (code ?? "").toUpperCase().replace(/[\s-]+/g, "");
}

export function evaluateShipatonClaim(args: {
  code: string | undefined;
  expectedCode: string | undefined;
  currentTier: Tier;
  now: Date;
}): ClaimVerdict {
  const expected = normalizeCode(args.expectedCode);
  if (expected === "") {
    return { ok: false, status: 503, reason: "the Shipaton Pass is not open on this deploy" };
  }
  if (args.now.getTime() > Date.parse(SHIPATON_PASS.claimUntil)) {
    return {
      ok: false,
      status: 410,
      reason: `Shipaton Pass claims closed on ${SHIPATON_PASS.claimUntil.slice(0, 10)}`,
    };
  }
  if (normalizeCode(args.code) !== expected) {
    return { ok: false, status: 400, reason: "that code is not a Shipaton Pass" };
  }
  if (tierRank(args.currentTier) >= tierRank(SHIPATON_PASS.tier)) {
    return {
      ok: false,
      status: 409,
      reason: `your plan (${args.currentTier}) already covers everything the pass grants`,
    };
  }
  return { ok: true, tier: SHIPATON_PASS.tier, until: SHIPATON_PASS.validUntil, status: SHIPATON_PASS.status };
}

export function isShipatonPass(status: string | null | undefined): boolean {
  return status === SHIPATON_PASS.status;
}
