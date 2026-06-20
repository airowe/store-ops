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
  getLatestCompetitorMap,
  getRankHistory,
  getTier,
  getUser,
  hasOpenRun,
  listAllApps,
  persistRun,
} from "../d1.js";
import { canRunCron } from "../billing.js";
import { type DigestAppInput, planDigests } from "../digest.js";
import { emailSenderForEnv } from "../emailSender.js";
import { buildAppInput } from "../api/runConfig.js";
import { reasonerForEnv } from "../api/aiReasoner.js";
import { fetchForEnv } from "../fetchAdapter.js";
import type { Env } from "../index.js";

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
  /** apps skipped because their owner's tier has no standing autonomy (free/launch). */
  skippedTier: number;
  perApp: Array<{
    appId: string;
    bundleId: string;
    crossed: boolean;
    runId: string | null;
    skippedOpenRun: boolean;
    /** true when skipped: owner is on a tier without cron autonomy. */
    skippedTier?: boolean;
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
  const report: CronReport = { appsProcessed: 0, runsOpened: 0, skippedTier: 0, perApp: [] };

  for (const app of apps) {
    report.appsProcessed++;
    try {
      // Tier gate: standing autonomy is an autopilot/fleet feature. Free + launch
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

      const previous = await getLatestCompetitorMap(env.DB, app.id);
      const cronReasoner = reasonerForEnv(env.AI);
      const input = await buildAppInput(app, cronReasoner ? { reasoner: cronReasoner } : {}, previous);
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
 * digest to every autopilot/fleet app's owner. Gating + composition is the pure
 * `planDigests`; here we just gather each app's inputs from D1 and send. Failures
 * are isolated per-message and never abort the run. Returns the count sent.
 */
export async function sendWeeklyDigests(env: Env, report: CronReport): Promise<number> {
  const dashboardUrl = env.DASHBOARD_ORIGIN ?? "https://app.shipaso.com";
  const apps = await listAllApps(env.DB);
  const byId = new Map(apps.map((a) => [a.id, a]));

  const inputs: DigestAppInput[] = [];
  for (const entry of report.perApp) {
    const app = byId.get(entry.appId);
    if (!app) continue;
    const tier = await getTier(env.DB, app.user_id);
    if (tier !== "autopilot" && tier !== "fleet") continue; // skip the gate early (saves the reads)
    const user = await getUser(env.DB, app.user_id);
    if (!user?.email) continue;
    inputs.push({
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
