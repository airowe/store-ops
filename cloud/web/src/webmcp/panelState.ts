/**
 * Pure derivations for the agent activity drawer.
 *
 * Kept out of the component because each of these is a claim that can be wrong
 * in a way a screenshot would not reveal: a call counted twice, a duration
 * measured against the wrong event, a "live" badge that never clears. Pure
 * functions over the log can be tested exhaustively; JSX cannot.
 *
 * Everything here reads the SAME newest-first activity log the panel renders,
 * so the drawer's summary can never disagree with the rows beneath it.
 */
import type { ActivityEntry } from "./useWebMcp.js";

/**
 * Which tools are mid-call. A name is running when its most recent event is a
 * `start`; a later `done`/`error` clears it.
 *
 * Derived rather than tracked separately for the same reason as the rest of
 * this file — a second source of truth would drift, and the drift would show
 * as a tool that pulses forever.
 */
export function runningNames(activity: readonly ActivityEntry[]): Set<string> {
  const latest = new Map<string, ActivityEntry["phase"]>();
  // Newest-first, so the FIRST entry seen for a name is its latest.
  for (const e of activity) if (!latest.has(e.name)) latest.set(e.name, e.phase);
  return new Set([...latest].filter(([, phase]) => phase === "start").map(([name]) => name));
}

/**
 * How long a completed call took, in ms — the gap between a terminal event and
 * the `start` that preceded it for the same tool.
 *
 * Returns null when there is no matching start, which happens legitimately:
 * the log is capped, so an old start can age out while its `done` remains. A
 * missing duration is rendered as absent, never as 0 — measured-or-nothing
 * applies to a millisecond exactly as it does to a rank.
 */
export function durationMs(
  activity: readonly ActivityEntry[],
  entry: ActivityEntry,
): number | null {
  if (entry.phase === "start") return null;
  // Entries are newest-first, so the matching start is LATER in the array.
  const i = activity.findIndex((e) => e.seq === entry.seq);
  if (i < 0) return null;
  for (let j = i + 1; j < activity.length; j++) {
    const e = activity[j]!;
    if (e.name === entry.name && e.phase === "start") {
      const d = entry.at - e.at;
      return d >= 0 ? d : null;
    }
  }
  return null;
}

export type DrawerSummary = {
  /** Tools mid-call right now. */
  runningCount: number;
  /** The most recent tool name, running or finished. Null on an empty log. */
  latestName: string | null;
  /** Completed calls in the log — what the agent has actually done. */
  completed: number;
  /** Calls that failed. Surfaced because a silent failure looks like success. */
  failed: number;
};

/**
 * One line's worth of state for the collapsed drawer.
 *
 * The collapsed bar is what a visitor sees by default, so it has to be
 * informative on its own: how many tools are offered is static, but whether
 * anything is HAPPENING is the thing worth glancing at.
 */
export function summarize(activity: readonly ActivityEntry[]): DrawerSummary {
  const running = runningNames(activity);
  return {
    runningCount: running.size,
    latestName: activity[0]?.name ?? null,
    completed: activity.filter((e) => e.phase === "done").length,
    failed: activity.filter((e) => e.phase === "error").length,
  };
}

/** Render a duration the way the panel shows it, or "" when unmeasured. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
