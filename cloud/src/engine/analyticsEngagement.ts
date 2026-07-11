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
import { ASC_BASE, type FetchLike } from "./ascWrite.js";

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
const COLUMN_MAP: Record<string, keyof EngagementRow> = {
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

const METRIC_FIELDS = new Set<keyof EngagementRow>(["impressions", "productPageViews", "downloads"]);

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();

/** A "Default"/blank Product Page Id means the default page — never a fake CPP. */
const isDefaultPage = (v: string) => v === "" || v.toLowerCase() === "default";

const toNumber = (v: string): number | undefined => {
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Parse a delimited Engagement segment file into rows. Delimiter is inferred
 * (tab if the header has one, else comma); headers are matched via COLUMN_MAP
 * case/space-insensitively; unknown columns are ignored. A metric column that is
 * absent from the file is omitted from every row (no fabricated zero); a row with
 * no date is dropped (the date is the series key). Pure — never throws.
 */
export function parseEngagementRows(text: string): EngagementRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const delim = lines[0]!.includes("\t") ? "\t" : ",";
  const headers = lines[0]!.split(delim).map((h) => COLUMN_MAP[norm(h)]);

  const out: EngagementRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(delim);
    const row: EngagementRow = { date: "", source: undefined, pageType: undefined, cpp: undefined };
    for (let c = 0; c < headers.length; c++) {
      const field = headers[c];
      if (!field) continue;
      const raw = (cells[c] ?? "").trim();
      if (field === "date") row.date = raw;
      else if (field === "source") row.source = raw || undefined;
      else if (field === "pageType") row.pageType = raw || undefined;
      else if (field === "cpp") row.cpp = isDefaultPage(raw) ? undefined : raw;
      else if (METRIC_FIELDS.has(field)) {
        const n = toNumber(raw);
        if (n !== undefined) (row as EngagementMetrics)[field as keyof EngagementMetrics] = n;
      }
    }
    if (row.date) out.push(row);
  }
  return out;
}

// ── graph traversal + ingest orchestration ───────────────────────────────────

const ENGAGEMENT = "APP_STORE_ENGAGEMENT";

type ReportRes = { data?: Array<{ id: string; attributes?: { category?: string } }> };
type InstanceRes = { data?: Array<{ id: string; attributes?: { granularity?: string } }> };
type SegmentRes = { data?: Array<{ id: string; attributes?: { url?: string } }> };

/** Ingest outcome. `not_ready` = Apple hasn't generated a usable instance yet
 *  (~1–2 days after the request); `unavailable` = a transient reach failure.
 *  Neither ever carries or implies a metric — the caller keeps prior data. */
export type IngestResult =
  | { ok: true; rows: EngagementRow[]; instances: number }
  | { ok: false; reason: "not_ready" | "unavailable" };

/** Download one signed segment URL and parse it. Best-effort: any failure yields
 *  [] so one bad segment never sinks the whole ingest. No auth header — the URL
 *  is already signed by Apple. */
async function downloadSegment(fetchFn: FetchLike, gunzip: Gunzip, url: string): Promise<EngagementRow[]> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return [];
    const bytes = new Uint8Array(await res.arrayBuffer());
    return parseEngagementRows(await gunzip(bytes));
  } catch {
    return [];
  }
}

/**
 * Ingest the Engagement report for a Phase-1 request: report → instances →
 * segments → parsed rows. Filters to the Engagement category (Commerce/Usage are
 * later phases). Returns `not_ready` when Apple has produced no usable instance
 * yet, `unavailable` on a transient reach failure, and never throws.
 */
export async function ingestEngagement(
  fetchFn: FetchLike,
  gunzip: Gunzip,
  opts: { token: string; requestId: string; granularity?: string },
): Promise<IngestResult> {
  const auth = { headers: { authorization: `Bearer ${opts.token}` } };
  const granularity = opts.granularity ?? "DAILY";
  try {
    const reportsRes = await fetchFn(
      `${ASC_BASE}/analyticsReportRequests/${encodeURIComponent(opts.requestId)}/reports?filter[category]=${ENGAGEMENT}&limit=200`,
      auth,
    );
    if (!reportsRes.ok) return { ok: false, reason: "unavailable" };
    const reports = ((await reportsRes.json().catch(() => ({}))) as ReportRes).data ?? [];
    const engagement = reports.filter((r) => (r.attributes?.category ?? ENGAGEMENT) === ENGAGEMENT);
    if (engagement.length === 0) return { ok: false, reason: "not_ready" };

    const rows: EngagementRow[] = [];
    let instances = 0;
    for (const report of engagement) {
      const instRes = await fetchFn(
        `${ASC_BASE}/analyticsReports/${encodeURIComponent(report.id)}/instances?filter[granularity]=${granularity}&limit=200`,
        auth,
      );
      if (!instRes.ok) return { ok: false, reason: "unavailable" };
      const insts = ((await instRes.json().catch(() => ({}))) as InstanceRes).data ?? [];

      for (const inst of insts) {
        const segRes = await fetchFn(
          `${ASC_BASE}/analyticsReportInstances/${encodeURIComponent(inst.id)}/segments?limit=200`,
          auth,
        );
        if (!segRes.ok) return { ok: false, reason: "unavailable" };
        const segments = ((await segRes.json().catch(() => ({}))) as SegmentRes).data ?? [];
        if (segments.length === 0) continue; // instance exists but isn't downloadable yet

        instances++;
        for (const seg of segments) {
          const url = seg.attributes?.url;
          if (url) rows.push(...(await downloadSegment(fetchFn, gunzip, url)));
        }
      }
    }

    if (instances === 0) return { ok: false, reason: "not_ready" };
    return { ok: true, rows, instances };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
