/**
 * Wire the run_ready notification to a real environment.
 *
 * Kept apart from `notifyRunReady` so the gating policy stays pure and
 * testable: this module owns the env-shaped concerns (which transports are
 * configured, where the dashboard lives, how an unsubscribe token is minted)
 * and nothing else.
 */
import type { Env } from "../index.js";
import { emailSenderForEnv } from "../emailSender.js";
import { mintUnsubToken } from "../auth.js";
import { resolveSessionSecret } from "../auth.js";
import {
  deliverableDestinations,
  getNotificationPrefs,
  markChannelDelivery,
} from "../d1.js";
import type { CopyFields } from "../engine/optimize.js";
import { emailDeliverer } from "./emailDeliverer.js";
import { notifyRunReady, type NotifyRunReadyResult } from "./notifyRunReady.js";
import type { Deliverer } from "./channel.js";

/** Matches the digest's unsubscribe token lifetime (~60 days). */
const UNSUB_TTL_SECONDS = 60 * 24 * 60 * 60;

/**
 * Which fields this run actually proposes a CHANGE for.
 *
 * MEASURED, not assumed (CLAUDE.md: measured-or-nothing). A field is counted
 * only when there is a proposed value AND it differs from what is live. A run
 * that re-proposes the current subtitle verbatim has changed nothing, and
 * saying otherwise would inflate every notification we send.
 */
export function changedFields(
  proposed: Partial<CopyFields> | undefined,
  current: Partial<CopyFields> | undefined,
): string[] {
  if (!proposed) return [];
  const fields = ["name", "subtitle", "keywords", "promo", "description"] as const;
  return fields.filter((f) => {
    const p = proposed[f];
    if (typeof p !== "string" || p.length === 0) return false;
    const c = current?.[f];
    return typeof c === "string" ? p.trim() !== c.trim() : true;
  });
}

/** The transports this environment can actually deliver on. */
function deliverersForEnv(env: Env): Deliverer[] {
  let unsubFor: ((address: string) => Promise<string | undefined>) | undefined;
  if (env.API_ORIGIN) {
    const origin = env.API_ORIGIN.replace(/\/+$/, "");
    unsubFor = async (address: string) => {
      try {
        const token = await mintUnsubToken(
          resolveSessionSecret(env.SESSION_SECRET, env.APP_ENV),
          address,
          { ttlSeconds: UNSUB_TTL_SECONDS },
        );
        return `${origin}/email/unsubscribe?token=${encodeURIComponent(token)}`;
      } catch {
        // Degrade exactly as the digest does: send WITHOUT the footer rather
        // than dropping the message.
        return undefined;
      }
    };
  }
  return [emailDeliverer(emailSenderForEnv(env), unsubFor)];
}

/**
 * Fire the run_ready notification for a run that just landed.
 *
 * Call this wherever a run is persisted; it decides for itself whether the
 * status warrants speaking. Never throws — a notification must never cost a
 * user the run it is about.
 */
export async function notifyRunReadyForEnv(
  env: Env,
  args: {
    userId: string;
    appName: string;
    runId: string;
    status: string;
    proposed?: Partial<CopyFields> | undefined;
    current?: Partial<CopyFields> | undefined;
  },
): Promise<NotifyRunReadyResult> {
  return notifyRunReady({
    userId: args.userId,
    appName: args.appName,
    runId: args.runId,
    status: args.status,
    changedFields: changedFields(args.proposed, args.current),
    dashboardUrl: env.DASHBOARD_ORIGIN ?? "https://app.shipaso.com",
    wantsRunReady: async (userId) => (await getNotificationPrefs(env.DB, userId)).email_run_ready,
    destinationsFor: (userId) => deliverableDestinations(env.DB, userId),
    deliverers: deliverersForEnv(env),
    record: (r) =>
      markChannelDelivery(env.DB, {
        userId: args.userId,
        channel: r.channel,
        address: r.address,
        result: r.ok ? { ok: true } : { ok: false, error: r.error },
      }),
  });
}
