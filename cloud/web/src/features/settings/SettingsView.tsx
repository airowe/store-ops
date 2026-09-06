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
import { AscKeyCard } from "./AscKeyCard.js";
import { AutopilotRows } from "./AutopilotRows.js";
import { ApiKeysCard } from "./ApiKeysCard.js";
import { ChannelsCard } from "./ChannelsCard.js";
import { applyTheme, storedMode, storeMode, type ThemeMode } from "../../shell/theme.js";

type Prefs = { push: boolean; digest: boolean; cadence: RankCadence; paused: boolean; ascWrites: boolean; autopilot: boolean };

const SECTIONS = [
  { id: "comms", label: "Communications" },
  { id: "autonomy", label: "Autonomy" },
  { id: "connections", label: "Connections" },
  { id: "agent", label: "Agent access" },
  { id: "keys", label: "Stored keys" },
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
] as const;

/**
 * Theme state lives in `shell/theme.ts` (#362) — three modes, `system` by
 * default, resolved against the OS. This view reads and writes the PREFERENCE;
 * it no longer derives the mode from the painted attribute, which could not
 * distinguish "chose dark" from "system, and the OS is dark".
 */
function setTheme(next: ThemeMode) {
  storeMode(next);
  applyTheme(next);
}

/**
 * Theme lives in this browser, not the account, so it is the one setting that
 * stays answerable with no session — which is why it is shared between the
 * signed-in page and the signed-out one rather than duplicated.
 */
function ThemePanel({ theme, pickTheme }: { theme: ThemeMode; pickTheme: (m: ThemeMode) => void }) {
  return (
    <Panel
      id="appearance"
      title="Appearance"
      sub="Theme for this browser. System follows your OS setting and changes with it."
    >
      <div className="pref-row">
        <div className="pref-row-main">
          <div className="pref-row-title">Theme</div>
        </div>
        <span className="segmented">
          <button
            type="button"
            className={theme === "system" ? "is-on" : ""}
            data-testid="theme-system"
            onClick={() => pickTheme("system")}
          >
            System
          </button>
          <button
            type="button"
            className={theme === "dark" ? "is-on" : ""}
            data-testid="theme-dark"
            onClick={() => pickTheme("dark")}
          >
            Dark
          </button>
          <button
            type="button"
            className={theme === "light" ? "is-on" : ""}
            data-testid="theme-light"
            onClick={() => pickTheme("light")}
          >
            Light
          </button>
        </span>
      </div>
    </Panel>
  );
}

export function SettingsView({ client, onSignedOut }: { client: ApiClient; onSignedOut?: () => void }) {
  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => me(client) });
  const credsQ = useQuery({ queryKey: ["account", "credentials"], queryFn: () => getCredentials(client) });

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  // The stored PREFERENCE, not the painted scheme: "system" must stay
  // distinguishable from an explicit choice that happens to match the OS.
  const [theme, setThemeState] = useState<ThemeMode>(storedMode);
  useEffect(() => {
    if (meQ.data && !prefs) {
      setPrefs({
        push: meQ.data.push_run_ready ?? true,
        digest: (meQ.data.email_digest ?? "weekly") === "weekly",
        cadence: meQ.data.rank_cadence ?? "weekly",
        paused: meQ.data.paused ?? false,
        ascWrites: meQ.data.asc_write_opt_in ?? false,
        autopilot: meQ.data.autopilot_execute ?? false,
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

  const pickTheme = (next: ThemeMode) => {
    setTheme(next);
    setThemeState(next);
  };

  // `/auth/me` answers {authed:false} for a signed-out visitor — a truthy
  // object, so seeding from it and falling back through `??` painted "On",
  // "On" and "Active" as though they were this person's settings. They belong
  // to nobody. Measured-or-nothing applies to a preference exactly as it does
  // to a rank: state it, or say it is not there.
  //
  // Appearance survives because the theme lives in this browser, not the
  // account, so it is the one thing on this page still honestly answerable.
  if (meQ.data && meQ.data.authed === false) {
    return (
      <div className="settings-layout">
        <section>
          <div className="panel" data-testid="settings-signed-out">
            <h2>Settings</h2>
            <p className="muted">
              You are signed out, so there are no account settings to show. Nothing here is
              a default — these values simply are not known until you sign in.
            </p>
            <p>
              <a href="/login" data-testid="settings-signin-link">Sign in</a> to see and
              change what reaches your inbox, and how the agent runs.
            </p>
          </div>
          <ThemePanel theme={theme} pickTheme={pickTheme} />
        </section>
      </div>
    );
  }

  if (!prefs) return <p className="muted">Loading settings…</p>;
  const creds = credsQ.data?.credentials ?? [];

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
          <AutopilotRows
            client={client}
            ascWrites={prefs.ascWrites}
            autopilot={prefs.autopilot}
            onChange={(next) => setPrefs((p) => (p ? { ...p, ...(next.ascWrites !== undefined ? { ascWrites: next.ascWrites } : {}), ...(next.autopilot !== undefined ? { autopilot: next.autopilot } : {}) } : p))}
          />
          <p className="autonomy-foot">
            {prefs.autopilot
              ? "Every run still ends at your approval. After it, the agent pushes to a draft version; nothing is submitted."
              : "It never pushes. Every run ends at your approval."}
          </p>
        </Panel>

        <Panel
          id="connections"
          title="Connections"
          sub="All optional. Each one adds a path or a data source — none of them lets ShipASO push on its own."
        >
          <GithubCard client={client} />
          <AscKeyCard client={client} hasAccountKey={creds.some((c) => c.kind === "asc" && c.appId === null)} />
          <AsaCard client={client} hasAsaKey={creds.some((c) => c.kind === "asa")} />
        </Panel>

        <ChannelsCard client={client} />
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
                  {/* #372: metadata listing never decrypts, so a key sealed
                      under a replaced KEK looks healthy here. Say plainly that
                      it can't be used, rather than letting the user discover it
                      when a push fails. Delete stays available — removing the
                      dead row is the first step of re-connecting. */}
                  {k.readable === false ? (
                    <div className="pref-row-detail bad" data-testid={`key-unreadable-${k.kind}`}>
                      Can’t be read — it was encrypted with a key-encryption key this deployment
                      no longer has. Delete it and re-connect to restore one-click push.
                    </div>
                  ) : null}
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

        <ThemePanel theme={theme} pickTheme={pickTheme} />

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
