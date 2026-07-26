/**
 * Pure presentation model for /runs (#356).
 *
 * Honesty decisions encoded here:
 *
 *  • `partition` preserves the SERVER's order. The response already leads with
 *    runs at the human gate at ANY age, then created_at desc. Re-sorting here
 *    would silently substitute a client opinion for the server's contract, so
 *    both halves are built by a single filtering pass and never touched again.
 *
 *  • `groupByDay` groups history rows in ARRIVAL order — the first day seen is
 *    the first group emitted, and a row joins the group it belongs to. It never
 *    sorts groups or rows, for the same reason.
 *
 *  • There is no "0 findings" anywhere. A row whose `findings_summary` is null
 *    simply has no chip; see `PortfolioRunRow`'s doc comment — a zero would
 *    claim "audited, and nothing was critical", a different and unearned
 *    statement.
 */
import type { PortfolioRunRow, RunStatus } from "@shipaso/api";

/** The single status that puts a run in the action queue. */
const QUEUE_STATUS: RunStatus = "awaiting_approval";

export type Partitioned = { queue: PortfolioRunRow[]; history: PortfolioRunRow[] };

/**
 * Split by STATUS only — never by age, never re-sorted. Order within each half
 * is exactly the order the server returned.
 */
export function partition(runs: readonly PortfolioRunRow[]): Partitioned {
  const queue: PortfolioRunRow[] = [];
  const history: PortfolioRunRow[] = [];
  for (const r of runs) (r.status === QUEUE_STATUS ? queue : history).push(r);
  return { queue, history };
}

export type HistoryFilter = "all" | "approved" | "in-progress" | "rejected" | "superseded";

export const HISTORY_FILTERS: ReadonlyArray<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "approved", label: "Approved" },
  { id: "in-progress", label: "In progress" },
  { id: "rejected", label: "Rejected" },
  { id: "superseded", label: "Superseded" },
];

/**
 * `approved` and legacy `shipped` are the same fact to a customer (see
 * lib/status.ts); "in progress" is everything still moving toward a decision.
 */
const FILTER_STATUSES: Record<Exclude<HistoryFilter, "all">, ReadonlySet<RunStatus>> = {
  approved: new Set<RunStatus>(["approved", "shipped"]),
  "in-progress": new Set<RunStatus>(["detected", "researching"]),
  rejected: new Set<RunStatus>(["rejected"]),
  superseded: new Set<RunStatus>(["superseded"]),
};

export function applyFilter(rows: readonly PortfolioRunRow[], filter: HistoryFilter): PortfolioRunRow[] {
  if (filter === "all") return [...rows];
  const allowed = FILTER_STATUSES[filter];
  return rows.filter((r) => allowed.has(r.status));
}

export type DayGroup = { key: string; label: string; rows: PortfolioRunRow[] };

/** Local calendar day key, so "Today" means the reader's today, not UTC's. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Today · Jul 25" / "Yesterday · Jul 24" / "Thursday · Jul 23". */
export function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const stamp = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return `Today · ${stamp}`;
  if (dayKey(d) === dayKey(yesterday)) return `Yesterday · ${stamp}`;
  return `${WEEKDAYS[d.getDay()]} · ${stamp}`;
}

/**
 * Group ADJACENT rows sharing a day, in arrival order.
 *
 * Deliberately not a Map lookup: keying by day would pull a late row up into an
 * earlier group, which is a re-sort wearing a grouping costume. The server's
 * order is the contract, so a day that reappears out of sequence opens a new
 * group and the list still reads top-to-bottom exactly as the server sent it.
 */
export function groupByDay(rows: readonly PortfolioRunRow[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const r of rows) {
    const d = new Date(r.created_at);
    const key = Number.isNaN(d.getTime()) ? r.created_at : dayKey(d);
    const current = groups[groups.length - 1];
    if (current && current.key === key) current.rows.push(r);
    else groups.push({ key, label: dayLabel(r.created_at, now), rows: [r] });
  }
  return groups;
}

export function pluralRuns(n: number): string {
  return `${n} ${n === 1 ? "run" : "runs"}`;
}

/** Derived from the real count — never hardcoded to the comp's "Three". */
export function queueHeadline(n: number): string {
  return n === 1 ? "One run is ready for your decision." : `${n} runs are ready for your decision.`;
}

/** The queue avatar glyph. Empty name ⇒ no glyph rather than a wrong one. */
export function initialFor(appName: string): string {
  return appName.trim().slice(0, 1).toUpperCase();
}
