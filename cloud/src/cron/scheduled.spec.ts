/**
 * The autonomy threshold is the product's core decision — lock it with tests.
 * `evaluateThreshold` is pure over an AgentResult, so we feed it minimal shaped
 * results (no network, no DB).
 */
import { describe, expect, it } from "vitest";
import type { AgentResult } from "../engine/index.js";
import { evaluateThreshold } from "./scheduled.js";

/** Build a minimal AgentResult, overriding only the fields under test. */
function makeResult(over: Partial<AgentResult>): AgentResult {
  const base: AgentResult = {
    audit: { app: "a", bundleId: "com.x", screenshots: null, liveName: "" },
    ranks: [],
    competitors: { listings: [], changes: [], digest: "no changes" },
    reasoning: [],
    proposedCopy: {
      name: "n",
      subtitle: "s",
      keywords: "k",
      validation: { pass: true, checks: [] },
    },
    pushCommands: [],
  };
  return { ...base, ...over };
}

const ranked = (keyword: string, rank: number | null, error = "") => ({
  keyword,
  rank,
  foundName: "",
  total: 100,
  limit: 200,
  error,
});

describe("evaluateThreshold", () => {
  it("does not cross when every targeted keyword is ranked and no competitor moved", () => {
    const r = makeResult({ ranks: [ranked("yoga", 12), ranked("meditation", 3)] });
    const d = evaluateThreshold(r);
    expect(d.crossed).toBe(false);
    expect(d.reasons).toEqual([]);
  });

  it("crosses when a targeted keyword is unranked (rank null)", () => {
    const r = makeResult({ ranks: [ranked("yoga", 12), ranked("breathwork", null)] });
    const d = evaluateThreshold(r);
    expect(d.crossed).toBe(true);
    expect(d.reasons.join(" ")).toContain("breathwork");
  });

  it("ignores keywords that errored (does not count an errored fetch as unranked)", () => {
    const r = makeResult({ ranks: [ranked("yoga", null, "HTTP 503")] });
    const d = evaluateThreshold(r);
    expect(d.crossed).toBe(false);
  });

  it("crosses on a NEW competitor", () => {
    const r = makeResult({
      competitors: {
        listings: [],
        digest: "1 new",
        changes: [{ key: "999", status: "new", name: "Rival" }],
      },
    });
    const d = evaluateThreshold(r);
    expect(d.crossed).toBe(true);
    expect(d.reasons.join(" ")).toContain("Rival");
  });

  it("crosses on a CHANGED competitor listing and names the changed fields", () => {
    const r = makeResult({
      competitors: {
        listings: [],
        digest: "1 changed",
        changes: [
          {
            key: "999",
            status: "changed",
            name: "Rival",
            fields: { version: { from: "1.0", to: "2.0" } },
          },
        ],
      },
    });
    const d = evaluateThreshold(r);
    expect(d.crossed).toBe(true);
    expect(d.reasons.join(" ")).toContain("version");
  });

  it("does NOT cross on 'same' or 'error' competitor statuses alone", () => {
    const r = makeResult({
      competitors: {
        listings: [],
        digest: "no changes",
        changes: [
          { key: "1", status: "same", name: "Rival" },
          { key: "2", status: "error", detail: "not found" },
        ],
      },
    });
    const d = evaluateThreshold(r);
    expect(d.crossed).toBe(false);
  });
});
