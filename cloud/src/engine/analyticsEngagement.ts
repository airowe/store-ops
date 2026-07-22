/**
 * App Store Connect Analytics Reports — Phase 2: ingest the App Store ENGAGEMENT
 * report (analytics-reports PRD, 02-engagement-ingest). Walks the async graph
 * Phase 1's request produced, downloads the ready segment files, and parses them
 * into a typed per-day/source/CPP series the caller persists.
 *
 *   analyticsReportRequest ─▶ reports (filter APP_STORE_ENGAGEMENT)
 *                           ─▶ instances (dated, per granularity)
 *                           ─▶ segments (a signed URL to a gzipped CSV/TSV file)
 *
 * Pure where it can be (the parser) and injected-fetch elsewhere (same shape as
 * ascRead/ascWrite). The gzip inflate is injected too, so the parser tests need
 * no real gzip. Safe-degrade is load-bearing: nothing here throws — a not-yet-
 * ready or failed report yields an honest `not_ready`/`unavailable` so the caller
 * leaves any prior persisted data intact and NEVER writes a fabricated series.
 *
 * NOTE (validate against a live Admin key): the exact Engagement column headers,
 * instance `granularity`/state names, and segment `url` field follow Apple's
 * documented Analytics Reports schema. The parser matches headers case- and
 * space-insensitively and maps a small, adjustable set (COLUMN_MAP) so a header
 * rename is a one-line change, not a rewrite.
 */
import type { FetchLike } from "./ascWrite.js";
import { ingestReport, parseReportRows, type ColumnMap } from "./analyticsReportIngest.js";

/** Measured Engagement metrics. Every field is optional — a metric absent from
 *  the file is OMITTED, never a fabricated zero (the honesty boundary). */
export type EngagementMetrics = {
  impressions?: number;
  productPageViews?: number;
  downloads?: number;
};

/** One parsed row of the Engagement series, keyed by date + its segments. */
export type EngagementRow = EngagementMetrics & {
  /** YYYY-MM-DD — the series key; a row without it is dropped. */
  date: string;
  /** Traffic source (e.g. "App Store Search", "App Referrer"). */
  source?: string | undefined;
  /** Page type (e.g. "Product Page"). */
  pageType?: string | undefined;
  /** Custom Product Page id; undefined = the default product page (never invented). */
  cpp?: string | undefined;
};

/** Inflate gzipped bytes to text. Injected so the parser tests need no real gzip. */
export type Gunzip = (bytes: Uint8Array) => Promise<string>;

/** Default gunzip via the Web DecompressionStream (Workers + Node 18+). */
export const gunzipText: Gunzip = async (bytes) => {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(bytes).body!.pipeThrough(ds);
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
};

// ── pure parser ──────────────────────────────────────────────────────────────

/** Normalized header → row field. Adjust here if Apple renames a column. */
const COLUMN_MAP: ColumnMap = {
  date: "date",
  "source type": "source",
  source: "source",
  "page type": "pageType",
  "product page id": "cpp",
  "custom product page id": "cpp",
  "custom product page": "cpp",
  impressions: "impressions",
  "product page views": "productPageViews",
  "total downloads": "downloads",
  downloads: "downloads",
};

const METRIC_FIELDS = new Set<string>(["impressions", "productPageViews", "downloads"]);

/** A "Default"/blank Product Page Id means the default page — never a fake CPP. */
const isDefaultPage = (v: string | undefined) => v === undefined || v === "" || v.toLowerCase() === "default";

/** Reshape a generic `ReportRow` (from `parseReportRows`/`ingestReport`) into the
 *  Engagement-specific row: always-present `source`/`pageType`/`cpp` keys (as
 *  `undefined` when absent, matching the historic shape) and the "Default"/blank
 *  Product Page Id → `undefined` collapse (never a fabricated CPP id). */
function toEngagementRow(r: { date: string } & Record<string, string | number | undefined>): EngagementRow {
  const row: EngagementRow = {
    date: r.date,
    source: (r.source as string | undefined) ?? undefined,
    pageType: (r.pageType as string | undefined) ?? undefined,
    cpp: isDefaultPage(r.cpp as string | undefined) ? undefined : (r.cpp as string),
  };
  if (typeof r.impressions === "number") row.impressions = r.impressions;
  if (typeof r.productPageViews === "number") row.productPageViews = r.productPageViews;
  if (typeof r.downloads === "number") row.downloads = r.downloads;
  return row;
}

/**
 * Parse a delimited Engagement segment file into rows. Delegates the column
 * mapping/coercion walk to the shared `parseReportRows` core, then applies the
 * two Engagement-specific honesty rules the generic core doesn't know about (see
 * `toEngagementRow`). Pure — never throws.
 */
export function parseEngagementRows(text: string): EngagementRow[] {
  const { rows } = parseReportRows(text, COLUMN_MAP, METRIC_FIELDS);
  return rows.map(toEngagementRow);
}

// ── graph traversal + ingest orchestration ───────────────────────────────────

const ENGAGEMENT = "APP_STORE_ENGAGEMENT";

/** Ingest outcome. `not_ready` = Apple hasn't generated a usable instance yet
 *  (~1–2 days after the request); `unavailable` = a transient reach failure.
 *  Neither ever carries or implies a metric — the caller keeps prior data. */
export type IngestResult =
  | { ok: true; rows: EngagementRow[]; instances: number }
  | { ok: false; reason: "not_ready" | "unavailable" };

/**
 * Ingest the Engagement report for a Phase-1 request: report → instances →
 * segments → parsed rows. Delegates the graph walk to the shared `ingestReport`
 * core (category-filtered to Engagement; Commerce/Usage are later phases) and
 * re-applies the Engagement-specific row shaping (`isDefaultPage`, always-present
 * `source`/`pageType`/`cpp` keys) that `parseEngagementRows` also applies. Returns
 * `not_ready` when Apple has produced no usable instance yet, `unavailable` on a
 * transient reach failure, and never throws.
 */
export async function ingestEngagement(
  fetchFn: FetchLike,
  gunzip: Gunzip,
  opts: { token: string; requestId: string; granularity?: string },
): Promise<IngestResult> {
  const result = await ingestReport(fetchFn, gunzip, {
    token: opts.token,
    requestId: opts.requestId,
    category: ENGAGEMENT,
    ...(opts.granularity !== undefined ? { granularity: opts.granularity } : {}),
    columnMap: COLUMN_MAP,
    metricFields: METRIC_FIELDS,
  });
  if (!result.ok) return result;
  return { ok: true, rows: result.rows.map(toEngagementRow), instances: result.instances };
}
