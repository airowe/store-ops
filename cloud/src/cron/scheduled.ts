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
  getLastSweepAt,
  getLatestRanks,
  getSchedule,
  getThresholds,
  getRankHistory,
  getTier,
  getUser,
  hasOpenRun,
  isAgentPaused,
  listAllApps,
  persistRun,
  setLastSweepAt,
} from "../d1.js";
import { canRunCron } from "../billing.js";
import { type DigestAppInput, planDigests } from "../digest.js";
import { emailSenderForEnv } from "../emailSender.js";
import { mintUnsubToken, resolveSessionSecret } from "../auth.js";
import { buildAppInput } from "../api/runConfig.js";
import { keyedAscPass } from "../api/index.js";
import { mintAscJwt } from "../engine/ascJwt.js";
import { credentialsEnabled, useCredential } from "../credentialStore.js";
import { reasonerForEnv } from "../api/aiReasoner.js";
import { fetchForEnv } from "../fetchAdapter.js";
import { notifyRunAwaitingApproval } from "../push.js";
import type { Env } from "../index.js";
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from "../thresholds.js";
import { isSweepDue } from "../schedule.js";

/** Unsubscribe-token lifetime: ~60 days - a fresh token ships with every weekly digest. */
const UNSUB_TTL_SECONDS = 60 * 24 * 60 * 60;

/** Result of evaluating whether this week's data crosses the re-draft threshold. */
export type ThresholdDecision = {
  crossed: boolean;
  reasons: string[];
};

/**
 * Decide if the agent result warrants opening an awaiting_approval run.
 * Pure (testable). Default config = the historical behavior: unranked target
 * keyword OR competitor movement. #53 makes each trigger configurable, adds an
 * optional week-over-week rank-drop trigger, and lets specific keywords /
 * competitors be muted. Thresholds gate what OPENS A RUN — never what the
 * agent measures.
 */
export function evaluateThreshold(
  result: AgentResult,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
  previousRanks: Array<{ keyword: string; rank: number | null }> = [],
): ThresholdDecision {
  const reasons: string[] = [];
  const mutedKw = new Set(config.mutedKeywords);
  const mutedComp = new Set(config.mutedCompetitors);
  const kwMuted = (kw: string) => mutedKw.has(kw.trim().toLowerCase());

  // (a) any TARGETED keyword still unranked (not in top 200)
  if (config.unranked) {
    const unranked = result.ranks.filter(
      (r) => r.error === "" && r.rank === null && !kwMuted(r.keyword),
    );
    if (unranked.length > 0) {
      reasons.push(
        `${unranked.length} targeted keyword(s) unranked: ${unranked
          .map((r) => r.keyword)
          .join(", ")}`,
      );
    }
  }

  // (a2) #53: rank DROPPED ≥ N places week-over-week (off unless configured).
  // A keyword that fell out of the top 200 entirely (prev ranked → now null)
  // counts as crossing any drop threshold.
  if (config.rankDropAtLeast != null) {
    const prevByKw = new Map(
      previousRanks.map((p) => [p.keyword.trim().toLowerCase(), p.rank] as const),
    );
    for (const r of result.ranks) {
      if (r.error !== "" || kwMuted(r.keyword)) continue;
      const prev = prevByKw.get(r.keyword.trim().toLowerCase());
      if (prev == null) continue; // no baseline — a drop can't be asserted
      if (r.rank === null) {
        reasons.push(`"${r.keyword}" dropped out of the top ${r.limit ?? 200} (was #${prev})`);
      } else if (r.rank - prev >= config.rankDropAtLeast) {
        reasons.push(`"${r.keyword}" dropped ${r.rank - prev} places (#${prev} → #${r.rank})`);
      }
    }
  }

  // (b) competitor movement — a new competitor or a changed visible listing
  if (config.competitorChanges) {
    for (const c of result.competitors.changes) {
      const muted =
        mutedComp.has(String(c.key).trim().toLowerCase()) ||
        ("name" in c && c.name ? mutedComp.has(c.name.trim().toLowerCase()) : false);
      if (muted) continue;
      if (c.status === "new") {
        reasons.push(`new competitor surfaced: ${c.name || c.key}`);
      } else if (c.status === "changed") {
        const fields = Object.keys(c.fields).join(", ");
        reasons.push(`competitor "${c.name || c.key}" changed (${fields})`);
      }
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
      const previous = await getLatestCompetitorMap(env.DB, app.id);
      const cronReasoner = reasonerForEnv(env.AI);
      const confirmed = await confirmedCompetitorKeys(env.DB, app.id);
      const storedAsc = credentialsEnabled(env)
        ? await useCredential(env, app.user_id, app.id, "asc")
        : null;
      let passed: { result: AgentResult; resultWithSnapshot: AgentResult } | null = null;
      if (storedAsc) {
        try {
          const token = await mintAscJwt({
            p8: storedAsc.plaintext,
            keyId: storedAsc.meta.keyId,
            issuerId: storedAsc.meta.issuerId,
          });
          passed = await keyedAscPass(env, app, token, "en-US", {
            ...(confirmed.length ? { competitors: confirmed } : {}),
          });
        } catch {
          passed = null; // stored-key read failed → fall back to the public pass
        }
      }
      const keyed = passed !== null;
      if (!passed) {
        const input = await buildAppInput(
          app,
          {
            ...(cronReasoner ? { reasoner: cronReasoner } : {}),
            ...(confirmed.length ? { competitors: confirmed } : {}),
          },
          previous,
        );
        const r = await runAgent(fetchForEnv(env), input);
        passed = { result: r, resultWithSnapshot: r };
      }
      const result = passed.result;
      const resultWithSnapshot = passed.resultWithSnapshot;

      // #53: per-app threshold config (fail-open → historical behavior) + last
      // week's ranks (read BEFORE this pass persists) for the drop trigger.
      const thresholds = await getThresholds(env.DB, app.id);
      const previousRanks =
        thresholds.rankDropAtLeast != null ? await getLatestRanks(env.DB, app.id) : [];
      const decision = evaluateThreshold(result, thresholds, previousRanks);
      const alreadyOpen = await hasOpenRun(env.DB, app.id);
      const openRun = decision.crossed && !alreadyOpen && !thresholds.notifyOnly;

      if (openRun) {
        // Open an awaiting_approval run (this also records the snapshots +
        // proposals + generated push commands in one atomic write).
        const runId = await persistRun(env.DB, {
          appId: app.id,
          status: "awaiting_approval",
          result: resultWithSnapshot,
          trigger: {
            source: "cron",
            reasons: keyed ? [...decision.reasons, "read via your saved App Store Connect key"] : decision.reasons,
          },
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
        // No threshold crossed (or a run is already open, or the owner set
        // notify-only #53): still persist this week's snapshots as a recorded
        // pass, but mark the run rejected-equivalent status 'detected' so the
        // time-series stays complete without nagging.
        const runId = await persistRun(env.DB, {
          appId: app.id,
          status: "detected",
          result: resultWithSnapshot,
          trigger: {
            source: "cron",
            reasons: alreadyOpen
              ? ["snapshot recorded — prior run still awaiting approval"]
              : decision.crossed && thresholds.notifyOnly
                ? [...decision.reasons, "notify-only mode — threshold crossed but no run opened (owner setting)"]
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
