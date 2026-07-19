/**
 * Play funnel — parser + GCS source. Honesty invariants: monthly period, a metric
 * absent from the file is omitted (never a fake 0), conversion rate is DERIVED
 * (null when it can't be honestly computed), and the source degrades to null.
 */
import { describe, expect, it, vi } from "vitest";
import { funnelConversionRate, parsePlayFunnelCsv } from "./playFunnelParse.js";
import {
  fetchPlayFunnelMonth,
  gcsObjectUrl,
  pubsiteBucket,
  storePerformanceObject,
} from "./playFunnelSource.js";
import type { FetchLike } from "./googleAuth.js";

describe("parsePlayFunnelCsv", () => {
  it("parses visitors + acquisitions per (period, country), normalizing the month", () => {
    const csv =
      "Date,Country/Region,Store Listing Visitors,Store Listing Acquisitions\n" +
      "2026-06-01,US,1000,120\n" +
      "2026-06-01,JP,500,40";
    const rows = parsePlayFunnelCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ period: "2026-06", country: "us", visitors: 1000, acquisitions: 120 });
    expect(rows[1]!.country).toBe("jp");
  });

  it("omits an absent metric (no fabricated 0) and drops period-less rows", () => {
    const csv = "Date,Store Listing Visitors\n2026-05,800\n,999";
    const rows = parsePlayFunnelCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ period: "2026-05", country: undefined, visitors: 800, acquisitions: undefined });
  });

  it("returns [] on garbage / header-only", () => {
    expect(parsePlayFunnelCsv("")).toEqual([]);
    expect(parsePlayFunnelCsv("Date,Visitors")).toEqual([]);
  });
});

describe("funnelConversionRate — derived, honest", () => {
  it("acquisitions / visitors when both measured", () => {
    expect(funnelConversionRate({ period: "2026-06", visitors: 1000, acquisitions: 120 })).toBeCloseTo(0.12, 5);
  });
  it("null when a metric is missing or visitors are zero (UNKNOWN, not 0)", () => {
    expect(funnelConversionRate({ period: "2026-06", visitors: 1000 })).toBeNull();
    expect(funnelConversionRate({ period: "2026-06", visitors: 0, acquisitions: 0 })).toBeNull();
  });
});

describe("GCS object naming", () => {
  it("builds the bucket, object, and media URL", () => {
    expect(pubsiteBucket("12345")).toBe("pubsite_prod_rev_12345");
    expect(storePerformanceObject("com.x.y", "202606")).toContain("store_performance_com.x.y_202606");
    const url = gcsObjectUrl("pubsite_prod_rev_12345", "stats/store_performance/f.csv");
    expect(url).toContain("/b/pubsite_prod_rev_12345/o/");
    expect(url).toContain("alt=media");
  });
});

describe("fetchPlayFunnelMonth — degrade-safe", () => {
  const opts = { accessToken: "t", accountId: "12345", packageName: "com.x.y", yyyymm: "202606" };
  it("parses the CSV on a good read", async () => {
    const ok: FetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "Date,Store Listing Visitors,Store Listing Acquisitions\n2026-06,1000,120",
    })) as unknown as FetchLike;
    const rows = await fetchPlayFunnelMonth(ok, opts);
    expect(rows).toEqual([{ period: "2026-06", country: undefined, visitors: 1000, acquisitions: 120 }]);
  });
  it("a non-2xx (not there yet) → null, keeps prior data", async () => {
    const notFound: FetchLike = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })) as unknown as FetchLike;
    expect(await fetchPlayFunnelMonth(notFound, opts)).toBeNull();
  });
  it("a throwing fetch → null (never throws)", async () => {
    const bad: FetchLike = vi.fn(async () => { throw new Error("egress"); }) as unknown as FetchLike;
    expect(await fetchPlayFunnelMonth(bad, opts)).toBeNull();
  });
});
