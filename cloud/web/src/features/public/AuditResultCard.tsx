/**
 * AuditResultCard — the hero's right column: the live audit result on real
 * iTunes data. Honest throughout (the rules the public preview has always
 * carried, just re-laid-out): the grade only shows when the read produced one,
 * an unmeasured rank is "—", and the summary states what was actually checked
 * rather than implying a ranking that wasn't measured.
 *
 * Before an audit runs it renders a quiet placeholder — never a fake sample.
 */
import { formatRank } from "@shipaso/honesty";
import type { PreviewResult } from "@shipaso/api";

type Preview = NonNullable<PreviewResult["preview"]>;

export function AuditResultCard({ result, onSignIn }: { result: Preview | null; onSignIn: () => void }) {
  return (
    <div className="audit-card" data-testid="audit-result-card">
      <div className="audit-card-head">
        <span className="live-dot" aria-hidden="true" />
        Live audit · real iTunes data
      </div>

      {result ? (
        <div className="audit-card-body" data-testid="preview-result">
          <div className="audit-app-row">
            <span className="app-chip signal audit-app-chip">
              {(result.appName?.trim()[0] ?? "·").toUpperCase()}
            </span>
            <div className="audit-app-id">
              <div className="audit-app-name">{result.appName || "Audit preview"}</div>
            </div>
            {result.auditGrade ? (
              <div className="audit-grade-block">
                <div className="audit-grade-label mono">Grade</div>
                <div className="audit-grade-value" data-testid="preview-grade">{result.auditGrade}</div>
              </div>
            ) : null}
          </div>

          <p className="audit-summary" data-testid="preview-summary">
            {result.leadKeyword && result.leadRank != null ? (
              <>
                Ranks <b>#{result.leadRank}</b> for “{result.leadKeyword}” · <b>{result.inTop10} of{" "}
                {result.keywordsChecked}</b> tracked keywords in the top 10.
              </>
            ) : (
              <>Checked {result.keywordsChecked} keywords — none ranking yet.</>
            )}
          </p>

          {result.sample.length ? (
            <div className="audit-sample" data-testid="preview-sample">
              {result.sample.map((s) => (
                <div key={s.keyword} className="audit-sample-row">
                  <span className="audit-sample-kw">{s.keyword}</span>
                  <span className={"audit-sample-rank mono" + (s.rank != null && s.rank <= 10 ? " good" : "")}>
                    {formatRank(s.rank)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="audit-signin">
            <div className="audit-signin-title">See the fix — and run it</div>
            <p className="audit-signin-note">
              Sign in to draft optimized copy and prepare the push. Nothing ships without your approval.
            </p>
            <button type="button" className="btn primary" data-testid="preview-signin" onClick={onSignIn}>
              Sign in to run the fix →
            </button>
          </div>
        </div>
      ) : (
        <div className="audit-card-body audit-card-empty" data-testid="audit-result-empty">
          <p className="audit-empty-copy">
            Audit any live listing to see its real keyword ranks here — grade, lead rank, and what’s
            actually ranking. No signup.
          </p>
        </div>
      )}
    </div>
  );
}
