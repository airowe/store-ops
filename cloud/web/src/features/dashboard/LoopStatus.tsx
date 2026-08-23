/**
 * "Your agents have been working" — the autopilot, stated on a page the user
 * actually lands on.
 *
 * The loop has run weekly since June and said so nowhere: the only surface that
 * told the story was RunTriggerNote, one click deep on a specific run. A user
 * who never opened a run had no way to know the product had done anything.
 *
 * Deliberately static. The sweep fires on the hour and finishes in seconds, so
 * an animation implying continuous activity would be theater for a discrete
 * process. Dated history is stronger evidence anyway — it is checkable.
 */
import type { LoopSummary } from "./loopSummary.js";

/** Whole days between two instants, floored. */
function daysBetween(from: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(from)) / 86_400_000);
}

/** "today" / "yesterday" / "N days ago" — relative, because the user thinks that way. */
function relativeDay(iso: string, now: Date): string {
  const d = daysBetween(iso, now);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/**
 * "Monday 09:00 UTC" — absolute, because the user may want to be around for it,
 * and because "in 4 days" invites the reader to do arithmetic we can just do.
 */
function slotLabel(iso: string): string {
  const d = new Date(iso);
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    d.getUTCDay()
  ];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${day} ${hh}:00 UTC`;
}

/** Month + year, for "watching since June 2026". */
function monthLabel(iso: string): string {
  const d = new Date(iso);
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][d.getUTCMonth()];
  return `${month} ${d.getUTCFullYear()}`;
}

export function LoopStatus({ summary, now }: { summary: LoopSummary; now: Date }) {
  const { lastSweepAt, nextSweepAt, agentRunCount, agentSince } = summary;

  // Nothing measured and nothing scheduled → say nothing. An empty portfolio,
  // or a Worker that predates the field, must not produce a confident-looking
  // status line about a loop we know nothing about.
  if (!lastSweepAt && !nextSweepAt) return null;

  // The count line only appears once there is something to count. "0 checks
  // run for you" reads as a fault report, not as a not-yet.
  const countLine =
    agentRunCount > 0
      ? `${agentRunCount} check${agentRunCount === 1 ? "" : "s"} run for you` +
        (agentSince ? ` since ${monthLabel(agentSince)}` : "")
      : null;

  return (
    <div className="loop-status" data-testid="loop-status">
      <p className="loop-status-head">
        <span className="loop-dot" aria-hidden="true" />
        <span className="loop-label">Agents active</span>
        {lastSweepAt ? (
          <span className="loop-clause"> · last checked {relativeDay(lastSweepAt, now)}</span>
        ) : null}
        {nextSweepAt ? (
          <span className="loop-clause">
            {" "}
            · {lastSweepAt ? "next check" : "first check"} {slotLabel(nextSweepAt)}
          </span>
        ) : null}
      </p>
      {countLine ? <p className="loop-status-sub">{countLine}</p> : null}
    </div>
  );
}
