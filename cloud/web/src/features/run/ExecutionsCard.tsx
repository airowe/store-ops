/**
 * What autopilot did with this run, step by step (migration 0017). Shown on
 * approved and shipped runs. "Shipped" is never a bare badge: the ledger
 * beneath it says which step reached Apple, which was skipped and why, and
 * which failed. A run quarantined because it was approved before the switch
 * existed offers "Execute now"; a run already attempted does not, because its
 * ledger is for reading, not redoing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, RunExecution } from "@shipaso/api";
import { executeRun, getRunExecutions } from "@shipaso/api";

const PRE_AUTOPILOT = /approved before autopilot was turned on/;

function stepLabel(step: string): string {
  if (step === "gate") return "Gate";
  if (step === "version") return "Editable version";
  if (step === "metadata") return "Metadata";
  if (step.startsWith("locale:")) return `Locale ${step.slice(7)}`;
  if (step === "screenshots") return "Screenshots";
  if (step === "experiment") return "Experiment";
  return step;
}

export function ExecutionsCard({ client, runId, status }: { client: ApiClient; runId: string; status: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["run", runId, "executions"], queryFn: () => getRunExecutions(client, runId) });
  const exec = useMutation({
    mutationFn: () => executeRun(client, runId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["run", runId, "executions"] });
      void qc.invalidateQueries({ queryKey: ["run", runId] });
    },
  });

  const rows: RunExecution[] = q.data?.executions ?? [];
  const quarantined = rows.length > 0 && rows.every((r) => r.step === "gate" && r.status === "skipped" && PRE_AUTOPILOT.test(r.detail));
  const canExecute = status === "approved" && (rows.length === 0 || quarantined);

  return (
    <div className="card" data-testid="executions-card">
      <div className="card-head">
        <h2>What the agent did</h2>
        {canExecute ? (
          <button type="button" className="btn primary" data-testid="execute-now" disabled={exec.isPending} onClick={() => exec.mutate()}>
            {exec.isPending ? "Executing…" : "Execute now"}
          </button>
        ) : null}
      </div>
      {q.isError ? (
        <p className="faint" data-testid="executions-unavailable">
          The execution ledger could not be loaded.
        </p>
      ) : rows.length === 0 ? (
        <p className="faint" data-testid="executions-empty">
          {status === "approved"
            ? "Nothing has been pushed. With autopilot on, the agent will run this approval; or run it now."
            : "No execution recorded for this run."}
        </p>
      ) : (
        <ul className="exec-list" data-testid="executions-list">
          {rows.map((r) => (
            <li key={r.id} className={`exec-row is-${r.status}`} data-testid={`exec-${r.step}`}>
              <span className="exec-step">{stepLabel(r.step)}</span>
              <span className={`status-pill${r.status === "done" ? " is-on" : r.status === "failed" ? " bad" : ""}`}>{r.status}</span>
              <span className="exec-detail">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {exec.isError ? (
        <p className="conn-note" data-testid="execute-error">
          {exec.error instanceof Error ? exec.error.message : "Could not execute this run."}
        </p>
      ) : null}
      <p className="faint">Screenshots and experiments are never pushed from here. Nothing is submitted for review.</p>
    </div>
  );
}
