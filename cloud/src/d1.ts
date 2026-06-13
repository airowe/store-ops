/**
 * Typed D1 query helpers — the only module that talks to `env.DB`.
 *
 * The API and cron layers go through these functions so the SQL lives in one
 * place and the row shapes are typed once. Every write that spans multiple
 * tables (a run + its proposals + snapshots) is grouped into a single helper so
 * the caller can't half-write a run.
 *
 * D1 has no cross-statement transaction in the Workers API, but `DB.batch([...])`
 * runs its statements atomically (all-or-nothing) on the same connection — we use
 * it for the multi-row writes (e.g. persisting a whole run).
 */
import type {
  AgentResult,
  Change,
  ProposedCopy,
  Rank,
  ScoredKeyword,
} from "./engine/index.js";
import type { RunStatus } from "./engine/constants.js";

// ── Row types (mirror schema.sql) ────────────────────────────────────────────

export type UserRow = { id: string; email: string; created_at: string };

export type AppRow = {
  id: string;
  user_id: string;
  bundle_id: string;
  name: string;
  country: string;
  created_at: string;
};

export type RunRow = {
  id: string;
  app_id: string;
  status: RunStatus;
  created_at: string;
  reasoning_json: string;
};

export type ProposalRow = {
  id: string;
  run_id: string;
  field: string;
  value: string;
  char_count: number;
};

export type ApprovalRow = {
  id: string;
  run_id: string;
  decision: "approved" | "rejected";
  decided_at: string;
};

export type RankSnapshotRow = {
  id: string;
  app_id: string;
  keyword: string;
  rank: number | null;
  total: number;
  checked_at: string;
};

export type CompetitorSnapshotRow = {
  id: string;
  app_id: string;
  comp_id: string;
  name: string;
  version: string;
  rating: string;
  seen_at: string;
};

/**
 * The decision trace we persist in runs.reasoning_json. This is the engine's
 * full `AgentResult` (minus the bulky competitor `listings`, which are stored as
 * normalized snapshot rows) plus the trigger reasons. The API serves it back to
 * the dashboard verbatim as `run.result`, so the frontend sees the exact engine
 * shapes (audit / ranks / competitors.changes / reasoning / proposedCopy /
 * pushCommands).
 */
export type ReasoningTrace = {
  audit: AgentResult["audit"];
  ranks: Rank[];
  competitors: {
    digest: string;
    changes: Change[];
  };
  reasoning: ScoredKeyword[];
  /** full proposed copy WITH validation (pass + per-field checks). */
  proposedCopy: ProposedCopy;
  pushCommands: AgentResult["pushCommands"];
  /** why this run was opened (cron threshold reasons, or "manual"/"connect"). */
  trigger: { source: "manual" | "cron" | "connect"; reasons: string[] };
};

// ── id helper (Workers have crypto.randomUUID) ───────────────────────────────

export const uuid = (): string => crypto.randomUUID();

const now = (): string => new Date().toISOString().replace("T", " ").slice(0, 19);

// ── users ────────────────────────────────────────────────────────────────────

/** Get-or-create the demo user by email (stubbed auth). Idempotent. */
export async function upsertUser(db: D1Database, email: string): Promise<UserRow> {
  const existing = await db
    .prepare("SELECT id, email, created_at FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
  if (existing) return existing;

  const row: UserRow = { id: uuid(), email, created_at: now() };
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .bind(row.id, row.email, row.created_at)
    .run();
  return row;
}

// ── apps ─────────────────────────────────────────────────────────────────────

/** Connect an app (or return the existing row for this user+bundle). */
export async function createApp(
  db: D1Database,
  input: { userId: string; bundleId: string; name: string; country: string },
): Promise<AppRow> {
  const existing = await db
    .prepare(
      "SELECT id, user_id, bundle_id, name, country, created_at FROM apps WHERE user_id = ? AND bundle_id = ?",
    )
    .bind(input.userId, input.bundleId)
    .first<AppRow>();
  if (existing) return existing;

  const row: AppRow = {
    id: uuid(),
    user_id: input.userId,
    bundle_id: input.bundleId,
    name: input.name,
    country: input.country,
    created_at: now(),
  };
  await db
    .prepare(
      "INSERT INTO apps (id, user_id, bundle_id, name, country, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.user_id, row.bundle_id, row.name, row.country, row.created_at)
    .run();
  return row;
}

export async function getApp(db: D1Database, appId: string): Promise<AppRow | null> {
  return db
    .prepare(
      "SELECT id, user_id, bundle_id, name, country, created_at FROM apps WHERE id = ?",
    )
    .bind(appId)
    .first<AppRow>();
}

/** All apps for a user, with the latest run's status/id folded in (for the list view). */
export async function listAppsForUser(
  db: D1Database,
  userId: string,
): Promise<Array<AppRow & { latest_run_id: string | null; latest_run_status: RunStatus | null }>> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.user_id, a.bundle_id, a.name, a.country, a.created_at,
              r.id AS latest_run_id, r.status AS latest_run_status
       FROM apps a
       LEFT JOIN runs r ON r.id = (
         SELECT id FROM runs WHERE app_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1
       )
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC`,
    )
    .bind(userId)
    .all<AppRow & { latest_run_id: string | null; latest_run_status: RunStatus | null }>();
  return results ?? [];
}

/** All apps across all users — the cron fan-out work list. */
export async function listAllApps(db: D1Database): Promise<AppRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, user_id, bundle_id, name, country, created_at FROM apps ORDER BY created_at ASC",
    )
    .all<AppRow>();
  return results ?? [];
}

// ── runs (+ proposals + snapshots), persisted atomically ─────────────────────

/**
 * Persist a full agent run: the run row (with the reasoning trace), every
 * proposal field, and the rank + competitor snapshots from this pass — all in
 * one atomic `DB.batch`. Returns the new run id.
 *
 * `status` is normally 'awaiting_approval' (the gate); the trace carries the
 * trigger reasons (manual / cron-threshold / connect).
 */
export async function persistRun(
  db: D1Database,
  args: {
    appId: string;
    status: RunStatus;
    result: AgentResult;
    trigger: ReasoningTrace["trigger"];
  },
): Promise<string> {
  const runId = uuid();
  const createdAt = now();
  const { result } = args;

  const trace: ReasoningTrace = {
    audit: result.audit,
    ranks: result.ranks,
    competitors: { digest: result.competitors.digest, changes: result.competitors.changes },
    reasoning: result.reasoning,
    proposedCopy: result.proposedCopy,
    pushCommands: result.pushCommands,
    trigger: args.trigger,
  };

  const stmts: D1PreparedStatement[] = [];

  stmts.push(
    db
      .prepare(
        "INSERT INTO runs (id, app_id, status, created_at, reasoning_json) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(runId, args.appId, args.status, createdAt, JSON.stringify(trace)),
  );

  // proposals — one row per copy field the agent committed to
  const copy: ProposedCopy = result.proposedCopy;
  const fields: Array<[string, string | undefined]> = [
    ["name", copy.name],
    ["subtitle", copy.subtitle],
    ["keywords", copy.keywords],
    ["promo", copy.promo],
    ["description", copy.description],
  ];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    stmts.push(
      db
        .prepare(
          "INSERT INTO proposals (id, run_id, field, value, char_count) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(uuid(), runId, field, value, value.length),
    );
  }

  // rank snapshots — one per checked keyword
  for (const r of result.ranks) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO rank_snapshots (id, app_id, keyword, rank, total, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid(), args.appId, r.keyword, r.rank, r.total, createdAt),
    );
  }

  // competitor snapshots — one per resolved listing
  for (const l of result.competitors.listings) {
    if (l.error) continue;
    stmts.push(
      db
        .prepare(
          "INSERT INTO competitor_snapshots (id, app_id, comp_id, name, version, rating, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid(), args.appId, l.key, l.name, l.version, l.rating, createdAt),
    );
  }

  await db.batch(stmts);
  return runId;
}

export async function getRun(db: D1Database, runId: string): Promise<RunRow | null> {
  return db
    .prepare(
      "SELECT id, app_id, status, created_at, reasoning_json FROM runs WHERE id = ?",
    )
    .bind(runId)
    .first<RunRow>();
}

/** All runs for an app, newest first (for the app-detail run history list). */
export async function listRunsForApp(
  db: D1Database,
  appId: string,
): Promise<Array<{ id: string; status: RunStatus; created_at: string }>> {
  const { results } = await db
    .prepare(
      "SELECT id, status, created_at FROM runs WHERE app_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(appId)
    .all<{ id: string; status: RunStatus; created_at: string }>();
  return results ?? [];
}

export async function getProposals(db: D1Database, runId: string): Promise<ProposalRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, run_id, field, value, char_count FROM proposals WHERE run_id = ? ORDER BY id",
    )
    .bind(runId)
    .all<ProposalRow>();
  return results ?? [];
}

export async function getApproval(db: D1Database, runId: string): Promise<ApprovalRow | null> {
  return db
    .prepare(
      "SELECT id, run_id, decision, decided_at FROM approvals WHERE run_id = ?",
    )
    .bind(runId)
    .first<ApprovalRow>();
}

/**
 * Record the human approval decision and move the run's status accordingly,
 * atomically. approve → status 'shipped' (commands are handed off, never run);
 * reject → status 'rejected'. The UNIQUE(run_id) constraint guarantees one gate
 * per run; a second call surfaces as a conflict to the caller.
 */
export async function recordApproval(
  db: D1Database,
  args: { runId: string; decision: "approved" | "rejected" },
): Promise<ApprovalRow> {
  const row: ApprovalRow = {
    id: uuid(),
    run_id: args.runId,
    decision: args.decision,
    decided_at: now(),
  };
  const nextStatus: RunStatus = args.decision === "approved" ? "shipped" : "rejected";

  await db.batch([
    db
      .prepare(
        "INSERT INTO approvals (id, run_id, decision, decided_at) VALUES (?, ?, ?, ?)",
      )
      .bind(row.id, row.run_id, row.decision, row.decided_at),
    db.prepare("UPDATE runs SET status = ? WHERE id = ?").bind(nextStatus, args.runId),
  ]);
  return row;
}

export async function setRunStatus(
  db: D1Database,
  runId: string,
  status: RunStatus,
): Promise<void> {
  await db.prepare("UPDATE runs SET status = ? WHERE id = ?").bind(status, runId).run();
}

// ── snapshots: reads for trend charts + cron diffing ─────────────────────────

/** Rank history for an app (oldest → newest), for the trend chart. */
export async function getRankHistory(
  db: D1Database,
  appId: string,
  opts: { keyword?: string; limit?: number } = {},
): Promise<RankSnapshotRow[]> {
  const limit = opts.limit ?? 500;
  if (opts.keyword) {
    const { results } = await db
      .prepare(
        `SELECT id, app_id, keyword, rank, total, checked_at
         FROM rank_snapshots WHERE app_id = ? AND keyword = ?
         ORDER BY checked_at ASC, id ASC LIMIT ?`,
      )
      .bind(appId, opts.keyword, limit)
      .all<RankSnapshotRow>();
    return results ?? [];
  }
  const { results } = await db
    .prepare(
      `SELECT id, app_id, keyword, rank, total, checked_at
       FROM rank_snapshots WHERE app_id = ?
       ORDER BY checked_at ASC, id ASC LIMIT ?`,
    )
    .bind(appId, limit)
    .all<RankSnapshotRow>();
  return results ?? [];
}

/**
 * The most recent competitor snapshot per comp_id for an app, shaped into the
 * `previousCompetitors` map the engine's `diff` expects:
 *   { compId: { name, version, rating } }
 * Used by the cron to diff the new pass against the last one.
 */
export async function getLatestCompetitorMap(
  db: D1Database,
  appId: string,
): Promise<Record<string, Record<string, string>>> {
  const { results } = await db
    .prepare(
      `SELECT cs.comp_id, cs.name, cs.version, cs.rating
       FROM competitor_snapshots cs
       JOIN (
         SELECT comp_id, MAX(seen_at) AS max_seen
         FROM competitor_snapshots WHERE app_id = ? GROUP BY comp_id
       ) latest ON latest.comp_id = cs.comp_id AND latest.max_seen = cs.seen_at
       WHERE cs.app_id = ?`,
    )
    .bind(appId, appId)
    .all<{ comp_id: string; name: string; version: string; rating: string }>();

  const map: Record<string, Record<string, string>> = {};
  for (const r of results ?? []) {
    map[r.comp_id] = { name: r.name, version: r.version, rating: r.rating };
  }
  return map;
}

/** The latest rank per keyword for an app (for cron threshold checks). */
export async function getLatestRanks(
  db: D1Database,
  appId: string,
): Promise<Array<{ keyword: string; rank: number | null }>> {
  const { results } = await db
    .prepare(
      `SELECT rs.keyword, rs.rank
       FROM rank_snapshots rs
       JOIN (
         SELECT keyword, MAX(checked_at) AS max_checked
         FROM rank_snapshots WHERE app_id = ? GROUP BY keyword
       ) latest ON latest.keyword = rs.keyword AND latest.max_checked = rs.checked_at
       WHERE rs.app_id = ?`,
    )
    .bind(appId, appId)
    .all<{ keyword: string; rank: number | null }>();
  return results ?? [];
}

/** True if the app already has a run still waiting on the human gate. */
export async function hasOpenRun(db: D1Database, appId: string): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM runs WHERE app_id = ? AND status = 'awaiting_approval' LIMIT 1",
    )
    .bind(appId)
    .first<{ id: string }>();
  return row !== null;
}
