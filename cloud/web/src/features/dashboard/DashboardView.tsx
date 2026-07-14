/**
 * Dashboard — the app grid + connect flow. Ported from the legacy viewDashboard
 * and mobile (app)/index. Honest empty + unmeasured states. Client injected for
 * testability; `onOpen` handles cross-surface navigation (an un-migrated app
 * page is served by legacy via a real navigation).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, Candidate } from "@shipaso/api";
import { approveAllRuns, connectApp, getApps, resolveApps } from "@shipaso/api";
import { AppCard } from "./AppCard.js";

export function DashboardView({ client, onOpen }: { client: ApiClient; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const appsQ = useQuery({ queryKey: ["apps"], queryFn: () => getApps(client) });
  const approveAll = useMutation({
    mutationFn: () => approveAllRuns(client),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["apps"] }),
  });

  if (appsQ.isLoading) return <p className="muted">Loading your apps…</p>;
  if (appsQ.isError) return <p className="muted">Couldn’t load your apps. Try again.</p>;
  const apps = appsQ.data?.apps ?? [];
  const pendingCount = apps.filter((a) => a.latest_run?.status === "awaiting_approval").length;

  return (
    <section>
      <h1>Your apps</h1>
      <ConnectCard client={client} onConnected={onOpen} />

      {pendingCount > 1 ? (
        <div className="card" data-testid="approve-all-card">
          <b>{pendingCount} runs awaiting approval</b>
          <p className="micro">
            Approve every pending run at once. Approval only reveals each run’s push handoff —
            it never ships anything.
          </p>
          <button type="button"
            className="btn primary"
            data-testid="approve-all"
            disabled={approveAll.isPending}
            onClick={() => approveAll.mutate()}
          >
            {approveAll.isPending ? "Approving…" : `Approve all ${pendingCount}`}
          </button>
          {approveAll.data ? (
            <p className="micro" data-testid="approve-all-result">
              Approved {approveAll.data.approvedCount} run{approveAll.data.approvedCount === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      ) : null}
      {apps.length === 0 ? (
        <div className="empty" data-testid="empty">
          <div className="big">🛰️</div>
          <div>No apps connected yet.</div>
          <div className="faint">
            Connect one above — the agent audits it, ranks it on real iTunes data, and drafts optimized copy.
          </div>
        </div>
      ) : (
        <div className="grid">
          {apps.map((a) => (
            <AppCard key={a.id} app={a} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectCard({ client, onConnected }: { client: ApiClient; onConnected: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const resolveMut = useMutation({
    mutationFn: (q: string) => resolveApps(client, q),
    onSuccess: (r) => setCandidates(r.candidates),
  });
  const connectMut = useMutation({
    mutationFn: (c: Candidate) => connectApp(client, { bundle_id: c.bundle_id, name: c.name }),
    onSuccess: (r) => {
      if ("id" in r) onConnected(r.id);
      else setCandidates(r.candidates);
    },
  });

  return (
    <div className="card">
      <b>Connect an app</b>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="connect-input"
          value={query}
          placeholder="App name or bundle id"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button"
          className="btn"
          data-testid="connect-search"
          disabled={!query.trim() || resolveMut.isPending}
          onClick={() => resolveMut.mutate(query.trim())}
        >
          Search
        </button>
      </div>
      {candidates?.length === 0 ? <p className="micro">No matches.</p> : null}
      {candidates?.map((c) => (
        <div
          key={c.bundle_id}
          className="card appcard"
          data-testid={`cand-${c.bundle_id}`}
          style={{ padding: "10px 12px", marginTop: 6 }}
          role="button"
          tabIndex={0}
          onClick={() => connectMut.mutate(c)}
        >
          <div className="name">{c.name}</div>
          <div className="bundle">{c.bundle_id}</div>
        </div>
      ))}
    </div>
  );
}
