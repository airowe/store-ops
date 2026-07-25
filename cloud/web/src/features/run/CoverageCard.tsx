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
import type { CoverageReport, CoverageWaste } from "@shipaso/api";

/**
 * #322: the field(s) a wasted term lives in — the customer's first question
 * ("which field is 'for' in?"), which the page previously never answered.
 * Renders nothing when the run carries no attribution (a run persisted before
 * #322): an unknown field is shown as absent, never guessed.
 */
function WasteFields({ w, index }: { w: CoverageWaste; index: number }) {
  if (!w.fields || w.fields.length === 0) return null;
  return (
    <span className="waste-fields" data-testid={`waste-fields-${index}`}>
      {w.fields.map((f) => (
        <span key={f} className="waste-field-chip">
          {f}
        </span>
      ))}
    </span>
  );
}

export function CoverageCard({ coverage }: { coverage: CoverageReport }) {
  const { coverageScore, fieldFill, distinctTerms, waste, keywordFieldStrip } = coverage;
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
            <div key={`${w.kind}-${i}`} className="waste-item">
              <p className="micro" style={{ margin: "2px 0 0" }}>
                {w.detail} — {w.chars} char{w.chars === 1 ? "" : "s"}
              </p>
              <p className="micro" style={{ margin: "2px 0 0" }}>
                <WasteFields w={w} index={i} />
                {/* Only keyword-field filler is safe to strip: Apple ignores it
                    for ranking there, so removing it costs no readability. */}
                {w.safeToStrip ? (
                  <span className="waste-safe" data-testid={`waste-safe-${i}`}>
                    safe to strip
                  </span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="micro muted" data-testid="coverage-clean" style={{ marginTop: 8 }}>
          No wasted budget on the fields we could read.
        </p>
      )}

      {/* #322: the safe keyword-field tightening, SHOWN as a before/after the
          way the auto-fixed duplicate is shown in the copy diff. Deliberately
          phrased as a proposal — nothing here has been applied, and this card
          never writes. Absent when there's nothing safe to reclaim. */}
      {keywordFieldStrip ? (
        <div className="keyword-strip" data-testid="keyword-strip" style={{ marginTop: 10 }}>
          <p className="micro muted" style={{ margin: 0 }}>
            Safe to reclaim in your keyword field — {keywordFieldStrip.reclaimedChars} char
            {keywordFieldStrip.reclaimedChars === 1 ? "" : "s"}, no change to what customers read.
          </p>
          <div className="diffcols" style={{ marginTop: 6 }}>
            <div className="diffside was">
              <span className="strike">{keywordFieldStrip.before}</span>
            </div>
            <div className="darrow">→</div>
            <div className="diffside now">{keywordFieldStrip.after}</div>
          </div>
          <p className="micro" style={{ margin: "6px 0 0" }}>
            Drops{" "}
            {keywordFieldStrip.removed.map((t) => (
              <span key={t} className="kwchip removed">
                {t}
              </span>
            ))}
          </p>
          <p className="micro muted" style={{ margin: "4px 0 0" }}>
            Apple ignores these for ranking in the keyword field. Approve the run to include this.
          </p>
        </div>
      ) : null}
    </div>
  );
}
