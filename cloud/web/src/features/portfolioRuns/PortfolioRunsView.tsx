/**
 * /runs — the fleet-wide run index (#356), built against `Runs.dc.html`.
 *
 * Two parts, and the order between them is the product:
 *
 *  1. The ACTION QUEUE — every run at the human gate, leading at ANY age. This
 *     is the core loop, so it sits forward in a warn-bordered panel with a
 *     single "Approve all N".
 *  2. HISTORY — everything decided or in progress, grouped by day, filterable.
 *
 * Honesty decisions:
 *
 *  • The server already orders the response (awaiting-approval first at any
 *    age, then created_at desc). This view partitions by STATUS ONLY and never
 *    re-sorts — see `runsModel.partition` / `groupByDay`.
 *  • A run whose `findings_summary` is null renders NO chip. Not a zero: a zero
 *    would claim "audited, and nothing was critical", which is a different and
 *    unearned statement.
 *  • Approval copy is exact — approving reveals push commands and nothing more.
 *    Nothing reaches a store without the customer running them.
 *  • The empty state names the two real ways a run appears and says out loud
 *    that we don't create runs to fill the page.
 *  • The comp's topbar "state switcher" is a preview affordance and is NOT
 *    shipped; the real states come from the query.
 *
 * The client is injected so the whole view is render-testable with a fake.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, FindingsSummary, PortfolioRunRow, RunStatus } from "@shipaso/api";
import { approveAllRuns, getPortfolioRuns } from "@shipaso/api";
import { timeAgo } from "@shipaso/honesty";
import { runStatusLabel } from "../../lib/status.js";
import { RunActorMark } from "../run/RunActorMark.js";
import {
  applyFilter,
  groupByDay,
  HISTORY_FILTERS,
  initialFor,
  partition,
  pluralRuns,
  queueHeadline,
  type HistoryFilter,
} from "./runsModel.js";

/** Status → the tone class the row's dot and label wear. */
const TONE: Record<RunStatus, string> = {
  detected: "is-dim",
  researching: "is-brand",
  awaiting_approval: "is-warn",
  approved: "is-signal",
  shipped: "is-signal",
  rejected: "is-bad",
  superseded: "is-faint",
};

const SKELETON_ROWS = [0, 1, 2, 3, 4];

export function PortfolioRunsView({ client }: { client: ApiClient }) {
  const qc = useQueryClient();
  const runsQ = useQuery({ queryKey: ["portfolio", "runs"], queryFn: () => getPortfolioRuns(client) });
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const runs = runsQ.data?.runs;
  const { queue, history } = useMemo(() => partition(runs ?? []), [runs]);
  const approveAll = useMutation({
    // #515: every queued run's challenge must be presented, or the server
    // refuses. They ride back on the same list this page already renders, so a
    // person who can see the queue can approve it — and a caller that never
    // loaded it cannot.
    mutationFn: () =>
      approveAllRuns(
        client,
        queue.flatMap((r) =>
          r.approval_challenge ? [{ runId: r.id, challenge: r.approval_challenge }] : [],
        ),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["portfolio", "runs"] }),
  });
  // `now` is read once per render pass of the data, not per row, so every
  // relative age on the page is measured from the same instant.
  const days = useMemo(() => groupByDay(applyFilter(history, filter), Date.now()), [history, filter]);

  return (
    <div className="pruns-page">
      <h1 className="pruns-title">Runs</h1>
      <p className="pruns-intro" data-testid="runs-intro">
        Every run across your portfolio, newest first — but the ones waiting on your approval come
        first regardless of when they landed. Approving a run only reveals its push commands;
        nothing reaches a store without you running them.
      </p>

      {/* isPending, not isLoading: isLoading drops during a retry backoff and
          would flash the empty state — a lie — at someone whose request is
          still in flight. */}
      {runsQ.isPending ? <LoadingState /> : null}

      {runsQ.isError ? (
        <p className="pruns-error" data-testid="runs-error">
          Couldn’t load your runs. Try again.
        </p>
      ) : null}

      {runs && runs.length === 0 ? <EmptyState /> : null}

      {runs && runs.length > 0 ? (
        <>
          {queue.length > 0 ? (
            <QueuePanel
              queue={queue}
              onApproveAll={() => approveAll.mutate()}
              isApproving={approveAll.isPending}
              approvedCount={approveAll.data?.approvedCount ?? null}
            />
          ) : null}

          <div className="pruns-history-head">
            <span className="pruns-eyebrow">Decided &amp; in progress</span>
            <span className="pruns-rule" />
            <div className="pruns-filters">
              {HISTORY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`pruns-chip${filter === f.id ? " is-on" : ""}`}
                  data-testid={`history-filter-${f.id}`}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pruns-history" data-testid="runs-history">
            {days.map((d) => (
              <div key={d.key}>
                <div className="pruns-day" data-testid={`day-header-${d.key}`}>
                  <span>{d.label}</span>
                  <span className="pruns-day-sep">·</span>
                  <span>{pluralRuns(d.rows.length)}</span>
                </div>
                {d.rows.map((r) => (
                  <HistoryRow key={r.id} run={r} />
                ))}
              </div>
            ))}
            {days.length === 0 ? (
              <p className="pruns-foot" data-testid="history-filter-empty">
                No runs match this filter.
              </p>
            ) : null}
            <p className="pruns-foot">
              History starts when tracking started — there is nothing before that to show.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div data-testid="runs-loading">
      <div className="pruns-skeletons" aria-hidden="true">
        {SKELETON_ROWS.map((i) => (
          <div key={i} className="pruns-skeleton" />
        ))}
      </div>
      <p className="pruns-foot">Loading runs…</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="pruns-empty" data-testid="runs-empty">
      <div className="pruns-eyebrow">No runs yet</div>
      <div className="pruns-empty-title">Nothing has been detected yet.</div>
      <p className="pruns-empty-body">
        A run appears when the weekly sweep finds something worth changing, or when you start one
        yourself from an app. We don’t create runs to fill this page.
      </p>
      <div className="pruns-empty-actions">
        <a className="pruns-btn is-primary" href="/apps">
          Start a run from an app
        </a>
        <a className="pruns-btn is-ghost" href="/settings#autonomy">
          Check sweep cadence
        </a>
      </div>
    </div>
  );
}

function QueuePanel({
  queue,
  onApproveAll,
  isApproving,
  approvedCount,
}: {
  queue: readonly PortfolioRunRow[];
  onApproveAll: () => void;
  isApproving: boolean;
  approvedCount: number | null;
}) {
  return (
    <section className="pruns-queue" data-testid="runs-queue">
      <div className="pruns-queue-head">
        <div className="pruns-queue-headline-wrap">
          <div className="pruns-queue-eyebrow">
            <span className="pruns-queue-pip" aria-hidden="true" />
            Waiting on you
            <span className="pruns-queue-count">· {queue.length}</span>
          </div>
          <div className="pruns-queue-headline" data-testid="queue-headline">
            {queueHeadline(queue.length)}
          </div>
        </div>
        <div className="pruns-queue-action">
          <button
            type="button"
            className="pruns-btn is-primary"
            data-testid="approve-all"
            disabled={isApproving}
            onClick={onApproveAll}
          >
            {isApproving ? "Approving…" : `Approve all ${queue.length}`}
          </button>
          <div className="pruns-approve-note" data-testid="approve-all-note">
            Reveals every push command. Still nothing shipped.
          </div>
          {approvedCount !== null ? (
            <div className="pruns-approve-note" data-testid="approve-all-result">
              Approved {pluralRuns(approvedCount)}.
            </div>
          ) : null}
        </div>
      </div>

      <div className="pruns-queue-rows">
        {queue.map((r) => (
          <QueueRow key={r.id} run={r} />
        ))}
      </div>
    </section>
  );
}

function QueueRow({ run }: { run: PortfolioRunRow }) {
  return (
    <a
      className="pruns-queue-row"
      href={`/runs/${run.id}`}
      data-testid={`queue-row-${run.id}`}
      data-run-id={run.id}
    >
      <span className="pruns-avatar" aria-hidden="true">
        {initialFor(run.app_name)}
      </span>
      <span className="pruns-queue-main">
        <span className="pruns-queue-app">
          <span className="pruns-queue-app-name" data-testid="queue-app-name">
            {run.app_name}
          </span>
        </span>
        <span className="pruns-queue-meta">
          <span className="pruns-queue-status">{runStatusLabel(run.status)}</span>
          <span className="pruns-dot-sep">·</span>
          <span>detected {timeAgo(run.created_at, Date.now())}</span>
          <FindingsChip summary={run.findings_summary} />
        </span>
      </span>
      <span className="pruns-queue-cta">
        <span className="pruns-review">Review</span>
        <span className="pruns-caret" aria-hidden="true">
          ›
        </span>
      </span>
    </a>
  );
}

/**
 * Renders ONLY when a summary was actually measured. `null` means no summary
 * exists — not "zero critical findings" — so the whole clause is omitted.
 */
function FindingsChip({ summary }: { summary: FindingsSummary | null }) {
  if (!summary) return null;
  return (
    <span className="pruns-findings-chip" data-testid="queue-findings-chip">
      {summary.label}
    </span>
  );
}

function HistoryRow({ run }: { run: PortfolioRunRow }) {
  const tone = TONE[run.status] ?? "is-faint";
  return (
    <a
      className="pruns-history-row"
      href={`/runs/${run.id}`}
      data-testid={`history-row-${run.id}`}
      data-run-id={run.id}
    >
      <span className={`pruns-status-dot ${tone}`} aria-hidden="true" />
      <RunActorMark trigger={run.trigger} />
      <span className="pruns-history-app">{run.app_name}</span>
      <span className={`pruns-history-status ${tone}`}>{runStatusLabel(run.status)}</span>
      <span className="pruns-history-age">{timeAgo(run.created_at, Date.now())}</span>
      <span className="pruns-caret" aria-hidden="true">
        ›
      </span>
    </a>
  );
}
