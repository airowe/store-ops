/**
 * LoopState — what the autonomous loop has done for one app, and when it next
 * looks. The evidence behind "ASO on autopilot": without it the dashboard
 * cannot say the agent has been working, because the API never told it.
 *
 * Pure shaping, split from the query on purpose. The SQL is verified against
 * real D1; these rules are the ones with edges worth stating in tests.
 */
import { DEFAULT_SCHEDULE, nextSweepAt, parseSchedule } from "./schedule.js";

/** The raw aggregate row: app_settings columns + a count/min over runs. */
export type LoopStateRow = {
  last_sweep_at: string | null;
  schedule_json: string | null;
  /** NULL when the LEFT JOIN matched no runs — shaped to 0, never NaN. */
  agent_run_count: number | null;
  agent_since: string | null;
};

export type LoopState = {
  /** ISO. null = never swept: a new app, or one connected before the stamp existed. */
  last_sweep_at: string | null;
  /** ISO of the next scheduled slot — a CHECK, not a promise of a run (biweekly min-gap). */
  next_sweep_at: string | null;
  /**
   * Runs this app's agent opened by itself. Zero is a real measurement here —
   * we counted the rows and found none — so it is 0, not null. Contrast a rank,
   * where null means unmeasured and 0 would be a lie.
   */
  agent_run_count: number;
  /** ISO of the first agent-opened run — "watching since". null when none. */
  agent_since: string | null;
};

/**
 * Shape one aggregate row. `now` is injected so the next-slot computation is
 * deterministic in tests (and so a caller mapping many apps stamps them all
 * from a single instant rather than drifting across the loop).
 */
export function toLoopState(row: LoopStateRow, now: Date): LoopState {
  // parseSchedule is fail-open by contract: null/garbage → DEFAULT_SCHEDULE.
  const schedule = row.schedule_json ? parseSchedule(row.schedule_json) : DEFAULT_SCHEDULE;
  return {
    last_sweep_at: row.last_sweep_at,
    next_sweep_at: nextSweepAt(schedule, now).toISOString(),
    agent_run_count: row.agent_run_count ?? 0,
    agent_since: row.agent_since,
  };
}
