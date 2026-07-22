/**
 * COMMERCE Analytics adapter. Category "COMMERCE" (verified enum — NOT
 * "APP_STORE_COMMERCE"). Best-effort COLUMN_MAP seeded from Apple's confirmed
 * signals; unconfirmed headers reconcile via the shared core's captured header
 * rows. Every metric is optional — an absent column is omitted, never a fake 0.
 */
import { type ColumnMap, type ReportIngestResult, ingestReport, parseReportRows } from "./analyticsReportIngest.js";
import type { Gunzip } from "./analyticsEngagement.js";
import type { FetchLike } from "./ascWrite.js";

export const COMMERCE_CATEGORY = "COMMERCE";

export type CommerceRow = {
  date: string;
  contentName?: string;
  purchaseType?: string;
  sales?: number;
  proceeds?: number;
  payingUsers?: number;
};

/** Best-effort (reconcile via captured headers). Keys are normalized headers. */
export const COMMERCE_COLUMN_MAP: ColumnMap = {
  date: "date",
  "content name": "contentName",
  "purchase type": "purchaseType",
  sales: "sales",
  proceeds: "proceeds",
  "paying users": "payingUsers",
};

export const COMMERCE_METRICS = new Set(["sales", "proceeds", "payingUsers"]);

export function parseCommerceRows(text: string): CommerceRow[] {
  return parseReportRows(text, COMMERCE_COLUMN_MAP, COMMERCE_METRICS).rows as CommerceRow[];
}

export function ingestCommerce(
  fetchFn: FetchLike, gunzip: Gunzip, opts: { token: string; requestId: string; granularity?: string },
): Promise<ReportIngestResult> {
  return ingestReport(fetchFn, gunzip, {
    ...opts, category: COMMERCE_CATEGORY, columnMap: COMMERCE_COLUMN_MAP, metricFields: COMMERCE_METRICS,
  });
}
