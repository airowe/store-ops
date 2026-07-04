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
import { type AgentResult, runAgent } from "../engine/index.js";
import {
  confirmedCompetitorKeys,
  getLatestCompetitorMap,
  getRankHistory,
  getTier,
  getUser,
  hasOpenRun,
  isAgentPaused,
  listAllApps,
  persistRun,
} from "../d1.js";
import { canRunCron } from "../billing.js";
import { type DigestAppInput, planDigests } from "../digest.js";
import { emailSenderForEnv } from "../emailSender.js";
import { mintUnsubToken, resolveSessionSecret } from "../auth.js";
import { buildAppInput } from "../api/runConfig.js";
import { reasonerForEnv } from "../api/aiReasoner.js";
import { fetchForEnv } from "../fetchAdapter.js";
import { notifyRunAwaitingApproval } from "../push.js";
import type { Env } from "../index.js";

/** Unsubscribe-token lifetime: ~60 days - a fresh token ships with every weekly digest. */
const UNSUB_TTL_SECONDS = 60 * 24 * 60 * 60;

/** Result of evaluating whether this week's data crosses the re-draft threshold. */
export type ThresholdDecision = {
  crossed: boolean;
  reasons: string[];
};

/**
 * Decide if the agent result warrants opening an awaiting_approval run.
 * Pure (testable): unranked target keyword OR competitor movement.
 */
export function evaluateThreshold(result: AgentResult): ThresholdDecision {
  const reasons: string[] = [];

  // (a) any TARGETED keyword still unranked (not in top 200)
  const unranked = result.ranks.filter((r) => r.error === "" && r.rank === null);
  if (unranked.length > 0) {
    reasons.push(
      `${unranked.length} targeted keyword(s) unranked: ${unranked
        .map((r) => r.keyword)
        .join(", ")}`,
    );
  }

  // (b) competitor movement — a new competitor or a changed visible listing
  for (const c of result.competitors.changes) {
    if (c.status === "new") {
      reasons.push(`new competitor surfaced: ${c.name || c.key}`);
    } else if (c.status === "changed") {
      const fields = Object.keys(c.fields).join(", ");
      reasons.push(`competitor "${c.name || c.key}" changed (${fields})`);
    }
  }

  return { crossed: reasons.length > 0, reasons };
}

export type CronReport = {
  appsProcessed: number;
  runsOpened: number;
  /** apps skipped because their owner's tier has no standing autonomy (free). */
  skippedTier: number;
  /** apps skipped because the owner explicitly paused the autonomous sweep (#51). */
  skippedPaused: number;
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
 * weekly sweep.
 */
export async function runWeeklySweep(env: Env): Promise<CronReport> {
  const apps = await listAllApps(env.DB);
  const report: CronReport = { appsProcessed: 0, runsOpened: 0, skippedTier: 0, skippedPaused: 0, perApp: [] };

  for (const app of apps) {
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

      const previous = await getLatestCompetitorMap(env.DB, app.id);
      const cronReasoner = reasonerForEnv(env.AI);
      // #72: the sweep watches the app's CONFIRMED competitors — before this,
      // the "watched competitors" step always ran on an empty list.
      const confirmed = await confirmedCompetitorKeys(env.DB, app.id);
      const input = await buildAppInput(
        app,
        {
          ...(cronReasoner ? { reasoner: cronReasoner } : {}),
          ...(confirmed.length ? { competitors: confirmed } : {}),
        },
        previous,
      );
      const result = await runAgent(fetchForEnv(env), input);

      const decision = evaluateThreshold(result);
      const alreadyOpen = await hasOpenRun(env.DB, app.id);

      if (decision.crossed && !alreadyOpen) {
        // Open an awaiting_approval run (this also records the snapshots +
        // proposals + generated push commands in one atomic write).
        const runId = await persistRun(env.DB, {
          appId: app.id,
          status: "awaiting_approval",
          result,
          trigger: { source: "cron", reasons: decision.reasons },
        });
        report.runsOpened++;
        // Notify the owner on their phone — the whole point of push: a run opened
        // while they were away. Best-effort (no tokens / blocked egress → no-op);
        // a notification failure never affects the recorded run.
        await notifyRunAwaitingApproval(globalThis.fetch, env.DB, app, runId);
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          crossed: true,
          runId,
          skippedOpenRun: false,
          reasons: decision.reasons,
        });
      } else {
        // No threshold crossed (or a run is already open): still persist this
        // week's snapshots as a recorded pass, but mark the run rejected-equivalent
        // status 'detected' so the time-series stays complete without nagging.
        const runId = await persistRun(env.DB, {
          appId: app.id,
          status: "detected",
          result,
          trigger: {
            source: "cron",
            reasons: alreadyOpen
              ? ["snapshot recorded — prior run still awaiting approval"]
              : ["snapshot recorded — no threshold crossed"],
          },
        });
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          crossed: decision.crossed,
          runId,
          skippedOpenRun: alreadyOpen && decision.crossed,
          reasons: decision.reasons,
        });
      }
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
  const report = await runWeeklySweep(env);
  const digests = await sendWeeklyDigests(env, report).catch((e) => {
    console.error(`[store-ops cron] digest pass failed: ${String(e)}`);
    return 0;
  });
  console.log(
    `[store-ops cron] swept ${report.appsProcessed} apps, opened ${report.runsOpened} run(s), ` +
      `sent ${digests} digest(s)`,
  );
}
