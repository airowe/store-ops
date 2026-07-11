import { describe, expect, it } from "vitest";
import {
  conversionMovements,
  conversionRate,
  latestConversion,
  type ConversionRow,
} from "./conversionMovement.js";

describe("conversionRate", () => {
  it("is downloads / product page views — a MEASURED ratio", () => {
    expect(conversionRate(200, 40)).toBeCloseTo(0.2);
  });
  it("is null (unmeasured) when PPV is 0 — never 0/0, never a fake 0", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(0, 5)).toBeNull();
  });
  it("is null when either side wasn't measured", () => {
    expect(conversionRate(null, 10)).toBeNull();
    expect(conversionRate(100, null)).toBeNull();
  });
});

/** Build a flat daily series (one source) with a constant conversion rate. */
function days(from: string, n: number, ppv: number, downloads: number, source = "App Store Search"): ConversionRow[] {
  const base = Date.parse(from + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(base + i * 86400000).toISOString().slice(0, 10),
    source,
    productPageViews: ppv,
    downloads,
  }));
}

describe("latestConversion", () => {
  it("returns the most recent date's MEASURED overall conversion", () => {
    const rows = [...days("2026-07-01", 3, 100, 20)];
    expect(latestConversion(rows)).toEqual({ date: "2026-07-03", rate: 0.2 });
  });
  it("aggregates across sources/CPPs on the latest day (sum, then divide)", () => {
    const rows: ConversionRow[] = [
      { date: "2026-07-05", source: "Search", productPageViews: 100, downloads: 30 },
      { date: "2026-07-05", source: "Browse", productPageViews: 100, downloads: 10 },
    ];
    // (30+10) / (100+100) = 0.2
    expect(latestConversion(rows)).toEqual({ date: "2026-07-05", rate: 0.2 });
  });
  it("is null when the series is empty or the latest day is unmeasurable", () => {
    expect(latestConversion([])).toBeNull();
    expect(latestConversion([{ date: "2026-07-01", source: "", productPageViews: 0, downloads: 0 }])).toBeNull();
  });
});

describe("conversionMovements", () => {
  const push = [{ runId: "run1", pushedAt: "2026-07-15T12:00:00Z" }];

  it("measures before vs after a push (aggregate), MEASURED both sides", () => {
    // 14 days before at 10% conversion, 14 days from the push at 20%.
    const before = days("2026-07-01", 14, 100, 10);
    const after = days("2026-07-15", 14, 100, 20);
    const moves = conversionMovements([...before, ...after], push, { windowDays: 14 });
    const all = moves.find((m) => m.source === "");
    expect(all).toMatchObject({ at: "2026-07-15", runId: "run1", source: "" });
    expect(all!.before).toBeCloseTo(0.1);
    expect(all!.after).toBeCloseTo(0.2);
    expect(all!.samplesBefore).toBe(14);
    expect(all!.samplesAfter).toBe(14);
  });

  it("emits a per-source movement in addition to the aggregate", () => {
    const before = days("2026-07-08", 7, 100, 5, "App Store Search");
    const after = days("2026-07-15", 7, 100, 15, "App Store Search");
    const moves = conversionMovements([...before, ...after], push, { windowDays: 7 });
    expect(moves.some((m) => m.source === "App Store Search")).toBe(true);
    expect(moves.some((m) => m.source === "")).toBe(true);
  });

  it("OMITS a movement when one side has no measured conversion (correlational, measured-or-absent)", () => {
    // only after-window data — nothing before the push → no movement claimed.
    const after = days("2026-07-15", 7, 100, 20);
    expect(conversionMovements(after, push, { windowDays: 14 })).toEqual([]);
  });

  it("ignores data outside the window on either side", () => {
    const wayBefore = days("2026-01-01", 5, 100, 99); // far outside the 14-day window
    const before = days("2026-07-10", 5, 100, 10);
    const after = days("2026-07-15", 5, 100, 20);
    const all = conversionMovements([...wayBefore, ...before, ...after], push, { windowDays: 14 }).find((m) => m.source === "");
    expect(all!.before).toBeCloseTo(0.1); // the far-off 99% data did not leak in
    expect(all!.samplesBefore).toBe(5);
  });

  it("no pushes → no movements", () => {
    expect(conversionMovements(days("2026-07-01", 30, 100, 20), [], {})).toEqual([]);
  });
});
