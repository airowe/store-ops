/**
 * "Run a free A/B test" — the proposed Product Page Optimization treatment brief
 * (#182 Phase 3). Present only on a keyed run with no PPO test currently running;
 * the server computes + serves it on the run result.
 *
 * Honesty, load-bearing:
 *   • it's a RECOMMENDATION, never a claim about your numbers — the evidence line
 *     is a CITED public PPO result, rendered as such,
 *   • the guidance (run up to ~90 days / confidence threshold) is shown verbatim
 *     so nobody reads an early result as a verdict,
 *   • the ASC deep link only renders when the server knew the app id.
 * Pure presentational; data arrives from the run detail response.
 */
import type { PpoTreatmentPlan } from "@shipaso/api";

export function PpoTreatmentCard({ plan }: { plan: PpoTreatmentPlan }) {
  return (
    <div className="card" data-testid="ppo-treatment-card">
      <b>{plan.headline}</b>
      <ol className="micro" data-testid="ppo-steps" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {plan.steps.map((s, i) => (
          <li key={i} style={{ margin: "2px 0 0" }}>{s}</li>
        ))}
      </ol>
      <p className="micro muted" data-testid="ppo-evidence" style={{ margin: "6px 0 0" }}>{plan.evidence}</p>
      <p className="micro" data-testid="ppo-guidance" style={{ margin: "4px 0 0" }}>{plan.guidance}</p>
      {plan.ascUrl ? (
        <p className="micro" style={{ margin: "6px 0 0" }}>
          <a href={plan.ascUrl} target="_blank" rel="noreferrer" data-testid="ppo-asc-link">
            Set it up in App Store Connect →
          </a>
        </p>
      ) : null}
    </div>
  );
}
