/**
 * "Where to push next" — winnability-ranked keyword opportunities (PRD 06),
 * ported into the redesigned run view. The server already computes + serves
 * these on the run result; this restores the measured card the redesign dropped.
 *
 * Honesty, load-bearing:
 *   • rank is MEASURED-or-absent — a null rank renders "not in top results",
 *     never a fabricated position,
 *   • the score is shown ONLY when measured (`scored !== false`); an unranked
 *     term with no competitor/history data has no real score, so we say "not
 *     enough data to score" rather than print the no-data constant (#65),
 *   • the `why` is correlational and the reachability bucket LABELS longshots
 *     rather than hiding them — no opportunity is dressed up as a promise.
 * Pure presentational; data arrives from the run detail response.
 */
import type { Opportunity, Reachability } from "@shipaso/api";

const REACH_LABEL: Record<Reachability, string> = {
  now: "reachable now",
  soon: "reachable soon",
  longshot: "longshot",
};
const REACH_COLOR: Record<Reachability, string> = {
  now: "var(--signal)",
  soon: "var(--warn)",
  longshot: "var(--dim)",
};

export function OpportunitiesCard({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) return null;
  /**
   * #388: when every row carries the SAME rationale, state it once for the group
   * instead of once per row.
   *
   * This is not hypothetical trimming. On a real run (Heathen, 7dd8ee24) all 12
   * opportunities were identical apart from the keyword — same null rank, same
   * "soon", same unscored 42.5, and the same `why` sentence twelve times over.
   * Other runs show the same shape (8 rows → 2 distinct rationales). Restating
   * one sentence twelve times is most of why this card reads as a wall of text,
   * and it tells the reader nothing on eleven of those repetitions.
   *
   * Only the RATIONALE is hoisted. Rank, score and reachability stay per row:
   * they are the part that actually varies, and collapsing them would hide
   * measured data — the opposite of what this card is for.
   */
  const sharedWhy =
    opportunities.length > 1 && new Set(opportunities.map((o) => o.why)).size === 1
      ? opportunities[0]!.why
      : null;
  return (
    <div className="card" data-testid="opportunities-card">
      <b>Where to push next</b>
      <p className="micro muted" style={{ margin: "2px 0 0" }}>
        Winnability-ranked keywords, from your measured ranks — a correlational read, not a promise.
      </p>
      {sharedWhy ? (
        <p className="micro" data-testid="opp-shared-why" style={{ margin: "8px 0 0" }}>
          {sharedWhy}
        </p>
      ) : null}
      {opportunities.map((o) => (
        <div key={o.keyword} className="opp-row" data-testid={`opp-${o.keyword}`} style={{ margin: "10px 0" }}>
          <p style={{ margin: 0 }}>
            <b>{o.keyword}</b>
            <span className="micro muted" style={{ marginLeft: 8 }}>
              {o.rank !== null ? `#${o.rank}` : "not in top results"}
            </span>
            <span
              className="reach-chip"
              style={{ color: REACH_COLOR[o.reachability], fontSize: 12, marginLeft: 8 }}
            >
              {REACH_LABEL[o.reachability]}
            </span>
            <span className="micro muted" style={{ marginLeft: 8 }} data-testid={`opp-score-${o.keyword}`}>
              {o.scored === false ? "not enough data to score" : `score ${Math.round(o.opportunityScore)}`}
            </span>
            {o.scored !== false ? (
              <span className="winbar" aria-hidden="true">
                <span
                  className="winbar-fill"
                  data-testid={`opp-bar-${o.keyword}`}
                  style={{ width: `${Math.max(0, Math.min(100, Math.round(o.opportunityScore)))}%` }}
                />
              </span>
            ) : null}
          </p>
          {sharedWhy ? null : <p className="micro" style={{ margin: "2px 0 0" }}>{o.why}</p>}
        </div>
      ))}
    </div>
  );
}
