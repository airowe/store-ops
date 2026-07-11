import { describe, expect, it } from "vitest";
import {
  ingestEngagement,
  parseEngagementRows,
  type EngagementRow,
} from "./analyticsEngagement.js";
import type { FetchLike } from "./ascWrite.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ── the pure parser — the fully-verifiable core ──────────────────────────────
describe("parseEngagementRows", () => {
  it("parses a tab-delimited Engagement segment, mapping Apple's columns", () => {
    const tsv = [
      "Date\tSource Type\tPage Type\tProduct Page Id\tImpressions\tProduct Page Views\tTotal Downloads",
      "2026-07-01\tApp Store Search\tProduct Page\tDefault\t1,234\t456\t78",
      "2026-07-01\tApp Referrer\tProduct Page\tCPP_ABC\t20\t10\t3",
    ].join("\n");
    const rows = parseEngagementRows(tsv);
    expect(rows).toEqual<EngagementRow[]>([
      { date: "2026-07-01", source: "App Store Search", pageType: "Product Page", cpp: undefined, impressions: 1234, productPageViews: 456, downloads: 78 },
      { date: "2026-07-01", source: "App Referrer", pageType: "Product Page", cpp: "CPP_ABC", impressions: 20, productPageViews: 10, downloads: 3 },
    ]);
  });

  it("accepts comma-delimited files and case/space-insensitive headers", () => {
    const csv = ["date,impressions,product page views,total downloads", "2026-07-02,5,4,1"].join("\n");
    expect(parseEngagementRows(csv)).toEqual([
      { date: "2026-07-02", source: undefined, pageType: undefined, cpp: undefined, impressions: 5, productPageViews: 4, downloads: 1 },
    ]);
  });

  it("treats a 'Default'/blank Product Page Id as the default page (cpp undefined), never invents one", () => {
    const rows = parseEngagementRows("Date\tProduct Page Id\tImpressions\n2026-07-03\t\t9");
    expect(rows[0]!.cpp).toBeUndefined();
  });

  it("omits a metric that the file didn't carry — never a fabricated zero", () => {
    const rows = parseEngagementRows("Date\tImpressions\n2026-07-04\t100");
    expect(rows[0]).toEqual({ date: "2026-07-04", source: undefined, pageType: undefined, cpp: undefined, impressions: 100 });
    expect("downloads" in rows[0]!).toBe(false);
    expect("productPageViews" in rows[0]!).toBe(false);
  });

  it("skips blank lines and rows with no date (the series key)", () => {
    const rows = parseEngagementRows("Date\tImpressions\n\n\tNoDate\n2026-07-05\t7\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-07-05");
  });

  it("returns [] for empty or header-only input", () => {
    expect(parseEngagementRows("")).toEqual([]);
    expect(parseEngagementRows("Date\tImpressions")).toEqual([]);
  });
});

// ── ingest orchestration + safe-degrade (stubbed fetch + gunzip) ──────────────
const gunzipPassthrough = async (b: Uint8Array) => new TextDecoder().decode(b);

/** Full happy graph: request → Engagement report → instance → segment → file. */
function happyFetch(fileText: string) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url: string) => {
    calls.push(url);
    if (url.includes("/reports") && url.includes("analyticsReportRequests")) {
      return json({ data: [
        { id: "RPT_ENG", type: "analyticsReports", attributes: { category: "APP_STORE_ENGAGEMENT", name: "App Store Engagement — Detailed" } },
        { id: "RPT_COMM", type: "analyticsReports", attributes: { category: "APP_STORE_COMMERCE" } },
      ] });
    }
    if (url.includes("/analyticsReports/RPT_ENG/instances")) {
      return json({ data: [{ id: "INST1", type: "analyticsReportInstances", attributes: { granularity: "DAILY", processingDate: "2026-07-01" } }] });
    }
    if (url.includes("/analyticsReportInstances/INST1/segments")) {
      return json({ data: [{ id: "SEG1", type: "analyticsReportSegments", attributes: { url: "https://signed.example/seg1.gz", sizeInBytes: 10 } }] });
    }
    if (url === "https://signed.example/seg1.gz") {
      return new Response(new TextEncoder().encode(fileText), { status: 200 });
    }
    return json({}, 404);
  };
  return { fetchFn, calls };
}

const OPTS = { token: "jwt", requestId: "REQ1" };
const FILE = "Date\tSource Type\tImpressions\tProduct Page Views\tTotal Downloads\n2026-07-01\tApp Store Search\t100\t40\t8";

describe("ingestEngagement", () => {
  it("walks Engagement report → instance → segment, parses the file, returns rows", async () => {
    const { fetchFn, calls } = happyFetch(FILE);
    const result = await ingestEngagement(fetchFn, gunzipPassthrough, OPTS);
    expect(result).toEqual({ ok: true, instances: 1, rows: [
      { date: "2026-07-01", source: "App Store Search", pageType: undefined, cpp: undefined, impressions: 100, productPageViews: 40, downloads: 8 },
    ] });
    // only the Engagement report's instances were fetched — Commerce was ignored.
    expect(calls.some((u) => u.includes("/analyticsReports/RPT_COMM/instances"))).toBe(false);
  });

  it("no Engagement report yet (Apple still generating) → not_ready, never a fabricated series", async () => {
    const fetchFn: FetchLike = async (url) =>
      url.includes("/reports") ? json({ data: [] }) : json({}, 404);
    expect(await ingestEngagement(fetchFn, gunzipPassthrough, OPTS)).toEqual({ ok: false, reason: "not_ready" });
  });

  it("an instance with no segments yet → not_ready (nothing to parse, prior data untouched)", async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.includes("/reports")) return json({ data: [{ id: "RPT_ENG", attributes: { category: "APP_STORE_ENGAGEMENT" } }] });
      if (url.includes("/instances")) return json({ data: [{ id: "INST1", attributes: { granularity: "DAILY" } }] });
      if (url.includes("/segments")) return json({ data: [] });
      return json({}, 404);
    };
    expect(await ingestEngagement(fetchFn, gunzipPassthrough, OPTS)).toEqual({ ok: false, reason: "not_ready" });
  });

  it("a transient failure listing reports → unavailable (never throws, caller keeps prior data)", async () => {
    const fetchFn: FetchLike = async () => json({ errors: [] }, 503);
    expect(await ingestEngagement(fetchFn, gunzipPassthrough, OPTS)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a 403 anywhere → unavailable, and it never throws", async () => {
    const fetchFn: FetchLike = async () => json({ errors: [] }, 403);
    const r = await ingestEngagement(fetchFn, gunzipPassthrough, OPTS);
    expect(r.ok).toBe(false);
  });

  it("one bad segment download is skipped best-effort; good rows still return", async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.includes("/reports")) return json({ data: [{ id: "RPT_ENG", attributes: { category: "APP_STORE_ENGAGEMENT" } }] });
      if (url.includes("/instances")) return json({ data: [{ id: "INST1", attributes: { granularity: "DAILY" } }] });
      if (url.includes("/segments")) return json({ data: [
        { id: "SEG_BAD", attributes: { url: "https://signed.example/bad.gz" } },
        { id: "SEG_OK", attributes: { url: "https://signed.example/ok.gz" } },
      ] });
      if (url.endsWith("/bad.gz")) return new Response("boom", { status: 500 });
      if (url.endsWith("/ok.gz")) return new Response(new TextEncoder().encode(FILE), { status: 200 });
      return json({}, 404);
    };
    const r = await ingestEngagement(fetchFn, gunzipPassthrough, OPTS);
    expect(r).toMatchObject({ ok: true, rows: [{ date: "2026-07-01", downloads: 8 }] });
  });
});
