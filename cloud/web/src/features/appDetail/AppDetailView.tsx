/**
 * App detail — identity, the rank-trend chart (PRD 08's RankChart), rank
 * movement, "what changed" annotations, and run history. Follows the mobile
 * model: the listing audit + coverage live on the RUN page (PRD 07), not here —
 * reconciling the web's old app-page audit into the run detail.
 *
 * Read-only, honest throughout. Client + id injected for testability.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { getApp, getDeltas, getEngagement, getRanks } from "@shipaso/api";
import { timeAgo } from "@shipaso/honesty";
import { runStatusLabel } from "../../lib/status.js";
import { RankChart } from "../charts/RankChart.js";
import { RankMovementRow } from "./RankMovementRow.js";
import { ConversionCard } from "./ConversionCard.js";
import { AnalyticsCard } from "./AnalyticsCard.js";
import { ConnectAscCard } from "./ConnectAscCard.js";

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
  // Measured conversion (analytics-reports Phase 3). Best-effort — a failure just
  // hides the card (the card also renders nothing until data is ingested).
  const engagementQ = useQuery({ queryKey: ["engagement", id], queryFn: () => getEngagement(client, id), retry: false });

  if (appQ.isLoading) return <p className="muted">Loading…</p>;
  if (appQ.isError || !appQ.data) return <p className="muted">Couldn’t load this app. Try again.</p>;

  const { app, runs } = appQ.data;
  const points = ranksQ.data?.points ?? [];
  const annotations = ranksQ.data?.annotations ?? [];
  const entries = deltasQ.data?.entries ?? [];

  return (
    <section>
      <h1>{app.name}</h1>
      <p className="muted mono">{app.bundle_id} · {app.country}</p>
      <button className="btn ghost" data-testid="war-room" onClick={() => onWarRoom(app.id)}>War room</button>

      <ConnectAscCard client={client} appId={app.id} onRunStarted={onOpenRun} />

      <ConversionCard data={engagementQ.data} />
      {/* Setup affordance — shown until a measured series exists, then it yields to
          the number above. */}
      {engagementQ.data?.state !== "measured" ? <AnalyticsCard client={client} appId={app.id} /> : null}

      {points.length >= 2 ? (
        <div className="card" data-testid="rank-trend">
          <b>Rank trend</b>
          <RankChart points={points} />
          <p className="micro">Organic rank over time (lower is better). History starts when tracking started.</p>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="card" data-testid="rank-movement">
          <b>Rank movement</b>
          {entries.slice(0, 8).map((e) => (
            <RankMovementRow key={e.keyword} entry={e} />
          ))}
        </div>
      ) : null}

      {annotations.length > 0 ? (
        <div className="card" data-testid="what-changed">
          <b>What changed</b>
          {annotations.slice(-8).map((a, i) => (
            <div key={`${a.at}-${i}`} className="anno-row">
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

      <h2>Runs</h2>
      {runs.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        runs.map((r) => (
          <div
            key={r.id}
            className="card run-row"
            data-testid={`run-${r.id}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpenRun(r.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpenRun(r.id);
            }}
          >
            <span>{runStatusLabel(r.status)}</span>
            <span className="micro">{timeAgo(r.created_at, now)}</span>
          </div>
        ))
      )}
    </section>
  );
}
