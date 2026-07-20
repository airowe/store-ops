/**
 * ScreenshotPlanCard (#153 ShipShots) — plan a corrected screenshot SET from the
 * run's audit findings. Interactive: clicking asks the planner (POST
 * /plan/screenshots) and renders the returned plan. It shows the PLAN, never
 * pixels — rendering is the local `render-shipshots.py` step, and nothing ships
 * from here (the standing "nothing ships hosted" posture).
 *
 * Honesty, load-bearing: a MISSING shot is shown as a labeled gap with its
 * reason (never a fabricated screen); a bad headline is a needs-review badge, not
 * silently dropped; the verbatim draft label and the `degraded` (fallback) notice
 * are always surfaced so nobody mistakes a draft/deterministic plan for a verdict.
 */
import { useMutation } from "@tanstack/react-query";
import { planScreenshots, type ApiClient, type ScreenshotPlan, type ScreenshotPlanInputs } from "@shipaso/api";

export function ScreenshotPlanCard({ client, inputs }: { client: ApiClient; inputs: ScreenshotPlanInputs }) {
  const plan = useMutation<ScreenshotPlan>({ mutationFn: () => planScreenshots(client, inputs) });
  const p = plan.data;

  return (
    <div className="card" data-testid="screenshot-plan-card">
      <b>Plan a screenshot set</b>
      <p className="micro muted" style={{ margin: "4px 0 0" }}>
        Turn this run’s screenshot findings into a shot-by-shot plan you render locally.
      </p>
      <button
        className="btn"
        data-testid="plan-screenshots-btn"
        onClick={() => plan.mutate()}
        disabled={plan.isPending}
        style={{ marginTop: 8 }}
      >
        {plan.isPending ? "Planning…" : "Plan screenshots"}
      </button>

      {p ? (
        <div style={{ marginTop: 10 }}>
          {p.degraded ? (
            <p className="micro" data-testid="plan-degraded" style={{ margin: "0 0 6px" }}>
              Deterministic fallback — no model shaped this plan.
            </p>
          ) : null}
          <p className="micro" data-testid="plan-narrative" style={{ margin: "0 0 6px" }}>
            {p.narrative}
          </p>
          <ol className="micro" data-testid="plan-shots" style={{ margin: 0, paddingLeft: 18 }}>
            {p.shots.map((s, i) => (
              <li key={i} style={{ margin: "3px 0 0" }}>
                <span className="muted">[{s.templateId}]</span>{" "}
                {s.sourceScreen === "MISSING" ? (
                  <span data-testid={`shot-missing-${i}`}>
                    <b>MISSING</b> — {s.missingReason ?? "no captured screen"}
                  </span>
                ) : (
                  <span>
                    {s.headline || <i className="muted">(no headline)</i>}{" "}
                    <span className="muted">← {s.sourceScreen}</span>
                  </span>
                )}
                {s.needsReview ? (
                  <span
                    data-testid={`shot-review-${i}`}
                    className="micro"
                    style={{ marginLeft: 6, color: "#d97706" }}
                  >
                    ⚠ review{s.headlineIssue ? `: ${s.headlineIssue}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="micro muted" data-testid="plan-label" style={{ margin: "8px 0 0" }}>
            {p.label}
          </p>
          <p className="micro muted" style={{ margin: "4px 0 0" }}>
            Render locally: <code>render-shipshots.py --plan plan.json --out out/</code>, then upload with{" "}
            <code>asc screenshots upload</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
