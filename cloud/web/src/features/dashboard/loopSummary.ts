/**
 * Roll a portfolio's LoopState into one line for the dashboard.
 *
 * Each reduction is chosen for what the user is actually asking:
 *   - last sweep  → MOST RECENT ("when did you last do anything?")
 *   - next check  → SOONEST ("when will you next?")
 *   - run count   → SUM ("how much have you done for me?")
 *   - since       → EARLIEST ("how long have you been watching?")
 *
 * Apps whose `loop` is absent are skipped rather than counted as zero: a Worker
 * predating the field says nothing about that app, which is not the same as
 * saying it has never been swept.
 */
import type { AppListItem } from "@shipaso/api";

export type LoopSummary = {
  lastSweepAt: string | null;
  nextSweepAt: string | null;
  agentRunCount: number;
  agentSince: string | null;
};

/** Later of two ISO strings, tolerating either being absent. */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Earlier of two ISO strings, tolerating either being absent. */
function earlierOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export function loopSummary(apps: AppListItem[]): LoopSummary {
  let lastSweepAt: string | null = null;
  let nextSweepAt: string | null = null;
  let agentSince: string | null = null;
  let agentRunCount = 0;

  for (const a of apps) {
    const loop = a.loop;
    if (!loop) continue; // no data ≠ never swept
    lastSweepAt = laterOf(lastSweepAt, loop.last_sweep_at);
    nextSweepAt = earlierOf(nextSweepAt, loop.next_sweep_at);
    agentSince = earlierOf(agentSince, loop.agent_since);
    agentRunCount += loop.agent_run_count;
  }

  return { lastSweepAt, nextSweepAt, agentRunCount, agentSince };
}
