/**
 * Run detail — THE money screen. The proposed-copy diff is always visible; the
 * approval gate is the one irreversible human step. Honesty, load-bearing:
 *   • approval only REVEALS the push commands — nothing has shipped. The status
 *     reads "Approved · ready to push", NEVER "Shipped" (legacy `shipped` too).
 *   • push commands are copy targets, NEVER executed here (no auto-push).
 *   • pushCommands stays [] until approval (server boundary).
 * Client + id injected for testability.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, decideRun, getRun } from "@shipaso/api";
import type { RunDetail } from "@shipaso/api";
import { CopyDiff } from "./CopyDiff.js";

export function RunView({ client, id }: { client: import("@shipaso/api").ApiClient; id: string }) {
  const qc = useQueryClient();
  const runQ = useQuery({ queryKey: ["run", id], queryFn: () => getRun(client, id) });
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => decideRun(client, id, d),
    // The decision is a SLIM partial (no `result`/`currentCopy`) — MERGE it onto
    // the cached RunDetail. Replacing outright dropped `result` and crashed the
    // diff on re-render. currentCopy is preserved; status + the revealed
    // pushCommands + any finalized proposedCopy are updated.
    onSuccess: (decision) =>
      qc.setQueryData<RunDetail>(["run", id], (prev) =>
        prev
          ? {
              ...prev,
              status: decision.status,
              result: {
                ...prev.result,
                ...(decision.proposedCopy ? { proposedCopy: decision.proposedCopy } : {}),
                pushCommands: decision.pushCommands,
              },
            }
          : prev,
      ),
  });

  if (runQ.isLoading) return <p className="muted">Loading run…</p>;
  if (runQ.isError || !runQ.data || !runQ.data.result)
    return <p className="muted">Couldn’t load this run.</p>;

  const run = runQ.data;
  const approved = run.status === "approved" || run.status === "shipped";
  const rejected = run.status === "rejected";
  const pending = !approved && !rejected;
  const r = run.result;
  const tierLimited = decide.error instanceof ApiError && decide.error.isTierLimit;

  return (
    <section>
      <h1>Proposed changes</h1>
      <CopyDiff current={r.currentCopy} proposed={r.proposedCopy} />

      {pending ? (
        <div className="btn-row" style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn primary" data-testid="approve" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            {decide.isPending ? "Approving…" : "Approve"}
          </button>
          <button className="btn ghost" data-testid="reject" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
            Reject
          </button>
        </div>
      ) : (
        <p className={"run-status" + (approved ? " good" : "")} data-testid="run-status">
          {approved ? "Approved · ready to push" : "Rejected"}
        </p>
      )}

      {tierLimited ? (
        <p className="muted" data-testid="tier-limit">
          You’ve hit your plan’s run limit — upgrade to approve more.
        </p>
      ) : null}

      {approved && r.pushCommands.length > 0 ? (
        <div className="card handoff" data-testid="handoff">
          <b>Handoff commands</b>
          <p className="micro">
            Run these yourself — ShipASO never pushes to a live store. Approval reveals them; nothing has shipped yet.
          </p>
          {r.pushCommands.map((c, i) => (
            <div key={i} className="cmd-block">
              <p className="micro">
                <span className={"store-tag " + c.store}>{c.store}</span> {c.description}
              </p>
              <pre>{c.command}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
