/**
 * The weekly autonomy loop — the product's core. Fired by the Cron Trigger
 * `0 9 * * 1` (Mon 09:00 UTC, set in wrangler.toml) via `scheduled()` in
 * src/index.ts.
 *
 * For EACH connected app:
 *   1. Build the agent input from the stored app row + the LAST competitor
 *      snapshot map (so the engine can diff this week vs last week).
 *   2. Run the full agent loop against LIVE iTunes data (audit, ranks,
 *      competitor watch, keyword reasoning, propose copy, prepare push commands).
 *   3. Append the rank + competitor snapshots from this pass (always — the
 *      time-series is the ground truth, recorded every week regardless of action).
 *   4. THRESHOLD CHECK — decide whether this week's data warrants human attention:
 *        • a targeted keyword is still unranked (rank === null), OR
 *        • a competitor's visible listing changed or a new competitor appeared.
 *      If so, open a NEW run in `awaiting_approval` (carrying the proposals +
 *      generated push commands) for the human to approve. If not, we still record
 *      the snapshots but DON'T nag the user with a run.
 *   5. NEVER push. The cron only PREPARES; the irreversible step stays gated
 *      behind the human approval in the API.
 *
 * Idempotency: if an app already has an open (`awaiting_approval`) run we record
 * fresh snapshots but skip opening a second run — the human clears the gate
 * first. D1 is the work queue; one scheduled() invocation walks every app.
 */
import {
  getLastSweepAt,
  getSchedule,
  getRankHistory,
  getTier,
  getUser,
  hasOpenRun,
  isAgentPaused,
  listAllApps,
  setLastSweepAt,
} from "../d1.js";
import { canRunCron } from "../billing.js";
import { type DigestAppInput, planDigests } from "../digest.js";
import { emailSenderForEnv } from "../emailSender.js";
import { mintUnsubToken, resolveSessionSecret } from "../auth.js";
import type { Env } from "../index.js";
import { isSweepDue } from "../schedule.js";
import { runKeyedSweepForApp, type KeyedSweepDetail } from "./keyedSweep.js";

/** Unsubscribe-token lifetime: ~60 days - a fresh token ships with every weekly digest. */
const UNSUB_TTL_SECONDS = 60 * 24 * 60 * 60;

// Re-exported for callers (and scheduled.spec.ts) that import the threshold
// decision logic from here — the logic itself now lives in keyedSweep.ts,
// shared by the cron and the webhook receiver.
export { evaluateThreshold, type ThresholdDecision } from "./keyedSweep.js";

export type CronReport = {
  appsProcessed: number;
  runsOpened: number;
  /** apps skipped because their owner's tier has no standing autonomy (free). */
  skippedTier: number;
  /** apps skipped because the owner explicitly paused the autonomous sweep (#51). */
  skippedPaused: number;
  /** #52: apps skipped because their schedule says this hour isn't their slot.
   *  Not listed in perApp (an hourly tick would flood it) — count only. */
  skippedNotDue: number;
  perApp: Array<{
    appId: string;
    bundleId: string;
    crossed: boolean;
    runId: string | null;
    skippedOpenRun: boolean;
    /** true when skipped: owner is on a tier without cron autonomy. */
    skippedTier?: boolean;
    /** true when skipped: owner paused the autonomous sweep (#51). No run, no digest. */
    skippedPaused?: boolean;
    reasons: string[];
    error?: string;
  }>;
};

/**
 * Walk every app once. Returns a report (also handy for tests / manual
 * invocation). Per-app failures are isolated — one bad app never aborts the
 * sweep.
 *
 * #52: `opts.enforceSchedule` (the hourly cron sets it) gates each app on its
 * stored schedule via isSweepDue — an app whose slot this isn't is counted in
 * skippedNotDue and left completely untouched. Without the flag (tests,
 * manual/admin invocation) every app sweeps, exactly as before.
 */
export async function runWeeklySweep(
  env: Env,
  opts: { enforceSchedule?: boolean; now?: Date } = {},
): Promise<CronReport> {
  const apps = await listAllApps(env.DB);
  const report: CronReport = { appsProcessed: 0, runsOpened: 0, skippedTier: 0, skippedPaused: 0, skippedNotDue: 0, perApp: [] };
  const now = opts.now ?? new Date();

  for (const app of apps) {
    // Schedule gate (#52) — BEFORE the processed counter and every read: an
    // off-slot app costs two cheap D1 lookups and nothing else.
    if (opts.enforceSchedule) {
      const schedule = await getSchedule(env.DB, app.id);
      const lastSweepAt = await getLastSweepAt(env.DB, app.id);
      if (!isSweepDue(schedule, now, lastSweepAt)) {
        report.skippedNotDue++;
        continue;
      }
    }
    report.appsProcessed++;
    try {
      // Tier gate: standing autonomy is a paid feature (indie/startup/scale). Free
      // apps are NOT swept — they run manually from the dashboard only.
      const tier = await getTier(env.DB, app.user_id);
      if (!canRunCron(tier)) {
        report.skippedTier++;
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          crossed: false,
          runId: null,
          skippedOpenRun: false,
          skippedTier: true,
          reasons: [`skipped — ${tier} tier has no scheduled autonomy`],
        });
        continue;
      }

      // Pause gate (#51): the owner explicitly stopped standing autonomy for this
      // target. Checked AFTER the tier gate (so a free user reads as skippedTier,
      // not skippedPaused) and BEFORE the agent runs — so a paused target collects
      // NO data: no run is opened, no `detected` snapshot is written, and because
      // sendWeeklyDigests skips skippedPaused entries, no digest is emailed.
      if (await isAgentPaused(env.DB, { userId: app.user_id, appId: app.id })) {
        report.skippedPaused++;
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          crossed: false,
          runId: null,
          skippedOpenRun: false,
          skippedPaused: true,
          reasons: ["skipped — agent paused by owner"],
        });
        continue;
      }

      // #67 Phase 2: AUTONOMOUS KEYED SWEEP. When the owner OPTED IN to storing
      // an ASC key for this app, the sweep runs the FULL read-and-improve pass
      // (real subtitle/keyword proposals, real findings) instead of the public
      // iTunes-only audit — the product's core loop finally running unattended.
      // Still approval-gated: this only PREPARES the run; nothing is pushed. A
      // stored-key read failure degrades to the public pass (never strands the
      // sweep). The stored key's plaintext is a transient here, never persisted
      // onto the run.
      let detail: KeyedSweepDetail | undefined;
      await runKeyedSweepForApp(env, app, {
        onDetail: (d) => {
          detail = d;
        },
      });
      if (!detail) {
        // runKeyedSweepForApp always invokes onDetail before returning — this
        // is unreachable in practice, but keeps the report shape sound if it
        // ever doesn't.
        throw new Error("runKeyedSweepForApp completed without reporting a detail");
      }

      if (detail.opened) {
        report.runsOpened++;
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          crossed: true,
          runId: detail.runId,
          skippedOpenRun: false,
          reasons: detail.decision.reasons,
        });
      } else {
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          crossed: detail.decision.crossed,
          runId: detail.runId,
          skippedOpenRun: detail.alreadyOpen && detail.decision.crossed,
          reasons: detail.decision.reasons,
        });
      }
      // #52: stamp the completed sweep — the due-check's min-gap reads this.
      // Best-effort (missing column during the deploy-order window → no-op).
      await setLastSweepAt(env.DB, app.id, now.toISOString());
    } catch (e) {
      report.perApp.push({
        appId: app.id,
        bundleId: app.bundle_id,
        crossed: false,
        runId: null,
        skippedOpenRun: false,
        reasons: [],
        error: String(e),
      });
    }
  }

  return report;
}

/**
 * After the sweep has persisted this week's snapshots, email the "what moved"
 * digest to every paid (indie/startup/scale) app's owner. Gating + composition is the pure
 * `planDigests`; here we just gather each app's inputs from D1 and send. Failures
 * are isolated per-message and never abort the run. Returns the count sent.
 */
export async function sendWeeklyDigests(env: Env, report: CronReport): Promise<number> {
  const dashboardUrl = env.DASHBOARD_ORIGIN ?? "https://app.shipaso.com";
  const apps = await listAllApps(env.DB);
  const byId = new Map(apps.map((a) => [a.id, a]));

  const inputs: DigestAppInput[] = [];
  // Unsubscribe minting setup (Phase 2). API_ORIGIN unset -> warn once, degrade.
  const unsubByEmail = new Map<string, string>();
  let unsubBase: { origin: string; secret: string } | null = null;
  if (env.API_ORIGIN) {
    try {
      unsubBase = {
        origin: env.API_ORIGIN.replace(/\/+$/, ""),
        secret: resolveSessionSecret(env.SESSION_SECRET, env.APP_ENV),
      };
    } catch (e) {
      console.warn(`[store-ops cron] unsubscribe links disabled: ${String(e)}`);
    }
  } else {
    console.warn(
      "[store-ops cron] API_ORIGIN unset - digests sent WITHOUT unsubscribe footer/headers",
    );
  }
  // One user row per OWNER, cached — tier, email, AND the digest pref all ride
  // the same row, and a multi-app owner appears once per app in the report.
  const userCache = new Map<string, Awaited<ReturnType<typeof getUser>>>();
  for (const entry of report.perApp) {
    // Pause suppresses the nag (#51): a paused target opened no run, so it must
    // not be emailed either. Skip before any reads.
    if (entry.skippedPaused) continue;
    const app = byId.get(entry.appId);
    if (!app) continue;
    let user = userCache.get(app.user_id);
    if (user === undefined) {
      user = await getUser(env.DB, app.user_id);
      userCache.set(app.user_id, user);
    }
    if (!user?.email) continue;
    const tier = user.tier;
    if (tier !== "indie" && tier !== "startup" && tier !== "scale") continue; // skip the gate early (saves the reads)
    // Preference gate (comms-prefs): 'off' silences the digest for EVERY app
    // this user owns — before the hasOpenRun/getRankHistory reads. The sweep
    // itself already ran; only the EMAIL is suppressed.
    if (user.email_digest === "off") continue;
    // Unsubscribe link (comms-prefs Phase 2): one token per UNIQUE email — a
    // multi-app owner's messages share it. Needs API_ORIGIN (the cron has no
    // request to derive an origin from); unset → no footer/headers (degrade).
    let unsubscribeUrl = unsubByEmail.get(user.email);
    if (unsubscribeUrl === undefined && unsubBase) {
      const token = await mintUnsubToken(unsubBase.secret, user.email, {
        ttlSeconds: UNSUB_TTL_SECONDS,
      });
      unsubscribeUrl = `${unsubBase.origin}/email/unsubscribe?token=${encodeURIComponent(token)}`;
      unsubByEmail.set(user.email, unsubscribeUrl);
    }
    inputs.push({
      ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
      appId: app.id,
      appName: app.name,
      email: user.email,
      tier,
      // Authoritative: is there an open run AT THE GATE right now? (Inferring from
      // the report's `crossed` over-reports — a crossed threshold whose run was
      // opened in a PRIOR week is a 'detected' snapshot, not a pending gate.)
      hasPendingApproval: await hasOpenRun(env.DB, app.id),
      rankHistory: await getRankHistory(env.DB, app.id),
    });
  }

  const messages = planDigests(inputs, { dashboardUrl });
  const sender = emailSenderForEnv(env);
  let sent = 0;
  for (const msg of messages) {
    try {
      await sender.send(msg);
      sent++;
    } catch (e) {
      console.error(`[store-ops cron] digest send failed for ${msg.to}: ${String(e)}`);
    }
  }
  return sent;
}

/** The scheduled() entry — runs the sweep, then sends the weekly digests. */
export async function handleScheduled(env: Env): Promise<void> {
  // #52: the cron fires HOURLY; each app sweeps only in its scheduled slot.
  const report = await runWeeklySweep(env, { enforceSchedule: true });
  const digests = await sendWeeklyDigests(env, report).catch((e) => {
    console.error(`[store-ops cron] digest pass failed: ${String(e)}`);
    return 0;
  });
  console.log(
    `[store-ops cron] swept ${report.appsProcessed} apps, opened ${report.runsOpened} run(s), ` +
      `sent ${digests} digest(s)`,
  );
}
