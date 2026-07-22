/**
 * APP_USAGE Analytics adapter. Category "APP_USAGE". The App Crashes columns
 * (Crashes, Unique Devices, App Version, Device) are VERIFIED against a real
 * instance; session/install columns are best-effort and reconcile via captured
 * headers. Every metric optional — absent → omitted, never a fake 0.
 */
import { type ColumnMap, type ReportIngestResult, ingestReport, parseReportRows } from "./analyticsReportIngest.js";
import type { Gunzip } from "./analyticsEngagement.js";
import type { FetchLike } from "./ascWrite.js";

export const USAGE_CATEGORY = "APP_USAGE";

export type UsageRow = {
  date: string;
  appVersion?: string;
  device?: string;
  sessions?: number;
  activeDevices?: number;
  installations?: number;
  deletions?: number;
  crashes?: number;
  uniqueDevices?: number;
};

export const USAGE_COLUMN_MAP: ColumnMap = {
  date: "date",
  "app version": "appVersion", // verified (App Crashes)
  device: "device", // verified (App Crashes)
  crashes: "crashes", // verified (App Crashes)
  "unique devices": "uniqueDevices", // verified (App Crashes)
  sessions: "sessions", // best-effort (App Sessions)
  "active devices": "activeDevices", // best-effort
  installations: "installations", // best-effort (Installations and Deletions)
  deletions: "deletions", // best-effort
};

export const USAGE_METRICS = new Set([
  "sessions", "activeDevices", "installations", "deletions", "crashes", "uniqueDevices",
]);

export function parseUsageRows(text: string): UsageRow[] {
  return parseReportRows(text, USAGE_COLUMN_MAP, USAGE_METRICS).rows as UsageRow[];
}

export function ingestUsage(
  fetchFn: FetchLike, gunzip: Gunzip, opts: { token: string; requestId: string; granularity?: string },
): Promise<ReportIngestResult> {
  return ingestReport(fetchFn, gunzip, {
    ...opts, category: USAGE_CATEGORY, columnMap: USAGE_COLUMN_MAP, metricFields: USAGE_METRICS,
  });
}
