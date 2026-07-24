/**
 * App detail / audit page — redesign of the long vertical card stack into a
 * scannable, hierarchical layout (Audit Page.dc.html): app header → store tabs →
 * metric band → rank trend + what-changed → findings → competitor watch +
 * keyword coverage → run history. Reuses the existing wired cards and query
 * hooks (getApp/getRanks/getDeltas/getEngagement); the redesign changes
 * presentation, not the data contract.
 *
 * Honest throughout: unmeasured lead rank / conversion render "—", the rank
 * trend only draws with ≥2 points, and grade/coverage tiles that we can't
 * measure from this surface's data are simply not fabricated.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getApp, getDeltas, getEngagement, getRanks } from "@shipaso/api";
import { timeAgo } from "@shipaso/honesty";
import type { CSSProperties } from "react";
import { runStatusLabel } from "../../lib/status.js";
import { annotationKey } from "../../lib/annotationKey.js";
import { RankChart } from "../charts/RankChart.js";
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

  // Honest conversion for the metric tile: the measured latest rate, or null → "—".
  const engagement = engagementQ.data;
  const conversionRate =
    engagement?.state === "measured" ? (engagement.latestConversion?.rate ?? null) : null;

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
          <button type="button" className="btn ghost" data-testid="war-room" onClick={() => onWarRoom(app.id)}>
            War room
          </button>
        </div>
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
          <div className="metric-sub">{lead ? `“${lead.keyword}”` : "no keyword measured yet"}</div>
        </div>
        <div className="metric-tile">
          <div className="metric-label mono">Tracked terms</div>
          <div className="metric-value-row">
            <span className="metric-value">{entries.length || "—"}</span>
          </div>
          <div className="metric-sub">
            {entries.length ? `${measured.length} currently ranking` : "none tracked yet"}
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

      {/* store-specific audit surfaces + the ASC keyed-loop entry point */}
      <ConnectAscCard client={client} appId={app.id} onRunStarted={onOpenRun} />
      <PlayAuditCard client={client} appId={app.id} />
      <PlayDataSafetyCard client={client} appId={app.id} />
      <PlayFunnelCard client={client} appId={app.id} />
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
    </section>
  );
}
