/**
 * Owner-only broadcast composer at /broadcast. Token-gated (paste BROADCAST_TOKEN,
 * held in component state only — never persisted). Compose markdown with a live
 * preview (same renderer the email uses), send a test to yourself, then a
 * confirmed send to the whole active list. The browser only ever sees counts.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { broadcastCounts, broadcastTest, broadcastSend } from "@shipaso/api";
import { renderBroadcast } from "../../lib/renderBroadcast.js";

export function BroadcastView({ client }: { client: ApiClient }) {
  const [token, setToken] = useState("");
  const [subject, setSubject] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [testTo, setTestTo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loadRequested, setLoadRequested] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The subscriber count is a READ, so it's a query (keyed by token) — not a
  // mutation. Disabled until the owner clicks "Load list"; that keyed cache is
  // what test/send invalidate after they run, so the shown count stays truthful.
  const countsQ = useQuery({
    queryKey: ["broadcast", "counts", token],
    queryFn: () => broadcastCounts(client, token),
    enabled: loadRequested && !!token,
    retry: false,
  });
  const count = countsQ.data?.active ?? null;

  const test = useMutation({
    mutationFn: () => broadcastTest(client, token, { subject: subject.trim(), markdown: markdown.trim(), to: testTo.trim() }),
    onSuccess: () => setNote("Test sent — check your inbox."),
    onError: () => setNote("Test failed (token or fields)."),
  });
  const send = useMutation({
    mutationFn: () => broadcastSend(client, token, { subject: subject.trim(), markdown: markdown.trim(), confirm: true }),
    // A send changes the list's state — refetch the count so the displayed
    // number reflects reality (this is the cache invalidation the mutation owes).
    onSuccess: (r) => { setNote(`Queued to ${r.queued} subscribers.`); void countsQ.refetch(); },
    onError: () => setNote("Send failed."),
  });

  const preview = renderBroadcast(subject || " ", markdown);
  const canCompose = !!token && !!subject.trim() && !!markdown.trim();

  return (
    <section>
      <h1>Broadcast</h1>
      <p className="muted">Send a launch/newsletter update to the subscriber list. Owner-only.</p>

      <div className="card">
        <b>Owner token</b>
        <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
          <input className="txt" data-testid="bc-token" type="password" value={token} placeholder="BROADCAST_TOKEN" onChange={(e) => setToken(e.target.value)} />
          <button
            type="button"
            className="btn"
            data-testid="bc-load"
            disabled={!token || countsQ.isFetching}
            onClick={() => { setNote(null); loadRequested ? void countsQ.refetch() : setLoadRequested(true); }}
          >
            {countsQ.isFetching ? "Loading…" : "Load list"}
          </button>
        </div>
        {countsQ.isError ? <p className="muted" data-testid="bc-count" style={{ marginTop: 8 }}>Not authorized (check the token).</p> : count != null ? <p className="muted" data-testid="bc-count" style={{ marginTop: 8 }}>{count} active subscribers</p> : null}
      </div>

      <div className="card">
        <b>Compose</b>
        <input className="txt" data-testid="bc-subject" value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 8, width: "100%" }} />
        <textarea className="txt" data-testid="bc-markdown" value={markdown} placeholder="# Heading&#10;&#10;Body in **markdown**…" onChange={(e) => setMarkdown(e.target.value)} rows={8} style={{ marginTop: 8, width: "100%" }} />
        <b style={{ display: "block", marginTop: 12 }}>Preview</b>
        <div className="card" data-testid="bc-preview" style={{ background: "var(--bg-2)" }} dangerouslySetInnerHTML={{ __html: preview.html }} />
      </div>

      <div className="card">
        <b>Send a test to yourself first</b>
        <div style={{ display: "flex", gap: 8, maxWidth: 480, marginTop: 8 }}>
          <input className="txt" data-testid="bc-testto" type="email" value={testTo} placeholder="you@example.com" onChange={(e) => setTestTo(e.target.value)} />
          <button type="button" className="btn" data-testid="bc-test" disabled={!canCompose || !/\S+@\S+\.\S+/.test(testTo) || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Sending…" : "Send test"}
          </button>
        </div>
      </div>

      <div className="card">
        <b>Send to the whole list</b>
        <label style={{ display: "block", margin: "8px 0" }}>
          <input type="checkbox" data-testid="bc-confirm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I've previewed a test and want to send to all active subscribers.
        </label>
        <button type="button" className="btn primary bad" data-testid="bc-send" disabled={!canCompose || !confirmed || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? "Queuing…" : `Send to ${count ?? "the"} subscribers`}
        </button>
      </div>

      {note ? <p className="muted" data-testid="bc-note" style={{ marginTop: 12 }}>{note}</p> : null}
    </section>
  );
}
