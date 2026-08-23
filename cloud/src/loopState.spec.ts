/**
 * LoopState — what the autonomous loop has done for one app.
 *
 * Split from the query deliberately: the SQL is verified against real D1 (see
 * the PR), and the SHAPING rules — what counts as an agent run, what a
 * never-swept app reports, when a next slot is knowable — are pure and belong
 * in unit tests where every edge can be stated.
 *
 * The honesty rule that drives most of these cases: measured-or-nothing applies
 * to a future time exactly as it applies to a rank. If we cannot compute a next
 * slot we say nothing; we never invent a plausible one.
 */
import { describe, expect, it } from "vitest";
import { toLoopState } from "./loopState.js";

const NOW = new Date("2026-08-19T12:00:00Z");

describe("toLoopState", () => {
  it("reports a swept app's history and its next slot", () => {
    const s = toLoopState(
      {
        last_sweep_at: "2026-08-17T09:00:00Z",
        schedule_json: null, // → DEFAULT_SCHEDULE (weekly Monday 09:00)
        agent_run_count: 9,
        agent_since: "2026-06-16T09:00:00Z",
      },
      NOW,
    );
    expect(s.last_sweep_at).toBe("2026-08-17T09:00:00Z");
    expect(s.agent_run_count).toBe(9);
    expect(s.agent_since).toBe("2026-06-16T09:00:00Z");
    expect(s.next_sweep_at).toBe("2026-08-24T09:00:00.000Z");
  });

  it("a never-swept app reports null, not a fabricated last sweep", () => {
    const s = toLoopState(
      { last_sweep_at: null, schedule_json: null, agent_run_count: 0, agent_since: null },
      NOW,
    );
    expect(s.last_sweep_at).toBeNull();
    expect(s.agent_since).toBeNull();
    // The schedule is still knowable, so the FIRST check is honest to state.
    expect(s.next_sweep_at).toBe("2026-08-24T09:00:00.000Z");
  });

  it("zero agent runs is a measurement, not an absence — 0, never null", () => {
    const s = toLoopState(
      { last_sweep_at: null, schedule_json: null, agent_run_count: 0, agent_since: null },
      NOW,
    );
    expect(s.agent_run_count).toBe(0);
    expect(s.agent_run_count).not.toBeNull();
  });

  it("honors a stored non-default schedule", () => {
    const s = toLoopState(
      {
        last_sweep_at: "2026-08-18T14:00:00Z",
        schedule_json: JSON.stringify({ cadence: "daily", day: 0, hourUtc: 14 }),
        agent_run_count: 40,
        agent_since: "2026-07-01T14:00:00Z",
      },
      NOW,
    );
    // daily, 14:00, and it is currently 12:00 → today at 14:00
    expect(s.next_sweep_at).toBe("2026-08-19T14:00:00.000Z");
  });

  it("garbage schedule_json falls back to the default rather than throwing", () => {
    // parseSchedule is fail-open by contract; this pins that LoopState inherits it.
    const s = toLoopState(
      { last_sweep_at: null, schedule_json: "{not json", agent_run_count: 0, agent_since: null },
      NOW,
    );
    expect(s.next_sweep_at).toBe("2026-08-24T09:00:00.000Z");
  });

  it("a null count from the aggregate reads as 0, never NaN", () => {
    // LEFT JOIN with no matching runs yields NULL for the count.
    const s = toLoopState(
      { last_sweep_at: null, schedule_json: null, agent_run_count: null, agent_since: null },
      NOW,
    );
    expect(s.agent_run_count).toBe(0);
  });
});
