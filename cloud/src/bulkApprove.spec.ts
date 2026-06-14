/**
 * Bulk-approve planner — PURE partitioning of run refs into approvable vs
 * skipped, with no DB and no network. The rule is deliberately strict: a run is
 * approvable ONLY when its status is exactly 'awaiting_approval'; every other
 * status (shipped / rejected / detected / anything else) is skipped with a
 * human-readable reason. Duplicate runIds collapse to a single approval.
 *
 * These tests feed in-memory RunRef[] and assert the partition, the skip
 * reasons, dedup, and the empty / all-skipped edge cases.
 */
import { describe, expect, it } from "vitest";
import { planBulkApprove, type RunRef } from "./bulkApprove.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

function ref(runId: string, status: string, appId = "app-1"): RunRef {
  return { runId, appId, status };
}

const reason = (status: string): string => `not awaiting approval (status=${status})`;

// ── approvable detection ──────────────────────────────────────────────────────

describe("planBulkApprove — approvable detection", () => {
  it("approves only runs whose status is exactly 'awaiting_approval'", () => {
    const plan = planBulkApprove([
      ref("r1", "awaiting_approval"),
      ref("r2", "awaiting_approval"),
    ]);
    expect(plan.approvable).toEqual(["r1", "r2"]);
    expect(plan.skipped).toEqual([]);
  });

  it("preserves input order of approvable runIds", () => {
    const plan = planBulkApprove([
      ref("r3", "awaiting_approval"),
      ref("r1", "awaiting_approval"),
      ref("r2", "awaiting_approval"),
    ]);
    expect(plan.approvable).toEqual(["r3", "r1", "r2"]);
  });
});

// ── skipping non-awaiting statuses ────────────────────────────────────────────

describe("planBulkApprove — skips non-awaiting statuses", () => {
  it.each(["shipped", "rejected", "detected"] as const)(
    "skips a %s run with the status reason",
    (status) => {
      const plan = planBulkApprove([ref("r1", status)]);
      expect(plan.approvable).toEqual([]);
      expect(plan.skipped).toEqual([{ runId: "r1", reason: reason(status) }]);
    },
  );

  it("skips an unknown/unexpected status the same way", () => {
    const plan = planBulkApprove([ref("r1", "queued")]);
    expect(plan.approvable).toEqual([]);
    expect(plan.skipped).toEqual([{ runId: "r1", reason: reason("queued") }]);
  });

  it("partitions a mixed batch into approvable and skipped", () => {
    const plan = planBulkApprove([
      ref("r1", "awaiting_approval"),
      ref("r2", "shipped"),
      ref("r3", "awaiting_approval"),
      ref("r4", "rejected"),
      ref("r5", "detected"),
    ]);
    expect(plan.approvable).toEqual(["r1", "r3"]);
    expect(plan.skipped).toEqual([
      { runId: "r2", reason: reason("shipped") },
      { runId: "r4", reason: reason("rejected") },
      { runId: "r5", reason: reason("detected") },
    ]);
  });
});

// ── dedup ─────────────────────────────────────────────────────────────────────

describe("planBulkApprove — dedup", () => {
  it("approves a repeated approvable runId only once (first occurrence wins)", () => {
    const plan = planBulkApprove([
      ref("r1", "awaiting_approval"),
      ref("r1", "awaiting_approval"),
    ]);
    expect(plan.approvable).toEqual(["r1"]);
    expect(plan.skipped).toEqual([]);
  });

  it("does not duplicate a skipped runId either", () => {
    const plan = planBulkApprove([ref("r1", "shipped"), ref("r1", "shipped")]);
    expect(plan.approvable).toEqual([]);
    expect(plan.skipped).toEqual([{ runId: "r1", reason: reason("shipped") }]);
  });

  it("once a runId is approvable it is not re-listed even if a later ref skips it", () => {
    const plan = planBulkApprove([
      ref("r1", "awaiting_approval"),
      ref("r1", "shipped"),
    ]);
    expect(plan.approvable).toEqual(["r1"]);
    expect(plan.skipped).toEqual([]);
  });

  it("once a runId is skipped it is not re-listed even if a later ref approves it", () => {
    const plan = planBulkApprove([
      ref("r1", "shipped"),
      ref("r1", "awaiting_approval"),
    ]);
    expect(plan.approvable).toEqual([]);
    expect(plan.skipped).toEqual([{ runId: "r1", reason: reason("shipped") }]);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe("planBulkApprove — edge cases", () => {
  it("returns empty plan for empty input", () => {
    const plan = planBulkApprove([]);
    expect(plan.approvable).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("returns all-skipped when no run is awaiting approval", () => {
    const plan = planBulkApprove([
      ref("r1", "shipped"),
      ref("r2", "rejected"),
      ref("r3", "detected"),
    ]);
    expect(plan.approvable).toEqual([]);
    expect(plan.skipped).toEqual([
      { runId: "r1", reason: reason("shipped") },
      { runId: "r2", reason: reason("rejected") },
      { runId: "r3", reason: reason("detected") },
    ]);
  });

  it("is pure — does not mutate the input array", () => {
    const input = [ref("r1", "awaiting_approval"), ref("r2", "shipped")];
    const snapshot = JSON.parse(JSON.stringify(input));
    planBulkApprove(input);
    expect(input).toEqual(snapshot);
  });
});
