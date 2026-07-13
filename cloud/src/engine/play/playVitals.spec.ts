/**
 * Android vitals findings + reader. Honesty invariants:
 *   • an unread rate is null (UNMEASURED) — never a fabricated 0,
 *   • a finding fires only on a MEASURED rate over a VERIFIED Google threshold,
 *   • the reader degrades to null on any failure — never throws into the audit,
 *   • both-measured-and-healthy → one honest "good" fact, not silence.
 */
import { describe, expect, it } from "vitest";
import {
  PLAY_ANR_THRESHOLD_PCT,
  PLAY_CRASH_THRESHOLD_PCT,
  extractLatestRatePct,
  playVitalsFindings,
  readPlayVitals,
  type PlayVitals,
} from "./playVitals.js";

/** A Reporting-shaped query response: rows[].metrics[] with a fraction value. */
function resp(metric: string, ...fractions: number[]) {
  return {
    rows: fractions.map((f) => ({ metrics: [{ metric, value: { decimalValue: { value: String(f) } } }] })),
  };
}

describe("extractLatestRatePct", () => {
  it("converts the latest fraction to a percent", () => {
    // 0.008 → 0.8%, then 0.012 → 1.2% (latest wins)
    expect(extractLatestRatePct(resp("userPerceivedCrashRate", 0.008, 0.012), ["userPerceivedCrashRate"])).toBeCloseTo(1.2, 5);
  });
  it("reads a bare-number metric value too", () => {
    const r = { rows: [{ metrics: [{ metric: "anrRate", value: 0.003 }] }] };
    expect(extractLatestRatePct(r, ["userPerceivedAnrRate", "anrRate"])).toBeCloseTo(0.3, 5);
  });
  it("returns null when the metric isn't present or shape is off", () => {
    expect(extractLatestRatePct(resp("somethingElse", 0.01), ["userPerceivedCrashRate"])).toBeNull();
    expect(extractLatestRatePct({}, ["userPerceivedCrashRate"])).toBeNull();
    expect(extractLatestRatePct(null, ["userPerceivedCrashRate"])).toBeNull();
  });
});

describe("readPlayVitals — degrade-safe", () => {
  it("reads both rates from the injected query", async () => {
    const v = await readPlayVitals(async (set) =>
      set === "crashRateMetricSet"
        ? resp("userPerceivedCrashRate", 0.02)
        : resp("userPerceivedAnrRate", 0.001),
    );
    expect(v.crashRatePct).toBeCloseTo(2, 5);
    expect(v.anrRatePct).toBeCloseTo(0.1, 5);
  });
  it("a throwing/failing query yields UNMEASURED (null), never throws", async () => {
    const v = await readPlayVitals(async () => {
      throw new Error("403 missing scope");
    });
    expect(v).toEqual({ crashRatePct: null, anrRatePct: null });
  });
  it("degrades each metric independently", async () => {
    const v = await readPlayVitals(async (set) => {
      if (set === "anrRateMetricSet") throw new Error("boom");
      return resp("userPerceivedCrashRate", 0.015);
    });
    expect(v.crashRatePct).toBeCloseTo(1.5, 5);
    expect(v.anrRatePct).toBeNull();
  });
});

const V = (crash: number | null, anr: number | null): PlayVitals => ({ crashRatePct: crash, anrRatePct: anr });
const ids = (v: PlayVitals) => playVitalsFindings(v).map((f) => f.id);

describe("playVitalsFindings", () => {
  it("flags a crash rate over Google's threshold as critical + cited", () => {
    const f = playVitalsFindings(V(PLAY_CRASH_THRESHOLD_PCT + 0.5, 0.1))[0]!;
    expect(f.id).toBe("play_vitals_crash_over");
    expect(f.severity).toBe("critical");
    expect(f.evidence).toContain("developer.android.com/topic/performance/vitals");
    expect(f.detail).toMatch(/reduce the visibility/);
  });

  it("flags an ANR rate over threshold", () => {
    expect(ids(V(0.1, PLAY_ANR_THRESHOLD_PCT + 0.2))).toContain("play_vitals_anr_over");
  });

  it("both under threshold → one honest 'healthy' good finding", () => {
    const f = playVitalsFindings(V(0.5, 0.1));
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("play_vitals_healthy");
    expect(f[0]!.severity).toBe("good");
  });

  it("UNMEASURED rates contribute nothing (no fabricated healthy/risk)", () => {
    expect(playVitalsFindings(V(null, null))).toEqual([]);
    // one measured-over + one unmeasured → only the over finding, never 'healthy'
    expect(ids(V(PLAY_CRASH_THRESHOLD_PCT + 1, null))).toEqual(["play_vitals_crash_over"]);
  });

  it("exactly at the threshold is NOT over (strict >)", () => {
    expect(ids(V(PLAY_CRASH_THRESHOLD_PCT, PLAY_ANR_THRESHOLD_PCT))).toEqual(["play_vitals_healthy"]);
  });
});
