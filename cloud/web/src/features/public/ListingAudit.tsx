/**
 * ListingAudit — the shared try-before-signup audit widget. Audits any live
 * listing on real data and renders the honest result (no inflated grade, an
 * unmeasured rank is "—", never a fabricated number). Mounted in both the
 * landing hero and /preview so the audit logic — including the 404-as-throw
 * error path — lives in exactly one place.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, Candidate, PreviewResult } from "@shipaso/api";
import { preview } from "@shipaso/api";

export function ListingAudit({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [result, setResult] = useState<NonNullable<PreviewResult["preview"]> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function apply(r: PreviewResult) {
    if (r.needsChoice) {
      setCandidates(r.candidates ?? []);
      setResult(null);
      setNote((r.candidates ?? []).length === 0 ? "No apps found. Try a name, store link, or bundle id." : null);
    } else if (r.preview) {
      setResult(r.preview);
      setCandidates(null);
      setNote(null);
    } else {
      setNote(r.error ?? "Couldn’t preview that app.");
    }
  }

  function fail(e: unknown) {
    setCandidates(null);
    setResult(null);
    setNote(e instanceof Error ? e.message : "Couldn’t preview that app.");
  }

  const startFresh = () => setNote(null);

  const search = useMutation({
    mutationFn: (q: string) => preview(client, { query: q }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });
  const pick = useMutation({
    mutationFn: (bundle_id: string) => preview(client, { bundle_id }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="preview-query"
          value={query}
          placeholder="App name or bundle id"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn primary" data-testid="preview-search" disabled={!query.trim() || search.isPending} onClick={() => search.mutate(query.trim())}>
          {search.isPending ? "Auditing…" : "Audit"}
        </button>
      </div>

      {note ? <p className="faint" data-testid="preview-note" style={{ marginTop: 8 }}>{note}</p> : null}

      {candidates?.map((c) => (
        <button
          key={c.bundle_id}
          type="button"
          className="card appcard"
          data-testid={`pcand-${c.bundle_id}`}
          style={{ padding: "10px 12px", marginTop: 6 }}
          onClick={() => pick.mutate(c.bundle_id)}
        >
          <div className="name">{c.name}</div>
          <div className="bundle">{c.bundle_id}</div>
        </button>
      ))}

      {result ? (
        <div className="card" data-testid="preview-result">
          <b>{result.appName || "Audit preview"}</b>
          {result.auditGrade ? (
            <span className="grade" data-testid="preview-grade">{result.auditGrade}</span>
          ) : null}

          <p className="muted" data-testid="preview-summary">
            {result.leadKeyword && result.leadRank != null ? (
              <>
                Ranks <b>#{result.leadRank}</b> for “{result.leadKeyword}” · {result.inTop10} of{" "}
                {result.keywordsChecked} tracked keywords in the top 10.
              </>
            ) : (
              <>Checked {result.keywordsChecked} keywords — none ranking yet.</>
            )}
          </p>

          {result.sample.length ? (
            <div className="difflist" data-testid="preview-sample">
              {result.sample.map((s) => (
                <div key={s.keyword} className="move-row">
                  <span className="kw">{s.keyword}</span>
                  <span className="mono">{s.rank == null ? "—" : `#${s.rank}`}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="asc-unlock" style={{ marginTop: 12 }}>
            <b>Connect &amp; run</b>
            <p className="micro">Sign in to run the fix and prepare the push — your credentials, your machine.</p>
            <button type="button" className="btn primary" data-testid="preview-signin" onClick={onSignIn} style={{ marginTop: 8 }}>
              Sign in to run
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
