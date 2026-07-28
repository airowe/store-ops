/**
 * App detail / audit page — redesign of the long vertical card stack into a
 * scannable, hierarchical layout (Audit Page.dc.html): app header → store tabs →
 * metric band → rank trend + what-changed → findings → competitor watch +
 * keyword coverage → run history. Reuses the existing wired cards and query
 * hooks (getApp/getRanks/getDeltas/getEngagement); the redesign changes
 * presentation, not the data contract.
 *
 * v2 (Audit Page v2.dc.html, #344) splits the page into two tabs. The four
 * setup-shaped credential cards used to sit inline in the monitoring flow,
 * which is both the column-rhythm complaint in #344 and a category error:
 * "setup lives here so the monitoring page stays monitoring". Monitor is the
 * default; Connections carries the four cards, unchanged internally — they are
 * wired components with their own queries, mutations and tests, so this MOVES
 * them rather than restyling them.
 *
 * Honest throughout: unmeasured lead rank / conversion render "—", the rank
 * trend only draws with ≥2 points, and grade/coverage tiles that we can't
 * measure from this surface's data are simply not fabricated. The Connections
 * count pill obeys the same rule — it is derived from real stored-credential
 * metadata, and renders NOT AT ALL while that state is unknown or when nothing
 * is unconnected, rather than showing a guess or a hollow "0".
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getApp, getCredentials, getDeltas, getEngagement, getRanks, runApp } from "@shipaso/api";
import { timeAgo } from "@shipaso/honesty";
import type { CSSProperties } from "react";
import { runStatusLabel } from "../../lib/status.js";
import { annotationKey } from "../../lib/annotationKey.js";
import { RankChart } from "../charts/RankChart.js";
import { Gauge, coverage } from "../charts/Gauge.js";
import { RankMovementRow } from "./RankMovementRow.js";
import { ConversionCard } from "./ConversionCard.js";
import { AnalyticsCard } from "./AnalyticsCard.js";
import { ConnectAscCard } from "./ConnectAscCard.js";
import { PlayAuditCard } from "./PlayAuditCard.js";
import { PlayDataSafetyCard } from "./PlayDataSafetyCard.js";
import { PlayFunnelCard } from "./PlayFunnelCard.js";
import { CompetitorsCard } from "./CompetitorsCard.js";
import { LocaleKeywordsCard } from "./LocaleKeywordsCard.js";
import { RejectionAssistantCard } from "./RejectionAssistantCard.js";

export function AppDetailView({
  client,
  id,
  onOpenRun,
  onWarRoom,
  now = Date.now(),
}: {
  client: ApiClient;
  id: string;
  onOpenRun: (runId: string) => void;
  onWarRoom: (appId: string) => void;
  now?: number;
}) {
  const appQ = useQuery({ queryKey: ["app", id], queryFn: () => getApp(client, id) });
  const ranksQ = useQuery({ queryKey: ["ranks", id], queryFn: () => getRanks(client, id) });
  const deltasQ = useQuery({ queryKey: ["deltas", id], queryFn: () => getDeltas(client, id) });
  const engagementQ = useQuery({ queryKey: ["engagement", id], queryFn: () => getEngagement(client, id), retry: false });
  // Lifted so the Connections tab can label itself honestly. The four cards each
  // run this same query under the same key, so this shares their cache entry
  // rather than adding a request.
  const credsQ = useQuery({ queryKey: ["credentials"], queryFn: () => getCredentials(client) });
  const [tab, setTab] = useState<"monitor" | "connections">("monitor");

  // #385: the keyless audit. POST /apps/:id/run existed and had no caller in
  // either surface, so the free tier — whose whole product IS the public audit
  // — had no way to start its own loop without pasting a .p8 key.
  //
  // Explicit click only: this costs a run against the plan and re-reads the
  // store, so it must never fire on mount. On success we land on the run it
  // created, because a run the user cannot find is the same as no run.
  const audit = useMutation({
    mutationFn: () => runApp(client, id),
    onSuccess: (run) => onOpenRun(run.id),
  });

  if (appQ.isLoading) return <p className="muted">Loading…</p>;
  if (appQ.isError || !appQ.data) return <p className="muted">Couldn’t load this app. Try again.</p>;

  const { app, runs } = appQ.data;
  const points = ranksQ.data?.points ?? [];
  const annotations = ranksQ.data?.annotations ?? [];
  const entries = deltasQ.data?.entries ?? [];

  // Honest lead rank for the metric band: the strongest measured current rank
  // among tracked deltas (the "lead" the app is ranking best for). Null → "—".
  const measured = entries.filter((e) => typeof e.current === "number");
  const lead = measured.length
    ? measured.reduce((best, e) => ((e.current as number) < (best.current as number) ? e : best))
    : null;
  const awaiting = runs.some((r) => r.status === "awaiting_approval");

  // Keyword coverage from the tracked deltas — N of the measured terms in top 10.
  const cov = coverage(entries.map((e) => e.current));

  // Honest conversion for the metric tile: the measured latest rate, or null → "—".
  const engagement = engagementQ.data;
  const conversionRate =
    engagement?.state === "measured" ? (engagement.latestConversion?.rate ?? null) : null;

  // Connections count, derived — the comp hardcodes "2 unconnected" because it is
  // a static mock. The four cards cover exactly two credentialled surfaces: App
  // Store Connect (ConnectAscCard, kind "asc") and Google Play (PlayAuditCard,
  // PlayDataSafetyCard and PlayFunnelCard all key off kind "play"). A surface is
  // connected when a stored credential of that kind is scoped to this app or is
  // account-wide (appId === null) — the same predicate each card already uses to
  // decide whether to show its paste box, so the pill can never disagree with the
  // cards beneath it.
  //
  // While the query is pending we know nothing, so `unconnected` is null and no
  // pill renders. Zero also renders no pill: "0 unconnected" is noise, and the
  // absence of the pill is the honest signal that nothing is outstanding.
  const credentials = credsQ.data?.credentials ?? [];
  const hasKind = (kind: "asc" | "play") =>
    credentials.some((c) => c.kind === kind && (c.appId === app.id || c.appId === null));
  const unconnected = credsQ.isPending
    ? null
    : (hasKind("asc") ? 0 : 1) + (hasKind("play") ? 0 : 1);

  const monitorPanelId = "audit-panel-monitor";
  const connectionsPanelId = "audit-panel-connections";

  return (
    <section className="audit">
      {/* app header */}
      <header className="audit-header">
        <span className="app-chip signal audit-icon">{(app.name.trim()[0] ?? "·").toUpperCase()}</span>
        <div className="audit-id">
          <div className="audit-title-row">
            <h1 className="audit-name">{app.name}</h1>
            {awaiting ? <span className="badge awaiting_approval">Awaiting approval</span> : null}
          </div>
          <div className="audit-sub mono">{app.bundle_id} · {app.country}</div>
        </div>
        <div className="audit-header-actions">
          {/* #385: the manual start for the loop. Keyless — the public audit is
              a real path, not a degraded one, so this must not imply a key is
              needed. Approval still gates anything leaving the building. */}
          <button
            type="button"
            className="btn primary"
            data-testid="run-audit"
            disabled={audit.isPending}
            onClick={() => audit.mutate()}
          >
            {audit.isPending ? "Auditing…" : "Run audit"}
          </button>
          <button type="button" className="btn ghost" data-testid="war-room" onClick={() => onWarRoom(app.id)}>
            War room
          </button>
        </div>
        {audit.isError ? (
          <p className="micro bad" data-testid="run-audit-error">
            {audit.error instanceof Error ? audit.error.message : "Couldn’t start the audit."}
          </p>
        ) : null}
      </header>

      {/* store tabs — App Store active; Google Play behind a connect chip */}
      <div className="store-tabs" data-testid="store-tabs">
        <div className="store-tab active">
          <span>App Store</span>
        </div>
        <div className="store-tab">
          <span>Google Play</span>
          <span className="store-connect mono">connect</span>
        </div>
      </div>

      {/* section tabs (v2) — Monitor vs Connections. Real <button>s in a real
          tablist: native Enter/Space and focus semantics, no hand-rolled
          onKeyDown (same rule as button.card in app.css). */}
      <div className="audit-tabs" role="tablist" aria-label="Audit sections" data-testid="audit-tabs">
        <button
          type="button"
          role="tab"
          id="audit-tab-monitor"
          className={"audit-tab" + (tab === "monitor" ? " active" : "")}
          data-testid="audit-tab-monitor"
          aria-selected={tab === "monitor"}
          aria-controls={monitorPanelId}
          onClick={() => setTab("monitor")}
        >
          Monitor
        </button>
        <button
          type="button"
          role="tab"
          id="audit-tab-connections"
          className={"audit-tab" + (tab === "connections" ? " active" : "")}
          data-testid="audit-tab-connections"
          aria-selected={tab === "connections"}
          aria-controls={connectionsPanelId}
          onClick={() => setTab("connections")}
        >
          Connections
          {unconnected ? (
            <span className="audit-tab-count mono" data-testid="connections-unconnected">
              {unconnected} unconnected
            </span>
          ) : null}
        </button>
      </div>

      {tab === "monitor" ? (
      <div id={monitorPanelId} role="tabpanel" aria-labelledby="audit-tab-monitor" className="audit-panel">

      {/* metric band — only real, measured numbers; nothing fabricated */}
      <div className="metric-band">
        <div className="metric-tile" data-testid="lead-rank-tile">
          <div className="metric-label mono">Lead rank</div>
          <div className="metric-value-row">
            <span className="metric-value">{lead?.current != null ? `#${lead.current}` : "—"}</span>
            {lead && typeof lead.delta === "number" && lead.delta !== 0 ? (
              <span className={"metric-delta " + (lead.delta > 0 ? "up" : "down")}>
                {lead.delta > 0 ? `↑${lead.delta}` : `↓${Math.abs(lead.delta)}`}
              </span>
            ) : null}
          </div>
          {/* #384: name the SCOPE. This band reads the latest run's targets
              (#74), not every rank ever measured for the app — so an app can
              show "—" here while the Keywords page shows it at #1 for a term
              this run didn't target. Both are true; only the wording made them
              look contradictory. */}
          <div className="metric-sub">
            {lead ? `“${lead.keyword}”` : "no targeted keyword measured yet"}
          </div>
        </div>
        <div className="metric-tile" data-testid="tracked-terms-tile">
          <div className="metric-label mono">Tracked terms</div>
          <div className="metric-value-row">
            <span className="metric-value">{entries.length || "—"}</span>
          </div>
          <div className="metric-sub">
            {entries.length
              ? `${measured.length} of ${entries.length} tracked terms ranking`
              : "none tracked yet"}
          </div>
        </div>
        <div className="metric-tile" data-testid="conversion-tile">
          <div className="metric-label mono">Conversion</div>
          <div className="metric-value-row">
            <span className="metric-value">
              {conversionRate != null ? `${(conversionRate * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
          <div className="metric-sub">
            {conversionRate != null ? "downloads ÷ page views" : "no analytics ingested yet"}
          </div>
        </div>
        <div className="metric-tile metric-tile--gauge" data-testid="coverage-tile">
          <Gauge fraction={cov.fraction} label={cov.label} />
          <div>
            <div className="metric-label mono">Coverage</div>
            <div className="metric-sub">
              {cov.measured ? (
                <>
                  {cov.inTop10} of {cov.measured}
                  <br />
                  in top 10
                </>
              ) : (
                "none measured yet"
              )}
            </div>
          </div>
        </div>
      </div>

      {/* rank trend + what changed */}
      <div className="audit-grid-2">
        {points.length >= 2 ? (
          <div className="panel" data-testid="rank-trend">
            <div className="panel-title">Rank trend</div>
            <RankChart points={points} />
            <p className="micro">Organic rank over time (lower is better). History starts when tracking started.</p>
          </div>
        ) : null}

        {annotations.length > 0 ? (
          <div className="panel" data-testid="what-changed">
            <div className="panel-title">What changed</div>
            {annotations.slice(-8).map((a, i) => (
              <div key={annotationKey(a)} className="anno-row" style={{ "--row": i } as CSSProperties}>
                <span style={{ color: a.kind === "push" ? "var(--signal)" : "var(--warn)" }}>
                  {a.kind === "push" ? "▲" : "◆"}
                </span>
                <span>{a.label}</span>
                <span className="micro">{a.at.slice(0, 10)}</span>
              </div>
            ))}
            <p className="micro">▲ your approved pushes · ◆ competitor visible changes. Correlation, not causation.</p>
          </div>
        ) : null}
      </div>

      {/* rank movement */}
      {entries.length > 0 ? (
        <div className="panel" data-testid="rank-movement">
          <div className="panel-title">Rank movement</div>
          {entries.slice(0, 8).map((e) => (
            <RankMovementRow key={e.keyword} entry={e} />
          ))}
        </div>
      ) : null}

      {/* competitor watch + keyword coverage (existing wired cards) */}
      <div className="audit-grid-2">
        <CompetitorsCard client={client} appId={app.id} />
        <LocaleKeywordsCard client={client} appId={app.id} />
      </div>

      {/* The four credential cards used to sit here; they now live on the
          Connections tab below. RejectionAssistantCard stays — it is a
          monitoring-shaped surface, not a credential. */}
      <RejectionAssistantCard client={client} />

      {/* Measured conversion detail (the card, with its movement caveat) + setup
          affordance until a series exists — unchanged behavior. */}
      <ConversionCard data={engagement} />
      {engagement?.state !== "measured" ? <AnalyticsCard client={client} appId={app.id} /> : null}

      {/* run history */}
      <div className="audit-section-label mono">Run history</div>
      {runs.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <div className="audit-runs">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              className="audit-run-row"
              data-testid={`run-${r.id}`}
              onClick={() => onOpenRun(r.id)}
            >
              <span className={"run-dot " + r.status} aria-hidden="true" />
              <span className="audit-run-status">{runStatusLabel(r.status)}</span>
              <span className="audit-run-when micro">{timeAgo(r.created_at, now)}</span>
              <span className="audit-run-chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}

      </div>
      ) : (
      <div id={connectionsPanelId} role="tabpanel" aria-labelledby="audit-tab-connections" className="audit-panel">
        <p className="audit-connections-intro">
          Setup lives here so the monitoring page stays monitoring. Each connection widens what a
          run can read — nothing here grants ShipASO permission to publish.
        </p>

        {/* The existing wired cards, MOVED not rewritten: each keeps its own
            queries, mutations, copy and tests. The two-column grid is the only
            thing this tab adds. */}
        <div className="audit-grid-2 audit-connections-grid">
          <ConnectAscCard client={client} appId={app.id} onRunStarted={onOpenRun} />
          <PlayAuditCard client={client} appId={app.id} />
          <PlayDataSafetyCard client={client} appId={app.id} />
          <PlayFunnelCard client={client} appId={app.id} />
        </div>

        <p className="audit-connections-note">
          Keys are stored encrypted and shown only as metadata — key id, issuer id, and when it was
          last used. ShipASO never displays key material back to you, here or anywhere.
        </p>
      </div>
      )}
    </section>
  );
}
