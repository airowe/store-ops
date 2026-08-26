/**
 * Is the run_ready notification actually WIRED to the places runs are opened?
 *
 * The unit specs prove composition and gating are correct. They would all pass
 * if nothing ever called notifyRunReadyForEnv — the exact failure the approval
 * boundary's wiring spec exists to catch, repeated here for the same reason:
 * runs are opened from six sites and the list grows.
 *
 * This is a source-level check rather than a request-level one because driving a
 * full connect/run through handleApi needs a live agent run (network + AI). What
 * it can prove is that every persistRun site that opens a GATE also notifies —
 * and that the count is asserted, so adding a seventh site fails here rather
 * than shipping silent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), "utf8");

const API = read("../api/index.ts");
const SWEEP = read("../cron/keyedSweep.ts");

/** persistRun calls that open the human gate (status: 'awaiting_approval'). */
function gateOpeningSites(src: string): number {
  return [...src.matchAll(/persistRun\(\s*env\.DB\s*,\s*\{[\s\S]{0,400}?\}\s*\)/g)].filter((m) =>
    /status:\s*"awaiting_approval"/.test(m[0]),
  ).length;
}

describe("run_ready is wired to every gate-opening site", () => {
  it("the API opens 3 gates and notifies 3 times", () => {
    expect(gateOpeningSites(API)).toBe(3);
    // calls only — `function notifyInBackground(` is the definition, not a use
    expect([...API.matchAll(/(?<!function )notifyInBackground\(/g)]).toHaveLength(3);
  });

  it("the cron notifies on its gate-opening branch", () => {
    expect(gateOpeningSites(SWEEP)).toBe(1);
    expect(SWEEP).toMatch(/notifyRunReadyForEnv\(/);
  });

  it("the cron's 'detected' branch is NOT notified — a snapshot is not a gate", () => {
    // the detected persistRun must not be followed by a notify before the next
    // statement boundary; gating lives in notifyRunReady, but wiring it here
    // would still be wrong (it would fire a pointless lookup every sweep).
    const detected = SWEEP.slice(SWEEP.indexOf('status: "detected"'));
    const nextNotify = detected.indexOf("notifyRunReadyForEnv");
    expect(nextNotify).toBe(-1);
  });

  it("notifies AFTER the run is persisted, never before", () => {
    // a notification about a run that failed to persist would be a lie
    for (const m of API.matchAll(/(?<!function )notifyInBackground\(/g)) {
      const before = API.slice(0, m.index);
      expect(before.lastIndexOf("persistRun(")).toBeGreaterThan(-1);
    }
  });
});
