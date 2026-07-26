/**
 * One keyword's week-over-week movement. Honesty via the shared classifyDelta +
 * formatRank: a measured move shows ▲/▼ delta; a single snapshot (previous null)
 * shows "new" with NO fabricated count-up; a genuinely unmeasured current reads
 * "—", never 0.
 *
 * A term that HAD a rank and now has none is "lost" (#360) — it fell out of the
 * results, which is a measured, bad-news event and the most consequential thing
 * that can happen to a tracked keyword. It used to fall into the neutral "—"
 * branch, making it indistinguishable from "we didn't check". It carries no
 * number, because we do not know where it landed.
 */
import { classifyDelta, formatRank } from "@shipaso/honesty";
import type { DeltaEntry } from "@shipaso/api";

export function RankMovementRow({ entry }: { entry: DeltaEntry }) {
  const { direction, delta } = classifyDelta({ previous: entry.previous, current: entry.current });
  const color =
    direction === "up"
      ? "var(--signal)"
      : direction === "down" || direction === "lost"
        ? "var(--bad)"
        : "var(--dim)";
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
      ) : direction === "lost" ? (
        <span className="micro" style={{ color }} data-testid="lost" title="Was ranked; no longer in the results">
          lost
        </span>
      ) : (
        <span className="micro" data-testid="flat">—</span>
      )}
    </div>
  );
}
