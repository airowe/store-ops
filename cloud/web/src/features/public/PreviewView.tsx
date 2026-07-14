/**
 * Preview — try-before-signup. Audit any live listing on real data; sign in only
 * when you want to RUN the fix (signup gated at value, mirroring the legacy
 * route() logic — not a cold login wall). Honest: shows the real preview audit;
 * no inflated grade.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, Candidate, PreviewResult } from "@shipaso/api";
import { preview } from "@shipaso/api";

export function PreviewView({ client, onSignIn }: { client: ApiClient; onSignIn: () => void }) {
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

  const search = useMutation({ mutationFn: (q: string) => preview(client, { query: q }), onSuccess: apply });
  const pick = useMutation({ mutationFn: (bundle_id: string) => preview(client, { bundle_id }), onSuccess: apply });

  return (
    <section>
      <h1>Try it — free, no signup</h1>
      <p className="muted">Audit any live App Store listing on real data. Sign in only when you want to run the fix.</p>

      <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
        <input
          className="txt"
          data-testid="preview-query"
          value={query}
          placeholder="App name or bundle id"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn" data-testid="preview-search" disabled={!query.trim() || search.isPending} onClick={() => search.mutate(query.trim())}>
          {search.isPending ? "Auditing…" : "Audit"}
        </button>
      </div>

      {note ? <p className="faint" style={{ marginTop: 8 }}>{note}</p> : null}

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
          <b>Audit preview</b>
          {result.grade ? <span className="grade" data-testid="preview-grade">{result.grade}</span> : null}
          {result.summary ? <p className="muted">{result.summary}</p> : null}
          {result.findings?.length ? (
            <ul>
              {result.findings.slice(0, 5).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
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
    </section>
  );
}
