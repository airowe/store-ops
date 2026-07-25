/**
 * Settings — comms prefs, autonomy, connections, agent access, stored keys,
 * appearance, account. Faithful to the mobile `(app)/settings.tsx`. Honesty,
 * verbatim: prefs change what gets SENT, never what the agent does; a pref is
 * never shown "on" when it isn't; stored keys show METADATA only and delete
 * honestly.
 *
 * The send-vs-do distinction is the spine of this view and it is carried
 * visually, not just in prose: Communications wears a neutral "changes what we
 * send" pill, Autonomy wears an amber "changes what the agent does" pill and
 * sits forward on a shadow. Amber, not red — autonomy is a supported state.
 *
 * The client is injected so the whole view is render-testable with a fake.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient, RankCadence } from "@shipaso/api";
import { deleteCredential, getCredentials, logout, me, pauseAgent, resumeAgent, setNotifications, setRankCadence } from "@shipaso/api";
import { GithubCard } from "./GithubCard.js";
import { AsaCard } from "./AsaCard.js";
import { ApiKeysCard } from "./ApiKeysCard.js";

type Prefs = { push: boolean; digest: boolean; cadence: RankCadence; paused: boolean };
type Theme = "light" | "dark";

const SECTIONS = [
  { id: "comms", label: "Communications" },
  { id: "autonomy", label: "Autonomy" },
  { id: "connections", label: "Connections" },
  { id: "agent", label: "Agent access" },
  { id: "keys", label: "Stored keys" },
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
] as const;

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function setTheme(next: Theme) {
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
  const [theme, setThemeState] = useState<Theme>(readTheme);
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

  // These reconcile from the server's RESPONSE rather than invalidating a query
  // — the write returns the authoritative row, so there is nothing stale to
  // refetch. react-doctor's query-mutation-missing-invalidation flags this shape
  // (it only looks for invalidateQueries/setQueryData in the options), but
  // adding an invalidation here would just refetch data we already hold.
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
    mutationFn: (kind: "asc" | "play" | "asa") => deleteCredential(client, kind),
    onSuccess: () => void credsQ.refetch(),
  });
  const pauseMut = useMutation({
    mutationFn: (next: boolean) => (next ? pauseAgent(client) : resumeAgent(client)),
    onSuccess: (r) => setPrefs((p) => (p ? { ...p, paused: r.paused } : p)),
  });
  const signOutMut = useMutation({ mutationFn: () => logout(client), onSuccess: () => onSignedOut?.() });

  if (!prefs) return <p className="muted">Loading settings…</p>;
  const creds = credsQ.data?.credentials ?? [];

  const applyTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav" data-testid="page-nav" aria-label="On this page">
        <span className="settings-nav-eyebrow">On this page</span>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
            {s.id === "autonomy" ? (
              <span
                className={`settings-nav-dot ${prefs.paused ? "is-paused" : "is-active"}`}
                data-testid="autonomy-nav-dot"
              />
            ) : null}
          </a>
        ))}
      </nav>

      <section>
        <Panel
          id="comms"
          title="Communications"
          pill={{ text: "Changes what we send", testId: "comms-scope-pill" }}
          sub="These change what reaches your inbox and phone — never what the agent does. Runs still open either way."
        >
          <Row
            title="Run-ready push"
            detail={
              prefs.push
                ? "We’ll notify you when a run awaits your approval."
                : "ShipASO stops sending; runs still open."
            }
            action={
              <button
                type="button"
                className={`pref-toggle${prefs.push ? " is-on" : ""}`}
                data-testid="push-toggle"
                onClick={() => pushMut.mutate(!prefs.push)}
              >
                {prefs.push ? "On" : "Off"}
              </button>
            }
          />
          <Row
            title="Weekly digest email"
            detail="The agent keeps working and runs keep opening regardless."
            action={
              <button
                type="button"
                className={`pref-toggle${prefs.digest ? " is-on" : ""}`}
                data-testid="digest-toggle"
                onClick={() => digestMut.mutate(!prefs.digest)}
              >
                {prefs.digest ? "On" : "Off"}
              </button>
            }
          />
          <Row
            title="Rank checks"
            detail="How often we snapshot your ranks. Data collection — not email frequency."
            action={
              <span className="segmented">
                <button
                  type="button"
                  className={prefs.cadence === "weekly" ? "is-on" : ""}
                  data-testid="cadence-weekly"
                  onClick={() => cadenceMut.mutate("weekly")}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  className={prefs.cadence === "daily" ? "is-on" : ""}
                  data-testid="cadence-daily"
                  onClick={() => cadenceMut.mutate("daily")}
                >
                  Daily
                </button>
              </span>
            }
          />
        </Panel>

        <Panel
          id="autonomy"
          title="Autonomy"
          forward
          testId="autonomy-panel"
          pill={{ text: "Changes what the agent does", testId: "autonomy-scope-pill", warn: true }}
          sub="Unlike everything above, this one is not about messages."
        >
          <div
            className={`autonomy-inset ${prefs.paused ? "is-paused" : "is-active"}`}
            data-testid="autonomy-inset"
          >
            <div className="pref-row-main">
              <div className="autonomy-title">
                <span className="autonomy-dot" />
                Weekly autonomous sweep
              </div>
              <div className="pref-row-detail">
                {prefs.paused
                  ? "Paused — no new runs open. Everything you already approved is untouched."
                  : "Active — each week the agent audits, ranks, and drafts a run for your approval. It never pushes."}
              </div>
            </div>
            <button
              type="button"
              className={"btn" + (prefs.paused ? " paused" : " ghost")}
              data-testid="pause-toggle"
              disabled={pauseMut.isPending}
              onClick={() => pauseMut.mutate(!prefs.paused)}
            >
              {pauseMut.isPending ? "…" : prefs.paused ? "Paused" : "Active"}
            </button>
          </div>
          <p className="autonomy-foot">It never pushes. Every run ends at your approval.</p>
        </Panel>

        <Panel
          id="connections"
          title="Connections"
          sub="All optional. Each one adds a path or a data source — none of them lets ShipASO push on its own."
        >
          <GithubCard client={client} />
          <AsaCard client={client} hasAsaKey={creds.some((c) => c.kind === "asa")} />
        </Panel>

        <ApiKeysCard client={client} />

        <Panel
          id="keys"
          title="Stored keys"
          sub="Metadata only — key material is never shown, not even to you. Delete is immediate."
        >
          {creds.length === 0 ? (
            <p className="faint" data-testid="no-keys">
              No stored keys.
            </p>
          ) : (
            creds.map((k) => (
              <div className="pref-row" key={k.id}>
                <span className="key-kind" aria-hidden="true">
                  {k.kind.toUpperCase()}
                </span>
                <div className="pref-row-main">
                  {/* Kind is repeated in the accessible title so the row reads as
                      "ASC · KID123" to a screen reader and to text queries; the
                      chip beside it is the visual treatment of the same fact. */}
                  <div className="pref-row-title mono">{`${k.kind.toUpperCase()} · ${k.keyId || "key"}`}</div>
                  <div className="pref-row-detail">
                    {`added ${k.createdAt.slice(0, 10)}${k.lastUsedAt ? ` · last used ${k.lastUsedAt.slice(0, 10)}` : ""}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn bad"
                  data-testid={`delete-${k.kind}`}
                  onClick={() => delMut.mutate(k.kind)}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </Panel>

        <Panel
          id="appearance"
          title="Appearance"
          sub="Theme for this browser. Light is opt-in; dark is the default."
        >
          <div className="pref-row">
            <div className="pref-row-main">
              <div className="pref-row-title">Theme</div>
            </div>
            <span className="segmented">
              <button
                type="button"
                className={theme === "dark" ? "is-on" : ""}
                data-testid="theme-dark"
                onClick={() => applyTheme("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className={theme === "light" ? "is-on" : ""}
                data-testid="theme-light"
                onClick={() => applyTheme("light")}
              >
                Light
              </button>
            </span>
          </div>
        </Panel>

        <Panel id="account" title="Account">
          <div className="pref-row">
            <div className="pref-row-main">
              {meQ.data?.email ? <span className="account-email">{meQ.data.email}</span> : null}
            </div>
            <button type="button" className="btn ghost" data-testid="sign-out" onClick={() => signOutMut.mutate()}>
              Sign out
            </button>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  id,
  title,
  sub,
  pill,
  forward,
  testId,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  pill?: { text: string; testId: string; warn?: boolean };
  forward?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`settings-panel${forward ? " is-forward" : ""}`}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <div className="settings-panel-head">
        <h2>{title}</h2>
        {pill ? (
          <span className={`scope-pill${pill.warn ? " warn" : ""}`} data-testid={pill.testId}>
            {pill.text}
          </span>
        ) : null}
      </div>
      {sub ? <p className="settings-panel-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

function Row({ title, detail, action }: { title: string; detail: string; action: ReactNode }) {
  return (
    <div className="pref-row">
      <div className="pref-row-main">
        <div className="pref-row-title">{title}</div>
        <div className="pref-row-detail">{detail}</div>
      </div>
      {action}
    </div>
  );
}
