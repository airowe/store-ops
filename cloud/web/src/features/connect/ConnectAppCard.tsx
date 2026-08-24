/**
 * Connect an app — search by name/bundle id, then pick from the resolved
 * candidates. Shared by the dashboard's add-another path and onboarding step 2,
 * so there is ONE connect implementation rather than two that drift.
 *
 * The pick-list is the honest half: `POST /apps` answers an ambiguous query
 * with `{ needsChoice, candidates }` rather than guessing, and we re-offer the
 * choices instead of connecting whatever matched first.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, Candidate } from "@shipaso/api";
import { resolveApps, connectApp } from "@shipaso/api";

export function ConnectAppCard({
  client,
  onConnected,
  heading = "Connect an app",
}: {
  client: ApiClient;
  onConnected: (id: string) => void;
  /** Overridable so onboarding can ask its own question ("Which app?"). */
  heading?: string;
}) {
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
      <b>{heading}</b>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="connect-input"
          value={query}
          placeholder="App name or bundle id"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
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
        <button
          key={c.bundle_id}
          type="button"
          className="card appcard"
          data-testid={`cand-${c.bundle_id}`}
          style={{ padding: "10px 12px", marginTop: 6 }}
          onClick={() => connectMut.mutate(c)}
        >
          <div className="name">{c.name}</div>
          <div className="bundle">{c.bundle_id}</div>
        </button>
      ))}
    </div>
  );
}
