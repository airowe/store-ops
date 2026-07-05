/**
 * WarRoomGrid — head-to-head keyword ranks vs. selected competitors. Honesty:
 * a competitor we never checked renders "—" (via shared formatRank), never a
 * guessed number; a keyword you win is signal-tinted; the gap-to-best is "—"
 * when there's nothing to close. Ported from mobile WarRoomGrid.
 */
import { formatRank } from "@shipaso/honesty";
import type { HeadToHead } from "@shipaso/api";

function gapText(gap: number | null): string {
  if (gap == null) return "—";
  return gap > 0 ? `+${gap}` : `${gap}`;
}

export function WarRoomGrid({ rows, competitors }: { rows: HeadToHead[]; competitors: string[] }) {
  if (rows.length === 0) return <p className="muted">No head-to-head data yet.</p>;
  return (
    <div className="war-grid-wrap">
      <table className="war-grid">
        <thead>
          <tr>
            <th className="left">keyword</th>
            <th>you</th>
            {competitors.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th>gap</th>
            <th>trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.keyword} data-testid={`war-${r.keyword}`} className={r.winning ? "winning" : ""}>
              <td className="left war-kw">{r.keyword}</td>
              <td className={"pos" + (r.winning ? " good" : "")} data-testid={`you-${r.keyword}`}>
                {formatRank(r.you)}
              </td>
              {competitors.map((name) => {
                const c = r.competitors.find((x) => x.name === name);
                return (
                  <td key={name} className="pos">
                    {formatRank(c?.rank ?? null)}
                  </td>
                );
              })}
              <td className={"war-gap " + (r.gapToBest == null ? "neutral" : r.gapToBest <= 0 ? "good" : "bad")}>
                {gapText(r.gapToBest)}
              </td>
              <td className="war-trend">{r.trend}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
