import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, parseThresholds, validateThresholdPatch } from "./thresholds.js";
import { evaluateThreshold } from "./cron/scheduled.js";
import type { AgentResult } from "./engine/index.js";

/**
 * #53 — run-threshold config. Two disciplines under test:
 *   • STORED data is FAIL-OPEN (garbage → today's behavior),
 *   • USER input fails LOUD (400s, never silently a default),
 *   • evaluateThreshold with the default config is byte-for-byte the
 *     historical trigger behavior.
 */

const rank = (keyword: string, r: number | null) =>
  ({ keyword, rank: r, error: "", total: 200, limit: 200, foundName: "" }) as never;

function result(over: Partial<{ ranks: unknown[]; changes: unknown[] }> = {}): AgentResult {
  return {
    ranks: over.ranks ?? [],
    competitors: { listings: [], changes: over.changes ?? [], digest: "" },
  } as never;
}

describe("parseThresholds — fail-open on stored data", () => {
  it("null / empty / bad JSON / wrong shape → defaults (today's behavior)", () => {
    for (const bad of [null, undefined, "", "not json", "[]", '"str"', "42"]) {
      expect(parseThresholds(bad as never)).toEqual(DEFAULT_THRESHOLDS);
    }
  });

  it("per-field coercion: valid fields kept, invalid fields fall back", () => {
    const t = parseThresholds(
      JSON.stringify({ unranked: false, rankDropAtLeast: "ten", mutedKeywords: ["A ", "a", 5] }),
    );
    expect(t.unranked).toBe(false);
    expect(t.rankDropAtLeast).toBeNull(); // "ten" is not a valid drop
    expect(t.mutedKeywords).toEqual([]); // a non-string member poisons the list → default
    expect(t.competitorChanges).toBe(true);
  });

  it("round-trips a full valid config", () => {
    const cfg = { ...DEFAULT_THRESHOLDS, rankDropAtLeast: 10, mutedKeywords: ["pantry"], notifyOnly: true };
    expect(parseThresholds(JSON.stringify(cfg))).toEqual(cfg);
  });
});

describe("validateThresholdPatch — user input fails LOUD", () => {
  it("rejects non-objects, unknown fields, empty patches", () => {
    expect(validateThresholdPatch(null).ok).toBe(false);
    expect(validateThresholdPatch([]).ok).toBe(false);
    expect(validateThresholdPatch({ nope: 1 }).ok).toBe(false);
    expect(validateThresholdPatch({}).ok).toBe(false);
  });

  it("rejects a bad rankDropAtLeast instead of silently defaulting", () => {
    for (const bad of ["5", 0, 201, 2.5, true]) {
      const v = validateThresholdPatch({ rankDropAtLeast: bad });
      expect(v.ok).toBe(false);
    }
    expect(validateThresholdPatch({ rankDropAtLeast: null }).ok).toBe(true);
    expect(validateThresholdPatch({ rankDropAtLeast: 5 }).ok).toBe(true);
  });

  it("normalizes muted lists (trim, lowercase, dedupe); rejects non-string members", () => {
    const v = validateThresholdPatch({ mutedKeywords: [" Recipe ", "recipe", "Pantry"] });
    expect(v).toEqual({ ok: true, patch: { mutedKeywords: ["recipe", "pantry"] } });
    expect(validateThresholdPatch({ mutedKeywords: ["a", 3] }).ok).toBe(false);
  });
});

describe("evaluateThreshold with config (#53)", () => {
  it("default config = the historical behavior (unranked OR competitor change)", () => {
    const d = evaluateThreshold(
      result({
        ranks: [rank("yoga", null)],
        changes: [{ key: "1", status: "changed", name: "Rival", fields: { version: { from: "1", to: "2" } } }],
      }),
    );
    expect(d.crossed).toBe(true);
    expect(d.reasons).toHaveLength(2);
  });

  it("unranked:false silences the unranked trigger", () => {
    const d = evaluateThreshold(result({ ranks: [rank("yoga", null)] }), {
      ...DEFAULT_THRESHOLDS,
      unranked: false,
    });
    expect(d.crossed).toBe(false);
  });

  it("muted keywords never trigger (unranked and drop paths)", () => {
    const cfg = { ...DEFAULT_THRESHOLDS, rankDropAtLeast: 5, mutedKeywords: ["yoga"] };
    const d = evaluateThreshold(result({ ranks: [rank("Yoga", null)] }), cfg, [
      { keyword: "yoga", rank: 3 },
    ]);
    expect(d.crossed).toBe(false);
  });

  it("rank drop ≥ N fires; a smaller wobble does not", () => {
    const cfg = { ...DEFAULT_THRESHOLDS, unranked: false, rankDropAtLeast: 10 };
    const prev = [{ keyword: "yoga", rank: 5 }];
    expect(evaluateThreshold(result({ ranks: [rank("yoga", 15)] }), cfg, prev).crossed).toBe(true);
    expect(evaluateThreshold(result({ ranks: [rank("yoga", 9)] }), cfg, prev).crossed).toBe(false);
  });

  it("falling out of the top 200 counts as a drop; no baseline never asserts one", () => {
    const cfg = { ...DEFAULT_THRESHOLDS, unranked: false, rankDropAtLeast: 10 };
    const out = evaluateThreshold(result({ ranks: [rank("yoga", null)] }), cfg, [
      { keyword: "yoga", rank: 4 },
    ]);
    expect(out.crossed).toBe(true);
    expect(out.reasons[0]).toContain("dropped out of the top");
    // no previous rank → a drop can't be asserted (honesty: no invented baseline)
    expect(evaluateThreshold(result({ ranks: [rank("yoga", 150)] }), cfg, []).crossed).toBe(false);
  });

  it("competitorChanges:false and muted competitors silence the competitor trigger", () => {
    const changed = { key: "42", status: "changed", name: "Rival", fields: { version: { from: "1", to: "2" } } };
    expect(
      evaluateThreshold(result({ changes: [changed] }), { ...DEFAULT_THRESHOLDS, competitorChanges: false }).crossed,
    ).toBe(false);
    expect(
      evaluateThreshold(result({ changes: [changed] }), { ...DEFAULT_THRESHOLDS, mutedCompetitors: ["rival"] }).crossed,
    ).toBe(false);
    expect(
      evaluateThreshold(result({ changes: [changed] }), { ...DEFAULT_THRESHOLDS, mutedCompetitors: ["42"] }).crossed,
    ).toBe(false);
  });
});
