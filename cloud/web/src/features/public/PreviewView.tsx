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
        <button className="btn" data-testid="preview-search" disabled={!query.trim() || search.isPending} onClick={() => search.mutate(query.trim())}>
          {search.isPending ? "Auditing…" : "Audit"}
        </button>
      </div>

      {note ? <p className="faint" style={{ marginTop: 8 }}>{note}</p> : null}

      {candidates?.map((c) => (
        <div
          key={c.bundle_id}
          className="card appcard"
          data-testid={`pcand-${c.bundle_id}`}
          style={{ padding: "10px 12px", marginTop: 6 }}
          role="button"
          tabIndex={0}
          onClick={() => pick.mutate(c.bundle_id)}
        >
          <div className="name">{c.name}</div>
          <div className="bundle">{c.bundle_id}</div>
        </div>
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
                  {/* An unmeasured rank is "—", never a fabricated number. */}
                  <span className="mono">{s.rank == null ? "—" : `#${s.rank}`}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="asc-unlock" style={{ marginTop: 12 }}>
            <b>Connect &amp; run</b>
            <p className="micro">Sign in to run the fix and prepare the push — your credentials, your machine.</p>
            <button className="btn primary" data-testid="preview-signin" onClick={onSignIn} style={{ marginTop: 8 }}>
              Sign in to run
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
