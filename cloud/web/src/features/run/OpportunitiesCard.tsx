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
  now: "var(--signal, #2f855a)",
  soon: "var(--warn, #b7791f)",
  longshot: "var(--muted, #718096)",
};

export function OpportunitiesCard({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) return null;
  return (
    <div className="card" data-testid="opportunities-card">
      <b>Where to push next</b>
      <p className="micro muted" style={{ margin: "2px 0 0" }}>
        Winnability-ranked keywords, from your measured ranks — a correlational read, not a promise.
      </p>
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
          </p>
          <p className="micro" style={{ margin: "2px 0 0" }}>{o.why}</p>
        </div>
      ))}
    </div>
  );
}
