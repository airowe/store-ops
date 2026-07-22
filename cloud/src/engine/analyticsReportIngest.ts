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
