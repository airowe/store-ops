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

  /**
   * #396: a keyword with NOTHING measured — no rank and no score — has no
   * per-row facts to show. On the Heathen run all 12 were in this state, so the
   * card printed "not in top results · reachable soon · not enough data to
   * score" twelve times: one fact, stated twelve times.
   *
   * Those collapse into a single line that names the count and the keywords.
   * Everything with a real rank or a real score keeps its own row — this is a
   * PARTITION, not a filter, so no measured value can ever be swept into the
   * summary. Measured-or-nothing is strengthened, not weakened: the absence of
   * data is stated more plainly than twelve identical rows stated it.
   *
   * Only worth doing for two or more: a summary line replacing one row is
   * longer than the row it replaces.
   */
  const isUnmeasured = (o: Opportunity) => o.rank === null && o.scored === false;
  const unmeasured = opportunities.filter(isUnmeasured);
  const collapse = unmeasured.length > 1;
  const rows = collapse ? opportunities.filter((o) => !isUnmeasured(o)) : opportunities;
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
      {rows.map((o) => (
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
      {collapse ? (
        <p className="micro muted opp-unmeasured" data-testid="opp-unmeasured" style={{ margin: "10px 0 0" }}>
          {/* States the absence directly. No rank, no score, and explicitly not
              the 42.5 no-data constant — naming the keywords so summarising
              never hides WHICH terms went unmeasured. */}
          <b>{unmeasured.length} keywords not measured yet</b> — no rank and not enough data to
          score: {unmeasured.map((o) => o.keyword).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
