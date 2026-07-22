import { describe, expect, it } from "vitest";
import { ingestReport, parseReportRows } from "./analyticsReportIngest.js";

const MAP = { date: "date", "content name": "contentName", proceeds: "proceeds", sales: "sales" };
const METRICS = new Set(["proceeds", "sales"]);

describe("parseReportRows", () => {
  it("parses a TSV, mapping known headers case/space-insensitively", () => {
    const text = "Date\tContent Name\tProceeds\n2026-07-01\tPro Plan\t12.50";
    const { rows, header } = parseReportRows(text, MAP, METRICS);
    expect(header).toBe("Date\tContent Name\tProceeds");
    expect(rows).toEqual([{ date: "2026-07-01", contentName: "Pro Plan", proceeds: 12.5 }]);
  });

  it("infers comma delimiter and ignores unknown columns", () => {
    const text = "date,unknown col,sales\n2026-07-02,junk,7";
    const { rows } = parseReportRows(text, MAP, METRICS);
    expect(rows).toEqual([{ date: "2026-07-02", sales: 7 }]);
  });

  it("OMITS an absent metric — never a fabricated 0", () => {
    const text = "date,content name\n2026-07-03,Basic";
    const { rows } = parseReportRows(text, MAP, METRICS);
    expect(rows[0]).toEqual({ date: "2026-07-03", contentName: "Basic" });
    expect("proceeds" in rows[0]!).toBe(false);
  });

  it("drops a row with no date and returns [] for header-only/empty", () => {
    expect(parseReportRows("date,sales\n,5", MAP, METRICS).rows).toEqual([]);
    expect(parseReportRows("date,sales", MAP, METRICS).rows).toEqual([]);
    expect(parseReportRows("", MAP, METRICS).rows).toEqual([]);
  });

  it("coerces a non-numeric metric cell to omitted, not NaN", () => {
    const text = "date,sales\n2026-07-04,n/a";
    const { rows } = parseReportRows(text, MAP, METRICS);
    expect(rows[0]).toEqual({ date: "2026-07-04" });
  });
});

// ── ingestReport (graph walk) ─────────────────────────────────────────────────
const gunzip = async (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);

function jsonRes(data: unknown) {
  return { ok: true, json: async () => ({ data }) } as unknown as Response;
}

describe("ingestReport (graph walk)", () => {
  const MAP = { date: "date", sales: "sales" };
  const METRICS = new Set(["sales"]);

  it("walks report→instances→segments→download and returns ok rows + captured headers", async () => {
    const seg = "https://apple/signed/commerce.csv";
    const fetchFn = async (url: string) => {
      if (url.includes("/reports?")) return jsonRes([{ id: "REP", attributes: { category: "COMMERCE" } }]);
      if (url.includes("/instances?")) return jsonRes([{ id: "INST", attributes: { granularity: "DAILY" } }]);
      if (url.includes("/segments?")) return jsonRes([{ id: "S", attributes: { url: seg } }]);
      if (url === seg) return { ok: true, arrayBuffer: async () => bytes("date,sales\n2026-07-01,9").buffer } as unknown as Response;
      return { ok: false, status: 404 } as Response;
    };
    const res = await ingestReport(fetchFn, gunzip, { token: "t", requestId: "R", category: "COMMERCE", columnMap: MAP, metricFields: METRICS });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toEqual([{ date: "2026-07-01", sales: 9 }]);
      expect(res.instances).toBe(1);
      expect(res.headers).toEqual(["date,sales"]);
    }
  });

  it("filters the reports URL by the given category", async () => {
    let reportsUrl = "";
    const fetchFn = async (url: string) => {
      if (url.includes("/reports?")) { reportsUrl = url; return jsonRes([]); }
      return { ok: false, status: 404 } as Response;
    };
    await ingestReport(fetchFn, gunzip, { token: "t", requestId: "R", category: "APP_USAGE", columnMap: MAP, metricFields: METRICS });
    expect(reportsUrl).toContain("filter[category]=APP_USAGE");
  });

  it("returns not_ready when no report of the category exists", async () => {
    const fetchFn = async (url: string) => (url.includes("/reports?") ? jsonRes([]) : ({ ok: false, status: 404 } as Response));
    const res = await ingestReport(fetchFn, gunzip, { token: "t", requestId: "R", category: "COMMERCE", columnMap: MAP, metricFields: METRICS });
    expect(res).toEqual({ ok: false, reason: "not_ready" });
  });

  it("returns unavailable on a non-OK reports call and never throws", async () => {
    const bad = async () => ({ ok: false, status: 500 }) as Response;
    expect(await ingestReport(bad, gunzip, { token: "t", requestId: "R", category: "COMMERCE", columnMap: MAP, metricFields: METRICS }))
      .toEqual({ ok: false, reason: "unavailable" });
    const boom = async () => { throw new Error("net"); };
    expect(await ingestReport(boom, gunzip, { token: "t", requestId: "R", category: "COMMERCE", columnMap: MAP, metricFields: METRICS }))
      .toEqual({ ok: false, reason: "unavailable" });
  });
});
