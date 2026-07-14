/**
 * Competitor management (#72) — previously curl-only. Discover candidates from
 * the app's tracked keywords + Apple's "similar apps" shelf, add one by name,
 * and confirm / dismiss / remove. Honest: a SUGGESTED competitor is never
 * silently watched — only CONFIRMED rows feed runs and the sweep; the human
 * confirms. Discovery's note (e.g. "no tracked keywords yet") is shown verbatim.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, CompetitorsResponse } from "@shipaso/api";
import { addCompetitor, confirmCompetitor, discoverCompetitors, getCompetitors, removeCompetitor } from "@shipaso/api";

export function CompetitorsCard({ client, appId }: { client: ApiClient; appId: string }) {
  const qc = useQueryClient();
  const key = ["competitors", appId];
  const listQ = useQuery({ queryKey: key, queryFn: () => getCompetitors(client, appId) });
  const [name, setName] = useState("");

  // Every mutation returns the fresh list — write it straight to the cache.
  const onList = (r: CompetitorsResponse) => qc.setQueryData(key, r);
  const discover = useMutation({ mutationFn: () => discoverCompetitors(client, appId), onSuccess: onList });
  const add = useMutation({ mutationFn: (n: string) => addCompetitor(client, appId, { name: n }), onSuccess: (r) => { onList(r); setName(""); } });
  const confirm = useMutation({ mutationFn: (k: string) => confirmCompetitor(client, appId, k), onSuccess: onList });
  const remove = useMutation({ mutationFn: (k: string) => removeCompetitor(client, appId, k), onSuccess: onList });

  if (listQ.isLoading || !listQ.data) return null;
  const all = listQ.data.competitors;
  const confirmed = all.filter((c) => c.status === "confirmed");
  const suggested = all.filter((c) => c.status !== "confirmed");
  const busy = discover.isPending || add.isPending || confirm.isPending || remove.isPending;

  return (
    <div className="card" data-testid="competitors-card">
      <b>Competitors</b>
      <p className="micro">
        Only <b>confirmed</b> competitors feed your runs — suggestions wait for you.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input data-testid="comp-name" placeholder="Add by app name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn" data-testid="comp-add" disabled={busy || !name.trim()} onClick={() => add.mutate(name.trim())}>Add</button>
        <button type="button" className="btn ghost" data-testid="comp-discover" disabled={busy} onClick={() => discover.mutate()}>
          {discover.isPending ? "Discovering…" : "Discover"}
        </button>
      </div>
      {discover.data?.note ? <p className="micro" data-testid="comp-note">{discover.data.note}</p> : null}

      {confirmed.length > 0 ? (
        <div data-testid="comp-confirmed" style={{ marginTop: 8 }}>
          {confirmed.map((c) => (
            <div key={c.key} className="setting-row" data-testid={`comp-${c.key}`}>
              <span style={{ flex: 1 }}>{c.name}</span>
              <button type="button" className="btn bad" data-testid={`comp-remove-${c.key}`} disabled={busy} onClick={() => remove.mutate(c.key)}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}

      {suggested.length > 0 ? (
        <div data-testid="comp-suggested" style={{ marginTop: 8 }}>
          <p className="micro">Suggested — confirm to start watching:</p>
          {suggested.map((c) => (
            <div key={c.key} className="setting-row" data-testid={`comp-${c.key}`}>
              <span style={{ flex: 1 }}>{c.name} <span className="micro">({c.source})</span></span>
              <button type="button" className="btn" data-testid={`comp-confirm-${c.key}`} disabled={busy} onClick={() => confirm.mutate(c.key)}>Confirm</button>
              <button type="button" className="btn ghost" data-testid={`comp-dismiss-${c.key}`} disabled={busy} onClick={() => remove.mutate(c.key)}>Dismiss</button>
            </div>
          ))}
        </div>
      ) : null}

      {all.length === 0 ? <p className="faint" data-testid="comp-empty">No competitors yet — add one or discover from your keywords.</p> : null}
    </div>
  );
}
