/**
 * Settings — comms prefs, appearance, stored keys, account. Faithful to the
 * mobile `(app)/settings.tsx`. Honesty, verbatim: prefs change what gets SENT,
 * never what the agent does; a pref is never shown "on" when it isn't; stored
 * keys show METADATA only and delete honestly.
 *
 * The client is injected so the whole view is render-testable with a fake.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient, RankCadence } from "@shipaso/api";
import { deleteCredential, getCredentials, logout, me, pauseAgent, resumeAgent, setNotifications, setRankCadence } from "@shipaso/api";
import { GithubCard } from "./GithubCard.js";

type Prefs = { push: boolean; digest: boolean; cadence: RankCadence; paused: boolean };

function setTheme(next: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("store-ops:theme", next);
  } catch {
    /* ignore */
  }
}

export function SettingsView({ client, onSignedOut }: { client: ApiClient; onSignedOut?: () => void }) {
  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => me(client) });
  const credsQ = useQuery({ queryKey: ["account", "credentials"], queryFn: () => getCredentials(client) });

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => {
    if (meQ.data && !prefs) {
      setPrefs({
        push: meQ.data.push_run_ready ?? true,
        digest: (meQ.data.email_digest ?? "weekly") === "weekly",
        cadence: meQ.data.rank_cadence ?? "weekly",
        paused: meQ.data.paused ?? false,
      });
    }
  }, [meQ.data, prefs]);

  const pushMut = useMutation({
    mutationFn: (next: boolean) => setNotifications(client, { push_run_ready: next }),
    onSuccess: (r) => setPrefs((p) => (p ? { ...p, push: r.push_run_ready } : p)),
  });
  const digestMut = useMutation({
    mutationFn: (on: boolean) => setNotifications(client, { email_digest: on ? "weekly" : "off" }),
    onSuccess: (r) => setPrefs((p) => (p ? { ...p, digest: r.email_digest === "weekly" } : p)),
  });
  const cadenceMut = useMutation({
    mutationFn: (c: RankCadence) => setRankCadence(client, c),
    onSuccess: (r) => setPrefs((p) => (p ? { ...p, cadence: r.rank_cadence } : p)),
  });
  const delMut = useMutation({
    mutationFn: (kind: "asc" | "play") => deleteCredential(client, kind),
    onSuccess: () => void credsQ.refetch(),
  });
  const pauseMut = useMutation({
    mutationFn: (next: boolean) => (next ? pauseAgent(client) : resumeAgent(client)),
    onSuccess: (r) => setPrefs((p) => (p ? { ...p, paused: r.paused } : p)),
  });
  const signOutMut = useMutation({ mutationFn: () => logout(client), onSuccess: () => onSignedOut?.() });

  if (!prefs) return <p className="muted">Loading settings…</p>;
  const creds = credsQ.data?.credentials ?? [];

  return (
    <section>
      <h1>Settings</h1>

      <div className="card">
        <b>Communications</b>
        <p className="micro">These change what we send — never what the agent does.</p>

        <Row
          title="Run-ready push"
          detail={
            prefs.push
              ? "We’ll notify you when a run awaits your approval."
              : "ShipASO stops sending; runs still open."
          }
          action={
            <button className="btn ghost" data-testid="push-toggle" onClick={() => pushMut.mutate(!prefs.push)}>
              {prefs.push ? "On" : "Off"}
            </button>
          }
        />
        <Row
          title="Weekly digest email"
          detail="The agent keeps working and runs keep opening regardless."
          action={
            <button className="btn ghost" data-testid="digest-toggle" onClick={() => digestMut.mutate(!prefs.digest)}>
              {prefs.digest ? "On" : "Off"}
            </button>
          }
        />
        <Row
          title="Rank checks"
          detail="How often we snapshot your ranks. Data collection — not email frequency."
          action={
            <span style={{ display: "flex", gap: 6 }}>
              <button
                className={"btn" + (prefs.cadence === "weekly" ? "" : " ghost")}
                data-testid="cadence-weekly"
                onClick={() => cadenceMut.mutate("weekly")}
              >
                Weekly
              </button>
              <button
                className={"btn" + (prefs.cadence === "daily" ? "" : " ghost")}
                data-testid="cadence-daily"
                onClick={() => cadenceMut.mutate("daily")}
              >
                Daily
              </button>
            </span>
          }
        />
      </div>

      <div className="card">
        <b>Autonomy</b>
        <p className="micro">Unlike the settings above, this changes what the agent does.</p>
        <Row
          title="Weekly autonomous sweep"
          detail={
            prefs.paused
              ? "Paused — no new runs open. Everything you already approved is untouched."
              : "Active — each week the agent audits, ranks, and drafts a run for your approval. It never pushes."
          }
          action={
            <button
              className={"btn" + (prefs.paused ? " bad" : " ghost")}
              data-testid="pause-toggle"
              disabled={pauseMut.isPending}
              onClick={() => pauseMut.mutate(!prefs.paused)}
            >
              {pauseMut.isPending ? "…" : prefs.paused ? "Paused" : "Active"}
            </button>
          }
        />
      </div>

      <div className="card">
        <b>Appearance</b>
        <p className="micro">Theme for this browser. Light is opt-in; dark is the default.</p>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost" data-testid="theme-light" onClick={() => setTheme("light")}>Light</button>
          <button className="btn ghost" data-testid="theme-dark" onClick={() => setTheme("dark")}>Dark</button>
        </span>
      </div>

      <GithubCard client={client} />

      <div className="card">
        <b>Stored keys</b>
        <p className="micro">Metadata only — key material is never shown. Delete is immediate.</p>
        {creds.length === 0 ? (
          <p className="faint" data-testid="no-keys">No stored keys.</p>
        ) : (
          creds.map((k) => (
            <Row
              key={k.id}
              title={`${k.kind.toUpperCase()} · ${k.keyId || "key"}`}
              detail={`added ${k.createdAt.slice(0, 10)}${k.lastUsedAt ? ` · last used ${k.lastUsedAt.slice(0, 10)}` : ""}`}
              action={
                <button className="btn bad" data-testid={`delete-${k.kind}`} onClick={() => delMut.mutate(k.kind)}>
                  Delete
                </button>
              }
            />
          ))
        )}
      </div>

      <div className="card">
        <b>Account</b>
        {meQ.data?.email ? <p className="micro">{meQ.data.email}</p> : null}
        <button className="btn ghost" data-testid="sign-out" onClick={() => signOutMut.mutate()}>
          Sign out
        </button>
      </div>
    </section>
  );
}

function Row({ title, detail, action }: { title: string; detail: string; action: ReactNode }) {
  return (
    <div className="setting-row">
      <div style={{ flex: 1 }}>
        <div>{title}</div>
        <div className="micro">{detail}</div>
      </div>
      {action}
    </div>
  );
}
