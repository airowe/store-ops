/**
 * RLHF Phase 2 analysis (#96) — pure mining of the exported edit-delta corpus.
 *
 * Invariants pinned here (the honesty fence, made testable):
 *   • every stat carries its sample size; a field/window under MIN_SAMPLE is
 *     emitted with sufficient:false and NO strong wording — never a pattern
 *     claimed off a handful of rows,
 *   • the acceptance metric only reports whether edit-rate MOVED; it never
 *     attributes the move to any intervention (there may be none yet),
 *   • correlational descriptive stats only — no causal claim, no LLM,
 *   • empty input → empty report (no crash, no fabricated stat).
 */
import { describe, expect, it } from "vitest";
import {
  analyzeEditPatterns,
  acceptanceMetric,
  parseJsonl,
  MIN_SAMPLE,
  type PreferenceRow,
} from "./rlhfAnalysis.js";

/** Build a row with sensible defaults; override what a test cares about. */
function row(p: Partial<PreferenceRow> = {}): PreferenceRow {
  return {
    field: "subtitle",
    decision: "approved",
    edited: false,
    proposed: "Honest weather forecasts",
    final: "Honest weather forecasts",
    created_at: "2026-07-01 12:00:00",
    ...p,
  };
}

/** N rows of one field, `editedCount` of them edited (rest untouched). */
function rowsFor(field: PreferenceRow["field"], n: number, editedCount: number): PreferenceRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ field, edited: i < editedCount, final: i < editedCount ? "changed value here" : "Honest weather forecasts" }),
  );
}

describe("analyzeEditPatterns", () => {
  it("empty input → empty report (no fabricated stats)", () => {
    const r = analyzeEditPatterns([]);
    expect(r.fields).toEqual([]);
    expect(r.totalRows).toBe(0);
  });

  it("computes per-field edit rate with its sample size", () => {
    const rows = rowsFor("subtitle", MIN_SAMPLE, Math.round(MIN_SAMPLE * 0.4)); // 40% edited
    const r = analyzeEditPatterns(rows);
    const f = r.fields.find((x: { field: string }) => x.field === "subtitle")!;
    expect(f.sampleSize).toBe(MIN_SAMPLE);
    expect(f.editRate).toBeCloseTo(0.4, 1);
    expect(f.sufficient).toBe(true);
  });

  it("marks a sub-threshold field insufficient (no strong claim off thin data)", () => {
    const rows = rowsFor("keywords", 3, 2); // only 3 rows
    const r = analyzeEditPatterns(rows);
    const f = r.fields.find((x: { field: string }) => x.field === "keywords")!;
    expect(f.sampleSize).toBe(3);
    expect(f.sufficient).toBe(false);
  });

  it("reports signed length drift on edited rows (humans shortening vs lengthening)", () => {
    // proposed 20 chars → final 10 chars, edited: drift should be negative (shortened)
    const rows = Array.from({ length: MIN_SAMPLE }, () =>
      row({ field: "subtitle", edited: true, proposed: "12345678901234567890", final: "1234567890" }),
    );
    const f = analyzeEditPatterns(rows).fields.find((x: { field: string }) => x.field === "subtitle")!;
    expect(f.lengthDrift).toBeLessThan(0);
    expect(f.lengthDrift).toBeCloseTo(-10, 0);
  });

  it("reports keyword-field term churn (added/removed) for the keywords field", () => {
    const rows = Array.from({ length: MIN_SAMPLE }, () =>
      row({ field: "keywords", edited: true, proposed: "weather,forecast,radar", final: "weather,forecast,storm,alerts" }),
    );
    const f = analyzeEditPatterns(rows).fields.find((x: { field: string }) => x.field === "keywords")!;
    // removed "radar" (1), added "storm","alerts" (2)
    expect(f.keywordChurn?.added).toBeCloseTo(2, 0);
    expect(f.keywordChurn?.removed).toBeCloseTo(1, 0);
  });

  it("reports rejection rate per field", () => {
    const rows = [
      ...rowsFor("name", MIN_SAMPLE - 4, 0),
      ...Array.from({ length: 4 }, () => row({ field: "name", decision: "rejected" })),
    ];
    const f = analyzeEditPatterns(rows).fields.find((x: { field: string }) => x.field === "name")!;
    expect(f.rejectionRate).toBeCloseTo(4 / MIN_SAMPLE, 2);
  });
});

describe("acceptanceMetric", () => {
  it("insufficient when either window is under MIN_SAMPLE", () => {
    const before = rowsFor("subtitle", 5, 3).map((r) => ({ ...r, created_at: "2026-06-01 12:00:00" }));
    const after = rowsFor("subtitle", 5, 1).map((r) => ({ ...r, created_at: "2026-08-01 12:00:00" }));
    const m = acceptanceMetric([...before, ...after], { cutoff: "2026-07-01" });
    expect(m.overall.direction).toBe("insufficient");
  });

  it("reports 'improved' when edit rate drops after the cutoff (edited LESS)", () => {
    const before = Array.from({ length: MIN_SAMPLE }, (_, i) =>
      row({ field: "subtitle", edited: i < MIN_SAMPLE * 0.8, created_at: "2026-06-01 12:00:00" }),
    ); // 80% edited before
    const after = Array.from({ length: MIN_SAMPLE }, (_, i) =>
      row({ field: "subtitle", edited: i < MIN_SAMPLE * 0.2, created_at: "2026-08-01 12:00:00" }),
    ); // 20% edited after
    const m = acceptanceMetric([...before, ...after], { cutoff: "2026-07-01" });
    expect(m.overall.before).toBeCloseTo(0.8, 1);
    expect(m.overall.after).toBeCloseTo(0.2, 1);
    expect(m.overall.direction).toBe("improved");
    expect(m.overall.deltaPct).toBeLessThan(0);
  });

  it("reports 'worse' when edit rate rises after the cutoff", () => {
    const before = Array.from({ length: MIN_SAMPLE }, (_, i) =>
      row({ field: "subtitle", edited: i < MIN_SAMPLE * 0.2, created_at: "2026-06-01 12:00:00" }),
    );
    const after = Array.from({ length: MIN_SAMPLE }, (_, i) =>
      row({ field: "subtitle", edited: i < MIN_SAMPLE * 0.8, created_at: "2026-08-01 12:00:00" }),
    );
    const m = acceptanceMetric([...before, ...after], { cutoff: "2026-07-01" });
    expect(m.overall.direction).toBe("worse");
  });

  it("does not attribute the move — the report carries no causal wording, only before/after/delta", () => {
    const before = Array.from({ length: MIN_SAMPLE }, () => row({ created_at: "2026-06-01 12:00:00", edited: true }));
    const after = Array.from({ length: MIN_SAMPLE }, () => row({ created_at: "2026-08-01 12:00:00", edited: false }));
    const m = acceptanceMetric([...before, ...after], { cutoff: "2026-07-01" });
    // the shape is purely descriptive: numbers + a direction label, no "because"/"caused"
    expect(Object.keys(m.overall).sort()).toEqual(["after", "before", "deltaPct", "direction", "sampleAfter", "sampleBefore"]);
  });

  it("median split when no cutoff is given", () => {
    const rows = [
      ...Array.from({ length: MIN_SAMPLE }, () => row({ created_at: "2026-06-01 12:00:00", edited: true })),
      ...Array.from({ length: MIN_SAMPLE }, () => row({ created_at: "2026-08-01 12:00:00", edited: false })),
    ];
    const m = acceptanceMetric(rows); // no cutoff → median split by created_at
    expect(m.overall.direction).toBe("improved");
  });
});

describe("parseJsonl", () => {
  it("parses valid rows and skips blank + garbage lines", () => {
    const text = [
      JSON.stringify({ field: "subtitle", decision: "approved", edited: true, proposed: "a", final: "b", created_at: "2026-07-01 12:00:00" }),
      "",
      "not json",
      JSON.stringify({ field: "name", decision: "rejected", edited: false, proposed: "c", final: "c", created_at: "2026-07-02 12:00:00" }),
      "{ incomplete",
    ].join("\n");
    const { rows, skipped } = parseJsonl(text);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(2); // "not json" + "{ incomplete"
    expect(rows[0]!.field).toBe("subtitle");
    expect(rows[0]!.edited).toBe(true);
    expect(rows[1]!.decision).toBe("rejected");
  });

  it("skips a JSON object missing required fields (no fabricated row)", () => {
    const { rows, skipped } = parseJsonl(JSON.stringify({ field: "subtitle" })); // no proposed/final
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("coerces an unknown decision to 'approved' and missing created_at to ''", () => {
    const { rows } = parseJsonl(JSON.stringify({ field: "name", decision: "weird", edited: 1, proposed: "x", final: "y" }));
    expect(rows[0]!.decision).toBe("approved");
    expect(rows[0]!.edited).toBe(true);
    expect(rows[0]!.created_at).toBe("");
  });
});
