/**
 * PPO results (#182 Phase 4) — the measured-conversion surface, robust to whether
 * Apple exposes result metrics via the ASC v2 API or not.
 *
 * Invariants pinned here:
 *   • Apple's numbers verbatim, never ours — conversion/confidence labeled Apple's,
 *   • a missing metric is ABSENT, never a fabricated 0,
 *   • "running" (below confidence threshold) is never an implied win,
 *   • no metrics read → status "no-metrics" + an ASC deep link (never a fake number),
 *   • the reader DEGRADES (403/404/empty) to no-metrics, never throws.
 */
import { describe, expect, it } from "vitest";
import {
  mapTreatmentMetrics,
  buildPpoResult,
  experimentAscUrl,
  readPpoResults,
  ppoResultFindings,
  CONFIDENCE_THRESHOLD,
  type PpoResult,
  type PpoTreatmentMetrics,
} from "./ppoResults.js";
import type { FetchLike } from "./ascWrite.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mapTreatmentMetrics", () => {
  it("maps present metrics and keeps absent ones absent (never 0)", () => {
    const m = mapTreatmentMetrics({
      id: "t1",
      attributes: { name: "Outcome-led", impressions: 569, conversionRate: 0.0352, confidence: 0.935 },
    });
    expect(m).toEqual({ treatmentId: "t1", treatmentName: "Outcome-led", impressions: 569, conversionRate: 0.0352, confidence: 0.935 });
  });

  it("drops garbage/absent numeric fields (absent, not 0)", () => {
    const m = mapTreatmentMetrics({ id: "t2", attributes: { conversionRate: "high", impressions: null } });
    expect(m).toEqual({ treatmentId: "t2" });
    expect(m!.conversionRate).toBeUndefined();
    expect(m!.impressions).toBeUndefined();
  });

  it("returns null for a row without an id (no fabricated treatment)", () => {
    expect(mapTreatmentMetrics({ attributes: { conversionRate: 0.03 } })).toBeNull();
  });
});

describe("buildPpoResult", () => {
  const base = { experimentId: "e1", appId: "123", state: "ACCEPTED" };

  it("no metrics → status 'no-metrics' + a deep link (never a fake number)", () => {
    const r = buildPpoResult({ ...base, treatments: [] });
    expect(r.status).toBe("no-metrics");
    expect(r.ascUrl).toContain("123");
    expect(r.treatments).toEqual([]);
  });

  it("metrics present but confidence below threshold → 'running' (not a win)", () => {
    const treatments: PpoTreatmentMetrics[] = [{ treatmentId: "t1", conversionRate: 0.03, confidence: CONFIDENCE_THRESHOLD - 0.2 }];
    const r = buildPpoResult({ ...base, treatments });
    expect(r.status).toBe("running");
    expect(r.reachedConfidence).toBe(false);
  });

  it("metrics present and confidence at/above threshold → 'measured' (verbatim carried)", () => {
    const treatments: PpoTreatmentMetrics[] = [{ treatmentId: "t1", conversionRate: 0.0352, confidence: 0.935 }];
    const r = buildPpoResult({ ...base, treatments });
    expect(r.status).toBe("measured");
    expect(r.reachedConfidence).toBe(true);
    expect(r.treatments[0]!.conversionRate).toBe(0.0352); // Apple's, unchanged
    expect(r.treatments[0]!.confidence).toBe(0.935);
  });

  it("always carries the verbatim guidance + a deep link", () => {
    const r = buildPpoResult({ ...base, treatments: [] });
    expect(r.guidance).toMatch(/90|confidence/i);
    expect(r.ascUrl).toBe(experimentAscUrl("123", "e1"));
  });
});

/** A fetch stub for the per-experiment metrics endpoint. */
function makeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url: string) => {
    calls.push(url);
    if (status >= 400) return json({ errors: [{ detail: "nope" }] }, status);
    return json(body, status);
  };
  return { fetchFn, calls };
}

describe("readPpoResults", () => {
  const experiments = [{ id: "e1", state: "ACCEPTED" }];

  it("reads metrics into a 'measured' result when the endpoint returns them", async () => {
    const { fetchFn } = makeFetch({
      data: [{ id: "t1", attributes: { name: "Outcome", conversionRate: 0.0352, confidence: 0.935 } }],
    });
    const out = await readPpoResults(fetchFn, { token: "jwt", appId: "123", experiments });
    expect(out.read).toBe(true);
    expect(out.results[0]!.status).toBe("measured");
    expect(out.results[0]!.treatments[0]!.confidence).toBe(0.935);
  });

  it("degrades to 'no-metrics' (never throws) on 403/404", async () => {
    const { fetchFn } = makeFetch(null, 403);
    const out = await readPpoResults(fetchFn, { token: "jwt", appId: "123", experiments });
    expect(out.results[0]!.status).toBe("no-metrics");
    expect(out.results[0]!.ascUrl).toContain("e1");
  });

  it("degrades to 'no-metrics' on an empty metrics payload", async () => {
    const { fetchFn } = makeFetch({ data: [] });
    const out = await readPpoResults(fetchFn, { token: "jwt", appId: "123", experiments });
    expect(out.results[0]!.status).toBe("no-metrics");
  });
});

describe("ppoResultFindings", () => {
  const measured: PpoResult = buildPpoResult({
    experimentId: "e1",
    appId: "123",
    state: "ACCEPTED",
    treatments: [{ treatmentId: "t1", treatmentName: "Outcome-led", conversionRate: 0.0352, confidence: 0.935 }],
  });

  it("a measured result quotes Apple's numbers and labels them Apple's", () => {
    const f = ppoResultFindings([measured])[0]!;
    expect(f.surface).toBe("ppo");
    // the conversion rate + confidence appear, framed as Apple's
    expect(f.detail).toMatch(/3\.5|3\.52/);
    expect(f.detail).toMatch(/93|0\.93/);
    expect(f.detail.toLowerCase()).toMatch(/apple/);
    // never restated as OUR win
    expect(f.detail.toLowerCase()).not.toMatch(/we (measured|found|proved)/);
  });

  it("a running result carries the guidance + deep link and NO fabricated metric", () => {
    const running = buildPpoResult({
      experimentId: "e2",
      appId: "123",
      treatments: [{ treatmentId: "t1", conversionRate: 0.03, confidence: 0.4 }],
    });
    const f = ppoResultFindings([running])[0]!;
    expect(f.detail.toLowerCase()).toMatch(/90|confidence|running/);
    expect(f.evidence ?? f.detail).toContain("appstoreconnect.apple.com");
  });

  it("a no-metrics result yields a deep-link finding, never a number", () => {
    const none = buildPpoResult({ experimentId: "e3", appId: "123", treatments: [] });
    const f = ppoResultFindings([none])[0]!;
    expect(f.detail).not.toMatch(/\d+(\.\d+)?%/); // no fabricated percentage
    expect(f.evidence ?? f.detail).toContain("appstoreconnect.apple.com");
  });

  it("empty input → no findings", () => {
    expect(ppoResultFindings([])).toEqual([]);
  });
});
