/**
 * One keyword's week-over-week movement. Honesty via the shared classifyDelta +
 * formatRank: a measured move shows ▲/▼ delta; a single snapshot (previous null)
 * shows "new" with NO fabricated count-up; an unmeasured/again-unchanged current
 * reads "—", never 0.
 */
import { classifyDelta, formatRank } from "@shipaso/honesty";
import type { DeltaEntry } from "@shipaso/api";

export function RankMovementRow({ entry }: { entry: DeltaEntry }) {
  const { direction, delta } = classifyDelta({ previous: entry.previous, current: entry.current });
  const color = direction === "up" ? "var(--signal)" : direction === "down" ? "var(--bad)" : "var(--dim)";
  return (
    <div className="move-row" data-testid={`move-${entry.keyword}`}>
      <span className="kw">{entry.keyword}</span>
      <span className="mono cur">{formatRank(entry.current)}</span>
      {direction === "up" || direction === "down" ? (
        <span className="mono" style={{ color }} data-testid="delta">
          {direction === "up" ? "▲" : "▼"}
          {Math.abs(delta ?? 0)}
        </span>
      ) : direction === "new" ? (
        <span className="micro" style={{ color: "var(--signal)" }} data-testid="new">new</span>
      ) : (
        <span className="micro" data-testid="flat">—</span>
      )}
    </div>
  );
}
