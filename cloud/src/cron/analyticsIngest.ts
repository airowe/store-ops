/**
 * Daily background ingest of Apple's Engagement analytics (analytics-reports
 * Phase 2 open question 2 — the deferred cadence). Piggybacks the existing
 * `0 8 * * *` daily cron (NO new Cloudflare trigger — the 5-trigger budget) via
 * handleDailySnapshot, so the persisted conversion series stays fresh without a
 * manual /analytics/ingest call.
 *
 * Gates (both required, both cheap):
 *   • ANALYTICS_ENABLED — the same opt-in switch that guards creating the request;
 *     unset → this pass is inert (the outward-write posture stays dark by default),
 *   • a STORED ASC key (#67) — background ingest can't prompt for a `.p8`, so it
 *     only covers apps whose owner opted into the encrypted saved key. Everyone
 *     else ingests on demand (the route), where the key rides in the request.
 *
 * Safe-degrade, per app: a missing key, a non-Admin key, a not-yet-ready report,
 * or any error is isolated — one bad app never aborts the run, and a failure
 * leaves that app's prior persisted data intact (upsert only runs on ok rows).
 * The `.p8` is decrypted for a single mint and never logged.
 */
import { listAllApps, upsertEngagementRows, upsertCommerceRows, upsertUsageRows, recordReportHeaders } from "../d1.js";
import { credentialsEnabled, useCredential } from "../credentialStore.js";
import { mintAscJwt } from "../engine/ascJwt.js";
import { findAscAppId, type FetchLike } from "../engine/ascWrite.js";
import { getAnalyticsStatus } from "../engine/ascAnalytics.js";
import { gunzipText, ingestEngagement, type Gunzip } from "../engine/analyticsEngagement.js";
import { ingestCommerce, type CommerceRow } from "../engine/analyticsCommerce.js";
import { ingestUsage, type UsageRow } from "../engine/analyticsUsage.js";
import { fetchForEnv } from "../fetchAdapter.js";
import type { Env } from "../index.js";

const flagOn = (v: string | undefined): boolean => v === "1" || v?.toLowerCase() === "true";

export type AnalyticsIngestReport = {
  /** false when ANALYTICS_ENABLED is unset (the pass is inert). */
  enabled: boolean;
  /** false when this deployment has no KEK (stored keys can't be decrypted). */
  storage: boolean;
  appsProcessed: number;
  /** apps that persisted fresh rows this run. */
  ingested: number;
  /** skipped — no stored ASC key (on-demand only). */
  skippedNoKey: number;
  /** skipped — key not Admin, no ongoing request, or Apple still generating. */
  skippedNotReady: number;
  perApp: Array<{ appId: string; bundleId: string; rows?: number; days?: number; skipped?: string; error?: string }>;
};

/**
 * Walk every app once; for each with a stored ASC key and a ready Engagement
 * report, ingest + persist. Deps (fetch/gunzip) are injectable for tests; they
 * default to the env's transport and the real gunzip.
 */
export async function runAnalyticsIngest(
  env: Env,
  deps: { fetchFn?: FetchLike; gunzip?: Gunzip } = {},
): Promise<AnalyticsIngestReport> {
  const report: AnalyticsIngestReport = {
    enabled: flagOn(env.ANALYTICS_ENABLED),
    storage: credentialsEnabled(env),
    appsProcessed: 0,
    ingested: 0,
    skippedNoKey: 0,
    skippedNotReady: 0,
    perApp: [],
  };
  // Inert unless enabled AND storage is configured (no KEK → no stored key to use).
  if (!report.enabled || !report.storage) return report;

  const fetchFn = deps.fetchFn ?? (fetchForEnv(env) as unknown as FetchLike);
  const gunzip = deps.gunzip ?? gunzipText;
  const apps = await listAllApps(env.DB);

  for (const app of apps) {
    report.appsProcessed++;
    try {
      const stored = await useCredential(env, app.user_id, app.id, "asc");
      if (!stored) {
        report.skippedNoKey++;
        report.perApp.push({ appId: app.id, bundleId: app.bundle_id, skipped: "no_key" });
        continue;
      }

      const token = await mintAscJwt({ p8: stored.plaintext, keyId: stored.meta.keyId, issuerId: stored.meta.issuerId });
      const ascAppId = await findAscAppId(fetchFn, token, app.bundle_id);

      const status = await getAnalyticsStatus(fetchFn, { token, appId: ascAppId });
      if (status.state !== "pending") {
        report.skippedNotReady++;
        report.perApp.push({ appId: app.id, bundleId: app.bundle_id, skipped: status.state });
        continue;
      }

      // ENGAGEMENT, COMMERCE, and APP_USAGE all ride the same ongoing request
      // (status.requestId). Each category is independently guarded here — a
      // not-ready/unavailable category never blocks the others; they are peers,
      // not a chain. Prior persisted data for a skipped category stays intact.
      let anyIngested = false;

      const engagement = await ingestEngagement(fetchFn, gunzip, { token, requestId: status.requestId });
      if (engagement.ok) {
        const rows = await upsertEngagementRows(env.DB, app.id, engagement.rows);
        const days = new Set(engagement.rows.map((r) => r.date)).size;
        report.perApp.push({ appId: app.id, bundleId: app.bundle_id, rows, days });
        anyIngested = true;
      }

      const commerce = await ingestCommerce(fetchFn, gunzip, { token, requestId: status.requestId });
      if (commerce.ok) {
        await upsertCommerceRows(env.DB, app.id, commerce.rows as CommerceRow[]);
        for (const h of commerce.headers) await recordReportHeaders(env.DB, { appId: app.id, category: "COMMERCE", header: h });
        anyIngested = true;
      }

      const usage = await ingestUsage(fetchFn, gunzip, { token, requestId: status.requestId });
      if (usage.ok) {
        await upsertUsageRows(env.DB, app.id, usage.rows as UsageRow[]);
        for (const h of usage.headers) await recordReportHeaders(env.DB, { appId: app.id, category: "APP_USAGE", header: h });
        anyIngested = true;
      }

      if (anyIngested) {
        report.ingested++;
      } else {
        report.skippedNotReady++;
        report.perApp.push({ appId: app.id, bundleId: app.bundle_id, skipped: "not_ready" });
      }
    } catch (e) {
      // Per-app isolation: one bad app never aborts the run; prior data is intact.
      report.perApp.push({ appId: app.id, bundleId: app.bundle_id, error: String(e) });
    }
  }
  return report;
}
