/**
 * Shared, category-AGNOSTIC Analytics Reports ingest core. The graph traversal
 * (report → instances → segments → signed URL → gunzip → parse) and the generic
 * parser live here ONCE; per-category modules supply a COLUMN_MAP + row type.
 *
 * Honesty (inherited from the Engagement parser): map what we recognize, ignore
 * unknown headers, OMIT any absent metric (never a fabricated 0), drop a row with
 * no date. The raw header row is returned so a live-key reconcile can extend a map
 * without guessing in code. Pure parser; injected fetch/gunzip elsewhere.
 */
import { ASC_BASE, type FetchLike } from "./ascWrite.js";
import type { Gunzip } from "./analyticsEngagement.js";

export type ColumnMap = Record<string, string>; // normalized header → row field
export type ReportRow = { date: string } & Record<string, string | number | undefined>;

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();

const toNumber = (v: string): number | undefined => {
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) && v.trim() !== "" ? n : undefined;
};

/**
 * Parse a delimited report segment into rows + the raw header line. Delimiter is
 * inferred (tab if the header has one, else comma). `metricFields` are coerced to
 * number and OMITTED when absent/non-numeric; every other mapped field is a
 * trimmed string (empty → omitted). A row without a date is dropped.
 */
export function parseReportRows(
  text: string,
  columnMap: ColumnMap,
  metricFields: Set<string>,
): { rows: ReportRow[]; header: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: [], header: lines[0] ?? "" };

  const header = lines[0]!;
  const delim = header.includes("\t") ? "\t" : ",";
  const fields = header.split(delim).map((h) => columnMap[norm(h)]);

  const rows: ReportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(delim);
    const row: ReportRow = { date: "" };
    for (let c = 0; c < fields.length; c++) {
      const field = fields[c];
      if (!field) continue;
      const raw = (cells[c] ?? "").trim();
      if (field === "date") row.date = raw;
      else if (metricFields.has(field)) {
        const n = toNumber(raw);
        if (n !== undefined) row[field] = n; // omit when absent/non-numeric
      } else if (raw) row[field] = raw; // omit empty dimension
    }
    if (row.date) rows.push(row);
  }
  return { rows, header };
}

export type ReportIngestResult =
  | { ok: true; rows: ReportRow[]; instances: number; headers: string[] }
  | { ok: false; reason: "not_ready" | "unavailable" };

type ReportRes = { data?: Array<{ id: string; attributes?: { category?: string } }> };
type InstanceRes = { data?: Array<{ id: string; attributes?: { granularity?: string } }> };
type SegmentRes = { data?: Array<{ id: string; attributes?: { url?: string } }> };

async function downloadSegment(
  fetchFn: FetchLike, gunzip: Gunzip, url: string,
  columnMap: ColumnMap, metricFields: Set<string>,
): Promise<{ rows: ReportRow[]; header: string }> {
  try {
    const res = await fetchFn(url); // already signed by Apple — no auth header
    if (!res.ok) return { rows: [], header: "" };
    const buf = new Uint8Array(await res.arrayBuffer());
    return parseReportRows(await gunzip(buf), columnMap, metricFields);
  } catch {
    return { rows: [], header: "" };
  }
}

/**
 * Graph walk for ONE category: reports(filter[category]) → instances(filter[
 * granularity]) → segments → download+parse. Honest states: not_ready when Apple
 * has produced no usable instance yet; unavailable on any transient reach failure.
 * Never throws. Captures each downloaded segment's raw header row.
 */
export async function ingestReport(
  fetchFn: FetchLike,
  gunzip: Gunzip,
  opts: { token: string; requestId: string; category: string; granularity?: string; columnMap: ColumnMap; metricFields: Set<string> },
): Promise<ReportIngestResult> {
  const auth = { headers: { authorization: `Bearer ${opts.token}` } };
  const granularity = opts.granularity ?? "DAILY";
  try {
    const reportsRes = await fetchFn(
      `${ASC_BASE}/analyticsReportRequests/${encodeURIComponent(opts.requestId)}/reports?filter[category]=${opts.category}&limit=200`,
      auth,
    );
    if (!reportsRes.ok) return { ok: false, reason: "unavailable" };
    const reports = ((await reportsRes.json().catch(() => ({}))) as ReportRes).data ?? [];
    const matching = reports.filter((r) => (r.attributes?.category ?? opts.category) === opts.category);
    if (matching.length === 0) return { ok: false, reason: "not_ready" };

    const rows: ReportRow[] = [];
    const headers: string[] = [];
    let instances = 0;
    for (const report of matching) {
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
        if (segments.length === 0) continue;

        instances++;
        for (const seg of segments) {
          const url = seg.attributes?.url;
          if (!url) continue;
          const parsed = await downloadSegment(fetchFn, gunzip, url, opts.columnMap, opts.metricFields);
          rows.push(...parsed.rows);
          if (parsed.header) headers.push(parsed.header);
        }
      }
    }
    if (instances === 0) return { ok: false, reason: "not_ready" };
    return { ok: true, rows, instances, headers };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
