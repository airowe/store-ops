/**
 * Dashboard — the portfolio command center (redesign of the flat app grid). Its
 * #1 job is surfacing runs awaiting approval and letting the user act. Success
 * body: editorial greeting → KPI strip → hero decision card → tracked-app rows,
 * all derived from the real getApps list via the pure `dashboardModel` (honest:
 * an unmeasured KPI is "—", never a fabricated number). Signed-out / loading /
 * error / empty / approve-all / connect behavior is preserved verbatim from the
 * ported dashboard — the redesign changes presentation, not the data contract.
 */
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, AppListItem } from "@shipaso/api";
import {
  ApiError,
  approveAllRuns,
  getApps,
  getDeltas,
  getPortfolioRuns,
  getRanks,
} from "@shipaso/api";
import { Navigate } from "@tanstack/react-router";
import { ConnectAppCard } from "../connect/ConnectAppCard.js";
import { formatRank } from "@shipaso/honesty";
import { runStatusLabel } from "../../lib/status.js";
import { Sparkline } from "../charts/Sparkline.js";
import { MultiLineChart, SERIES_COLORS } from "../charts/MultiLineChart.js";
import { greeting, kpis, heroApp, pendingCount } from "./dashboardModel.js";
import { loopSummary } from "./loopSummary.js";
import { LoopStatus } from "./LoopStatus.js";
import { movers, series, type FleetDeltas, type FleetRanks } from "./fleetModel.js";

export function DashboardView({ client, onOpen }: { client: ApiClient; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => getApps(client),
    // Never retry an auth failure — a 401 will 401 again, and each pointless
    // retry only delays the signed-out state below.
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 3,
  });
  // #515: bulk approve must present a challenge per queued run, and the apps
  // list does not carry them — they ride back on the runs list. Fetched here so
  // this button can present them; the KPI count still comes from `apps`.
  const runsQ = useQuery({
    queryKey: ["portfolio", "runs"],
    queryFn: () => getPortfolioRuns(client),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 3,
  });
  const approveAll = useMutation({
    mutationFn: () =>
      approveAllRuns(
        client,
        (runsQ.data?.runs ?? []).flatMap((r) =>
          r.status === "awaiting_approval" && r.approval_challenge
            ? [{ runId: r.id, challenge: r.approval_challenge }]
            : [],
        ),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["portfolio", "runs"] });
    },
  });

  // isPending, NOT isLoading — see the ported note: isLoading goes false during a
  // retry backoff, which would flash "no apps" (a lie) at a logged-out visitor.
  if (appsQ.isPending) return <p className="muted">Loading your apps…</p>;

  if (appsQ.error instanceof ApiError && appsQ.error.status === 401) {
    return (
      <section data-testid="signed-out">
        <h1>Sign in to see your apps</h1>
        <p className="muted">
          Or <a href="/preview">audit any listing first</a> — no signup needed.
        </p>
        <a className="btn primary" href="/login" data-testid="signed-out-signin">
          Sign in
        </a>
      </section>
    );
  }

  if (appsQ.isError) return <p className="muted">Couldn’t load your apps. Try again.</p>;

  const apps = appsQ.data?.apps ?? [];
  const pending = pendingCount(apps);

  // A user with nothing connected has no dashboard to show. Send them to the
  // guided setup rather than a card that duplicates it. This sits AFTER the
  // isPending / 401 / error guards on purpose: redirecting on a list we have
  // not actually received would bounce a logged-out or still-loading visitor.
  if (apps.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  const g = greeting(apps);
  const hero = heroApp(apps);

  return (
    <section className="dash" data-testid="dashboard">
      {/* editorial greeting */}
      <header className="dash-greeting">
        <div className={"dash-eyebrow" + (g.urgent ? " urgent" : "")}>{g.eyebrow}</div>
        <h1 className="dash-headline">{g.headline}</h1>
      </header>

      {/* The loop itself: what the agents did while nobody was looking. */}
      <LoopStatus summary={loopSummary(apps)} now={new Date()} />

      {/* KPI strip: awaiting-you card + derived metrics */}
      <div className="kpi-strip">
        <div className={"kpi-card awaiting" + (pending > 0 ? " live" : "")} data-testid="kpi-awaiting">
          <div className="kpi-awaiting-head">
            {pending > 0 ? <span className="pulse-dot" aria-hidden="true" /> : null}
            <span className="kpi-eyebrow">Awaiting you</span>
          </div>
          <div className="kpi-value">{pending}</div>
          <div className="kpi-sub">{pending === 1 ? "run ready to review" : "runs ready to review"}</div>
          {pending > 0 && hero ? (
            <button type="button" className="kpi-cta" data-testid="kpi-review" onClick={() => onOpen(hero.id)}>
              Review runs →
            </button>
          ) : null}
        </div>
        {kpis(apps).map((k) => (
          <div className="kpi-card" key={k.label} data-testid={`kpi-${k.label.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="kpi-eyebrow">{k.label}</div>
            <div className={"kpi-value" + (k.tone === "signal" ? " signal" : "")}>{k.value}</div>
            {k.sub ? <div className="kpi-sub">{k.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* approve-all (unchanged behavior; restyled) */}
      {pending > 1 ? (
        <div className="card" data-testid="approve-all-card">
          <b>{pending} runs awaiting approval</b>
          <p className="micro">
            Approve every pending run at once. Approval only reveals each run’s push handoff —
            it never ships anything.
          </p>
          <button
            type="button"
            className="btn primary"
            data-testid="approve-all"
            disabled={approveAll.isPending}
            onClick={() => approveAll.mutate()}
          >
            {approveAll.isPending ? "Approving…" : `Approve all ${pending}`}
          </button>
          {approveAll.data ? (
            <p className="micro" data-testid="approve-all-result">
              Approved {approveAll.data.approvedCount} run{approveAll.data.approvedCount === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* hero decision card */}
      {hero ? <HeroCard client={client} app={hero} onOpen={onOpen} /> : null}

      {/* portfolio rank trend + keyword movers (fleet-wide, honest) */}
      <PortfolioSection client={client} apps={apps} />

      {/* tracked apps */}
      <div className="dash-section-head">
        <span className="dash-section-label">Tracked apps</span>
        <span className="dash-section-note">lead keyword · rank</span>
      </div>
      <div className="tracked-list">
        {apps.map((a) => (
          <TrackedRow key={a.id} app={a} onOpen={onOpen} />
        ))}
      </div>

      <div className="dash-connect">
        <ConnectAppCard client={client} onConnected={onOpen} />
      </div>
    </section>
  );
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "·").toUpperCase();
}

/**
 * Portfolio rank trend + keyword movers — fleet-wide, from per-app getRanks /
 * getDeltas. Bounded to the first few apps so a large fleet doesn't fan out
 * unboundedly. Honest: the chart only draws apps with a real trend, the movers
 * list only shows measured moves, and each panel hides itself when it has
 * nothing real to show (never an empty axis or a fabricated row).
 */
function PortfolioSection({ client, apps }: { client: ApiClient; apps: AppListItem[] }) {
  const fleet = apps.slice(0, 4); // cap the fan-out; the chart legend stays legible
  const rankQs = useQueries({
    queries: fleet.map((a) => ({
      queryKey: ["ranks", a.id],
      queryFn: () => getRanks(client, a.id),
      retry: false,
    })),
  });
  const deltaQs = useQueries({
    queries: fleet.map((a) => ({
      queryKey: ["deltas", a.id],
      queryFn: () => getDeltas(client, a.id),
      retry: false,
    })),
  });

  const fleetRanks: FleetRanks = fleet.map((app, i) => ({ app, points: rankQs[i]?.data?.points ?? [] }));
  const fleetDeltas: FleetDeltas = fleet.map((app, i) => ({ app, entries: deltaQs[i]?.data?.entries ?? [] }));

  const chartSeries = series(fleetRanks).map((s, i) => ({ ...s, color: SERIES_COLORS[i % SERIES_COLORS.length]! }));
  const topMovers = movers(fleetDeltas);

  const hasChart = chartSeries.some((s) => s.points.filter((r) => typeof r === "number").length >= 2);
  const hasMovers = topMovers.length > 0;
  if (!hasChart && !hasMovers) return null;

  return (
    <div className="portfolio-grid" data-testid="portfolio-section">
      {hasChart ? (
        <div className="panel">
          <div className="panel-title">Portfolio rank trend</div>
          <p className="micro" style={{ marginBottom: 12 }}>Avg organic rank across tracked keywords · lower is better</p>
          <MultiLineChart series={chartSeries} />
          <div className="portfolio-legend">
            {chartSeries.map((s) => (
              <span key={s.label} className="legend-item">
                <span className="legend-swatch" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {hasMovers ? (
        <div className="panel">
          <div className="panel-title">Keyword movers</div>
          <p className="micro" style={{ marginBottom: 12 }}>Biggest measured moves across your fleet</p>
          <div className="movers-list">
            {topMovers.map((m) => (
              <div key={`${m.app}-${m.keyword}`} className="mover-row" data-testid={`mover-${m.keyword}`}>
                <div className="mover-id">
                  <div className="mover-kw">{m.keyword}</div>
                  <div className="mover-app mono">{m.app}</div>
                </div>
                <div className="mover-bar-track">
                  <div
                    className={"mover-bar " + (m.delta > 0 ? "up" : "down")}
                    style={{ width: `${Math.round(m.magnitude * 100)}%` }}
                  />
                </div>
                <span className={"mover-delta mono " + (m.delta > 0 ? "up" : "down")}>
                  {m.delta > 0 ? `↑${m.delta}` : `↓${Math.abs(m.delta)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HeroCard({ client, app, onOpen }: { client: ApiClient; app: AppListItem; onOpen: (id: string) => void }) {
  const rank = app.rank_summary;
  const awaiting = app.latest_run?.status === "awaiting_approval";
  // The hero's own rank trend — best-effort; a failure just hides the sparkline.
  const ranksQ = useQuery({ queryKey: ["ranks", app.id], queryFn: () => getRanks(client, app.id), retry: false });
  const sparkPoints = (ranksQ.data?.points ?? []).map((p) => ({ rank: p.rank }));
  return (
    <div className="hero-card" data-testid="hero-card">
      <div className="hero-left">
        <div className="hero-id">
          <span className="app-chip signal">{initialOf(app.name)}</span>
          <div>
            <div className="hero-name">{app.name}</div>
            <div className="hero-bundle mono">{app.bundle_id}</div>
          </div>
          {app.latest_run ? (
            <span className={"badge " + app.latest_run.status} style={{ marginLeft: "auto" }}>
              {runStatusLabel(app.latest_run.status)}
            </span>
          ) : null}
        </div>
        <p className="hero-copy">
          {awaiting
            ? "A run is waiting on your call. Approving reveals the push commands — nothing ships until you run them."
            : "Open this app to see its audit, rank trend, and the next optimization."}
        </p>
        <div className="hero-actions">
          <button type="button" className="btn primary" data-testid="hero-review" onClick={() => onOpen(app.id)}>
            {awaiting ? "Review & approve" : "Open app"}
          </button>
          <button type="button" className="btn ghost" data-testid="hero-audit" onClick={() => onOpen(app.id)}>
            View audit
          </button>
        </div>
      </div>
      <div className="hero-right">
        <div className="hero-metric-label">Lead keyword rank</div>
        <div className="hero-metric">
          <span className="hero-rank">{rank?.lead_rank != null ? `#${rank.lead_rank}` : "—"}</span>
        </div>
        <div className="hero-metric-sub">
          {rank?.lead_keyword ? `“${rank.lead_keyword}”` : "no lead keyword measured yet"}
        </div>
        <div className="hero-spark">
          <Sparkline points={sparkPoints} width={200} height={44} />
        </div>
      </div>
    </div>
  );
}

function TrackedRow({ app, onOpen }: { app: AppListItem; onOpen: (id: string) => void }) {
  const rank = app.rank_summary;
  const awaiting = app.latest_run?.status === "awaiting_approval";
  return (
    <div
      className="tracked-row"
      data-testid={`app-card-${app.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(app.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(app.id);
      }}
    >
      <span className="app-chip neutral">{initialOf(app.name)}</span>
      <div className="tracked-id">
        <div className="tracked-name">{app.name}</div>
        <div className="tracked-bundle mono">{app.bundle_id}</div>
      </div>
      <div className="tracked-rank">
        {rank ? (
          <>
            <div className="tracked-kw">{rank.lead_keyword}</div>
            <div className="tracked-rank-val mono" data-testid="rank">
              <b className={rank.lead_rank != null ? "good" : "none"}>{formatRank(rank.lead_rank)}</b>
            </div>
          </>
        ) : (
          <div className="tracked-kw micro">no ranks checked yet</div>
        )}
      </div>
      <div className="tracked-status">
        {app.latest_run ? (
          <span className={"badge " + app.latest_run.status}>{runStatusLabel(app.latest_run.status)}</span>
        ) : null}
      </div>
      <div className="tracked-cta">
        <span className={"btn " + (awaiting ? "primary" : "ghost")}>{awaiting ? "Review →" : "Open"}</span>
      </div>
    </div>
  );
}

