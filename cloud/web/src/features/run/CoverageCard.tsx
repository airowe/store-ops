/**
 * "Metadata budget" — how hard the 30/30/100 char budget is working (PRD 03),
 * ported into the redesigned run view. The server already computes + serves this
 * on the run result; this restores the measured card the redesign dropped.
 *
 * Honesty, load-bearing:
 *   • an UNSEEN field (seen:false) renders "not read" — a 0 there is UNKNOWN,
 *     never displayed as "empty" or "0/30",
 *   • waste is itemized with its measured char cost; a clean listing shows none
 *     (no manufactured inefficiency).
 * Pure presentational; data arrives from the run detail response.
 */
import type { CoverageReport } from "@shipaso/api";

export function CoverageCard({ coverage }: { coverage: CoverageReport }) {
  const { coverageScore, fieldFill, distinctTerms, waste } = coverage;
  return (
    <div className="card" data-testid="coverage-card">
      <b>Metadata budget</b>
      <p className="micro muted" style={{ margin: "2px 0 0" }}>
        How hard your name / subtitle / keyword budget is working — {distinctTerms} distinct ranking terms.
      </p>
      <p className="micro" data-testid="coverage-score" style={{ margin: "4px 0 0" }}>
        Coverage score: <b>{coverageScore}</b>/100
      </p>

      <div data-testid="field-fill" style={{ marginTop: 8 }}>
        {fieldFill.map((f) => (
          <p key={f.field} className="micro" data-testid={`fill-${f.field}`} style={{ margin: "2px 0 0" }}>
            {f.field}: {f.seen ? `${f.used}/${f.limit} (${Math.round(f.fillPct)}%)` : "not read"}
          </p>
        ))}
      </div>

      {waste.length > 0 ? (
        <div data-testid="coverage-waste" style={{ marginTop: 8 }}>
          <p className="micro muted" style={{ margin: 0 }}>Wasted budget</p>
          {waste.map((w, i) => (
            <p key={`${w.kind}-${i}`} className="micro" style={{ margin: "2px 0 0" }}>
              {w.detail} — {w.chars} char{w.chars === 1 ? "" : "s"}
            </p>
          ))}
        </div>
      ) : (
        <p className="micro muted" data-testid="coverage-clean" style={{ marginTop: 8 }}>
          No wasted budget on the fields we could read.
        </p>
      )}
    </div>
  );
}
