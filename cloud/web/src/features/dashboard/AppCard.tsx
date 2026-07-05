/**
 * AppCard — one connected app: identity, latest-run badge, lead rank, findings.
 * Honest throughout (ported from mobile AppCard): an unmeasured rank is "—"
 * (via the shared formatRank), never a guessed number; the findings label only
 * shows when the server returned one.
 */
import { formatRank } from "@shipaso/honesty";
import type { AppListItem } from "@shipaso/api";
import { runStatusLabel } from "../../lib/status.js";

export function AppCard({ app, onOpen }: { app: AppListItem; onOpen: (id: string) => void }) {
  const rank = app.rank_summary;
  const findings = app.findings_summary;
  return (
    <div
      className="card appcard"
      data-testid={`app-card-${app.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(app.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(app.id);
      }}
    >
      <div className="row1">
        <span className="name">{app.name}</span>
        {app.latest_run ? (
          <span className={"badge " + app.latest_run.status}>{runStatusLabel(app.latest_run.status)}</span>
        ) : null}
      </div>
      <div className="bundle">{app.bundle_id}</div>
      <div className="meta">
        {rank ? (
          <span className="mono" data-testid="rank">
            {rank.lead_keyword}:{" "}
            <b className={rank.lead_rank != null ? "good" : "none"}>{formatRank(rank.lead_rank)}</b>
          </span>
        ) : (
          <span className="micro">no ranks checked yet</span>
        )}
      </div>
      {findings ? (
        <div className="finding-label" data-testid="findings" style={{ color: findings.critical > 0 ? "var(--bad)" : "var(--dim)" }}>
          {findings.label}
        </div>
      ) : null}
    </div>
  );
}
