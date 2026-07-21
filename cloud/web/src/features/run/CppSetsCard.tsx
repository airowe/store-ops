/**
 * CppSetsCard (#154 Part 2) — the paid "generate a CPP set" feature. Clusters the
 * run's tracked keywords into intents and proposes a ShipShots plan per intent
 * (trip-planner CPP leads with the timeline; radar CPP leads with the map).
 * Interactive, read-only: it shows the PROPOSED sets (plans, not pixels — pixels
 * are the local ShipShots render step) and creates nothing (the ASC CPP-create is
 * a separate credentialed step).
 *
 * Honesty: the sparse-data floor is surfaced verbatim ("not enough measured
 * keywords") rather than guessing intents; each set shows its evidence (the
 * intent's keywords); MISSING/needs-review shots are flagged; the verbatim draft
 * label rides on each plan.
 */
import { useMutation } from "@tanstack/react-query";
import { buildCppSets, type ApiClient, type CppSetsInputs, type CppSetsResult } from "@shipaso/api";

export function CppSetsCard({ client, inputs }: { client: ApiClient; inputs: CppSetsInputs }) {
  const sets = useMutation<CppSetsResult>({ mutationFn: () => buildCppSets(client, inputs) });
  const r = sets.data;

  return (
    <div className="card" data-testid="cpp-sets-card">
      <b>Generate Custom Product Page sets</b>
      <p className="micro muted" style={{ margin: "4px 0 0" }}>
        One screenshot set per distinct keyword intent — designed against your measured findings, not blind.
      </p>
      <button
        className="btn"
        data-testid="cpp-sets-btn"
        onClick={() => sets.mutate()}
        disabled={sets.isPending}
        style={{ marginTop: 8 }}
      >
        {sets.isPending ? "Designing…" : "Generate CPP sets"}
      </button>

      {r && !r.ok ? (
        <p className="micro" data-testid="cpp-refusal" style={{ margin: "10px 0 0" }}>
          {r.reason}
        </p>
      ) : null}

      {r && r.ok ? (
        <div style={{ marginTop: 10 }}>
          <p className="micro muted" style={{ margin: "0 0 8px" }}>
            {r.intentsMeasured} measured intent{r.intentsMeasured === 1 ? "" : "s"} → {r.sets.length} proposed set
            {r.sets.length === 1 ? "" : "s"}.
          </p>
          {r.sets.map((set) => (
            <div
              key={set.intent.label}
              data-testid={`cpp-set-${set.intent.label}`}
              style={{ borderTop: "1px solid var(--line, #222a3b)", paddingTop: 8, marginTop: 8 }}
            >
              <b className="micro">Intent: {set.intent.label}</b>
              <p className="micro muted" style={{ margin: "2px 0 0" }}>{set.intent.keywords.join(", ")}</p>
              {set.plan.degraded ? (
                <p className="micro" style={{ margin: "4px 0 0" }}>Deterministic fallback — no model shaped this plan.</p>
              ) : null}
              <p className="micro" style={{ margin: "4px 0 0" }}>{set.plan.narrative}</p>
              <ol className="micro" style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {set.plan.shots.map((s, i) => (
                  <li key={i} style={{ margin: "2px 0 0" }}>
                    <span className="muted">[{s.templateId}]</span>{" "}
                    {s.sourceScreen === "MISSING" ? (
                      <span>
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
                        data-testid={`cpp-review-${set.intent.label}-${i}`}
                        className="micro"
                        style={{ marginLeft: 6, color: "#d97706" }}
                      >
                        ⚠ review
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="micro muted" style={{ margin: "6px 0 0" }}>{set.plan.label}</p>
            </div>
          ))}
          <p className="micro muted" style={{ margin: "8px 0 0" }}>
            Render locally with <code>render-shipshots.py</code>; creating the CPP in App Store Connect stays your explicit step.
          </p>
        </div>
      ) : null}
    </div>
  );
}
