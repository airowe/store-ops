/**
 * The DAILY rank-snapshot loop (issue #94). Fired by the Cron Trigger
 * `0 8 * * *` (daily 08:00 UTC, set in wrangler.toml) via `scheduled()` in
 * src/index.ts, which branches on `event.cron` to call THIS instead of the
 * weekly sweep.
 *
 * This is deliberately the LIGHTWEIGHT cousin of runWeeklySweep:
 *   • It runs ONLY the rank check (engine `ranksFor`) for each eligible app, then
 *     appends a dated `rank_snapshots` row per keyword (via persistRankSnapshots).
 *   • It NEVER runs the full agent, NEVER computes proposals, NEVER evaluates the
 *     re-draft threshold, and NEVER opens an `awaiting_approval` run. The
 *     autonomous DRAFT cadence stays weekly/threshold-governed (the non-goal in
 *     the PRD: daily snapshots must not over-trigger drafts).
 *   • It NEVER pushes — nothing here can reach a store; the human gate is untouched.
 *
 * Eligibility (same gates as the weekly sweep, in the same precedence order):
 *   1. Tier gate — only cron-autonomy tiers (autopilot/fleet) are swept at all.
 *   2. Cadence gate — only owners who set rank_cadence='daily' get a DAILY snapshot
 *      (weekly-cadence apps are already snapshotted by the Monday sweep).
 *   3. Pause gate (#51) — a paused owner collects NO data, here too.
 *
 * Per-app failures are isolated: one bad app never aborts the daily run. We reuse
 * `buildAppInput` so the daily snapshot ranks the EXACT same keyword set the
 * weekly sweep would — the time-series stays apples-to-apples.
 */
import { ranksFor } from "../engine/index.js";
import {
  getRankCadence,
  getTier,
  isAgentPaused,
  listAllApps,
  persistRankSnapshots,
} from "../d1.js";
import { canRunCron } from "../billing.js";
import { runAnalyticsIngest } from "./analyticsIngest.js";
import { buildAppInput } from "../api/runConfig.js";
import { reasonerForEnv } from "../api/aiReasoner.js";
import { fetchForEnv } from "../fetchAdapter.js";
import type { Env } from "../index.js";

export type SnapshotReport = {
  appsProcessed: number;
  /** apps that actually got a dated rank snapshot this run. */
  snapshotsTaken: number;
  /** skipped — owner's tier has no scheduled autonomy (free/launch). */
  skippedTier: number;
  /** skipped — owner is on 'weekly' cadence (snapshotted by the Monday sweep instead). */
  skippedCadence: number;
  /** skipped — owner paused standing autonomy (#51). */
  skippedPaused: number;
  perApp: Array<{
    appId: string;
    bundleId: string;
    snapshotted: boolean;
    keywords: number;
    skippedTier?: boolean;
    skippedCadence?: boolean;
    skippedPaused?: boolean;
    error?: string;
  }>;
};

/**
 * Walk every app once and snapshot ranks for the daily-cadence, un-paused,
 * autonomy-tier ones. Returns a report (handy for tests / manual invocation).
 */
export async function runDailySnapshot(env: Env): Promise<SnapshotReport> {
  const apps = await listAllApps(env.DB);
  const report: SnapshotReport = {
    appsProcessed: 0,
    snapshotsTaken: 0,
    skippedTier: 0,
    skippedCadence: 0,
    skippedPaused: 0,
    perApp: [],
  };

  const fetchFn = fetchForEnv(env);
  const reasoner = reasonerForEnv(env.AI);

  for (const app of apps) {
    report.appsProcessed++;
    try {
      // 1) Tier gate — standing autonomy only. (Free/launch never get a snapshot.)
      const tier = await getTier(env.DB, app.user_id);
      if (!canRunCron(tier)) {
        report.skippedTier++;
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          snapshotted: false,
          keywords: 0,
          skippedTier: true,
        });
        continue;
      }

      // 2) Cadence gate — only owners who OPTED INTO daily get a daily snapshot.
      //    Weekly-cadence apps are recorded by the Monday sweep, not here.
      const cadence = await getRankCadence(env.DB, app.user_id);
      if (cadence !== "daily") {
        report.skippedCadence++;
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          snapshotted: false,
          keywords: 0,
          skippedCadence: true,
        });
        continue;
      }

      // 3) Pause gate (#51) — a paused owner collects NO data.
      if (await isAgentPaused(env.DB, { userId: app.user_id, appId: app.id })) {
        report.skippedPaused++;
        report.perApp.push({
          appId: app.id,
          bundleId: app.bundle_id,
          snapshotted: false,
          keywords: 0,
          skippedPaused: true,
        });
        continue;
      }

      // Reuse the weekly targeting so the daily series ranks the SAME keyword set.
      // (No competitor diff / no proposals — snapshot-only.)
      const input = await buildAppInput(app, reasoner ? { reasoner } : {});
      const keywords = input.keywords.map((k) => k.keyword);
      const ranks =
        keywords.length > 0
          ? await ranksFor(fetchFn, app.bundle_id, keywords, { country: app.country })
          : [];

      // Persist the REAL ranks (honest null when unranked; errored fetches skipped).
      await persistRankSnapshots(env.DB, { appId: app.id, ranks });

      report.snapshotsTaken++;
      report.perApp.push({
        appId: app.id,
        bundleId: app.bundle_id,
        snapshotted: true,
        keywords: keywords.length,
      });
    } catch (e) {
      report.perApp.push({
        appId: app.id,
        bundleId: app.bundle_id,
        snapshotted: false,
        keywords: 0,
        error: String(e),
      });
    }
  }

  return report;
}

/** The scheduled() entry for the daily cron — runs the snapshot pass + logs, then
 *  (analytics-reports Phase 2 open-Q2) the background Engagement ingest. The
 *  ingest is inert unless ANALYTICS_ENABLED + a stored key exist, and its failures
 *  are self-contained — it never affects the rank snapshot above. */
export async function handleDailySnapshot(env: Env): Promise<void> {
  const report = await runDailySnapshot(env);
  console.log(
    `[store-ops cron] daily snapshot: ${report.snapshotsTaken}/${report.appsProcessed} apps ` +
      `(skipped tier ${report.skippedTier}, weekly ${report.skippedCadence}, paused ${report.skippedPaused})`,
  );

  try {
    const ingest = await runAnalyticsIngest(env);
    if (ingest.enabled) {
      console.log(
        `[store-ops cron] analytics ingest: ${ingest.ingested}/${ingest.appsProcessed} apps ` +
          `(no key ${ingest.skippedNoKey}, not ready ${ingest.skippedNotReady})`,
      );
    }
  } catch (e) {
    // The analytics ingest must never break the daily snapshot cron.
    console.error(`[store-ops cron] analytics ingest failed: ${String(e)}`);
  }
}
