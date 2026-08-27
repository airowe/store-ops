/**
 * Spend bounds on the agent-drivable write tools.
 *
 * The WebMCP surface lets a visitor's browser agent trigger runs and set a
 * sweep cadence. Both spend real money on OUR inference key: a run reasons with
 * the Anthropic client, and cadence decides how often that recurs. A human
 * clicking "run" a few times is the product; an agent in a retry loop is a bill.
 *
 * WHAT THESE ARE NOT — and this matters as much as what they are. They are
 * DAMPERS, not spend caps, exactly as publicReportGuard says of its limiter.
 * They bound the obvious runaway; they do not account for money and must never
 * be described as if they did. The cache and the per-app sweep schedule are what
 * actually bound recurring cost.
 *
 * PURE over already-counted inputs: the caller owns the counting (a D1 read),
 * this owns the policy. That keeps the rules exhaustively testable and keeps a
 * cost decision out of a query.
 */
import type { Tier } from "../d1.js";
import type { SweepCadence } from "../schedule.js";

export type BoundVerdict =
  | { ok: true }
  | { ok: false; error: string; retryAfterSeconds?: number };

/** The window agent-triggered runs are counted over. */
export const RUN_TRIGGER_WINDOW_SECONDS = 60 * 60;

/**
 * Agent-triggered runs allowed per hour, per user.
 *
 * Generous relative to honest use — a person auditing a few apps in one sitting
 * never approaches these — and small enough that a loop stops before it costs
 * real money. Scaled by tier because a Scale user genuinely operates 50 apps.
 */
const RUN_TRIGGERS_PER_WINDOW: Record<Tier, number> = {
  free: 3,
  indie: 10,
  startup: 25,
  scale: 60,
};

/**
 * Apps a user may put on the DAILY sweep.
 *
 * Daily is the cadence that multiplies recurring inference cost — seven times
 * weekly, per app, forever. Weekly and biweekly are unbounded here because the
 * per-app schedule already bounds them.
 */
const DAILY_APPS_ALLOWED: Record<Tier, number> = {
  free: 1,
  indie: 3,
  startup: 10,
  scale: 25,
};

/**
 * May this user trigger another run right now?
 *
 * `runsInWindow` is how many agent-triggered runs they have already started in
 * the last RUN_TRIGGER_WINDOW_SECONDS.
 */
export function checkRunTriggerBound(args: {
  runsInWindow: number;
  tier: Tier;
}): BoundVerdict {
  // An unrecognized tier falls back to the MOST restrictive allowance rather
  // than throwing or waving it through: a bound that fails open on bad input
  // is not a bound.
  const allowed = RUN_TRIGGERS_PER_WINDOW[args.tier] ?? RUN_TRIGGERS_PER_WINDOW.free;
  if (args.runsInWindow < allowed) return { ok: true };
  return {
    ok: false,
    error:
      `That's ${args.runsInWindow} runs in the last hour, which is the limit for this plan. ` +
      `Runs cost real analysis time, so they're rate-limited. Your existing runs are untouched — ` +
      `try again shortly, or review what's already waiting at your approval gate.`,
    retryAfterSeconds: RUN_TRIGGER_WINDOW_SECONDS,
  };
}

/**
 * May this user set this app to this cadence?
 *
 * `dailyAppCount` is how many of their OTHER apps are already daily — the app
 * being changed is excluded by the caller, so re-setting an already-daily app to
 * daily is always allowed and never self-blocks.
 */
export function checkDailyCadenceBound(args: {
  cadence: SweepCadence;
  dailyAppCount: number;
  tier: Tier;
}): BoundVerdict {
  if (args.cadence !== "daily") return { ok: true };
  const allowed = DAILY_APPS_ALLOWED[args.tier] ?? DAILY_APPS_ALLOWED.free;
  if (args.dailyAppCount < allowed) return { ok: true };
  return {
    ok: false,
    error:
      `Daily checks are limited to ${allowed} app${allowed === 1 ? "" : "s"} on this plan ` +
      `(you have ${args.dailyAppCount}). Daily runs the agent seven times a week per app, ` +
      `which is why it's capped. Weekly and biweekly are unlimited.`,
  };
}
