/**
 * Google Play "Store performance" funnel — the PARSE half (pure, network-free).
 * The Play sibling of the iOS Engagement parser (`../analyticsEngagement.ts`) and
 * the ONLY official Play conversion-funnel source (data-map §3.3): the monthly
 * CSVs in the developer's private GCS export bucket (store-listing visitors →
 * acquisitions). BigQuery Data Transfer lands the same columns.
 *
 * Honesty is load-bearing and identical to the iOS parser:
 *   • it is MONTHLY + LAGGED — the period is a YYYY-MM, never implied to be live;
 *   • a metric absent from the file is OMITTED, never a fabricated 0;
 *   • conversion rate is DERIVED from measured visitors/acquisitions at read time,
 *     not trusted from a column and never invented;
 *   • pure — never throws; headers match case/space-insensitively via COLUMN_MAP,
 *     so a Google column rename is a one-line change.
 */

/** One parsed month of the Play funnel, keyed by (period, country). */
export type PlayFunnelRow = {
  /** YYYY-MM — the series key; a row without a period is dropped. */
  period: string;
  /** storefront (lowercased ISO) or "" for the all-markets rollup. */
  country?: string | undefined;
  /** store-listing visitors that month — omitted if absent (never a fake 0). */
  visitors?: number | undefined;
  /** store-listing acquisitions that month — omitted if absent. */
  acquisitions?: number | undefined;
};

/** Normalized header → row field. Adjust here if Google renames a column. */
const COLUMN_MAP: Record<string, keyof PlayFunnelRow> = {
  date: "period",
  month: "period",
  "country/region": "country",
  "country (region)": "country",
  country: "country",
  "store listing visitors": "visitors",
  "store listing acquisitions (all)": "acquisitions",
  "store listing acquisitions": "acquisitions",
};

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").replace(/^"|"$/g, "").trim();

const toNumber = (v: string): number | undefined => {
  const n = Number(v.replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
};

/** Normalize a Play "Date" cell (YYYY-MM or YYYY-MM-DD) to a YYYY-MM period. */
function toPeriod(raw: string): string {
  const m = /^(\d{4}-\d{2})/.exec(raw.trim());
  return m ? m[1]! : "";
}

/**
 * Parse a Play store-performance CSV into funnel rows. Delimiter inferred (tab if
 * the header has one, else comma); headers matched via COLUMN_MAP; unknown columns
 * ignored. A metric absent from the file is omitted from every row (no fabricated
 * 0); a row with no period is dropped. Pure — never throws.
 */
export function parsePlayFunnelCsv(text: string): PlayFunnelRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const delim = lines[0]!.includes("\t") ? "\t" : ",";
  const headers = lines[0]!.split(delim).map((h) => COLUMN_MAP[norm(h)]);

  const out: PlayFunnelRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(delim);
    const row: PlayFunnelRow = { period: "", country: undefined, visitors: undefined, acquisitions: undefined };
    for (let c = 0; c < headers.length; c++) {
      const field = headers[c];
      if (!field) continue;
      const raw = (cells[c] ?? "").replace(/^"|"$/g, "").trim();
      if (field === "period") row.period = toPeriod(raw);
      else if (field === "country") row.country = raw ? raw.toLowerCase() : undefined;
      else if (field === "visitors") row.visitors = toNumber(raw);
      else if (field === "acquisitions") row.acquisitions = toNumber(raw);
    }
    if (row.period) out.push(row);
  }
  return out;
}

/**
 * Derive the conversion rate (acquisitions / visitors) for a row, or null when it
 * can't be honestly computed (either metric missing, or zero visitors). Never a
 * fabricated 0 — a null means UNKNOWN.
 */
export function funnelConversionRate(row: PlayFunnelRow): number | null {
  if (row.visitors === undefined || row.acquisitions === undefined) return null;
  if (row.visitors <= 0) return null;
  return row.acquisitions / row.visitors;
}
