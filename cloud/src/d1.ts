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
  AscContext,
  Change,
  CopyFields,
  CoverageReport,
  Finding,
  KeywordGap,
  LocaleRecommendation,
  Opportunity,
  ProposedCopy,
  PushCommand,
  Rank,
  ScoredKeyword,
  SurfaceLock,
} from "./engine/index.js";
import type { RunStatus } from "./engine/constants.js";

// ── Row types (mirror schema.sql) ────────────────────────────────────────────

export type Tier = "free" | "launch" | "autopilot" | "fleet";

export type UserRow = {
  id: string;
  email: string;
  created_at: string;
  tier: Tier;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  github_installation_id: string | null;
  github_repo: string | null;
};

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
  /** the CURRENT copy the proposal diffs against (the run-page 'before'). */
  currentCopy: AgentResult["currentCopy"];
  /** full proposed copy WITH validation (pass + per-field checks). */
  proposedCopy: ProposedCopy;
  pushCommands: AgentResult["pushCommands"];
  /**
   * Scored, prioritized listing findings (PRD 01/02). EVERY run carries them —
   * the thin public-only set + `asc_unlock` on a no-key run, the full set on a
   * Mode-A run. Served to the client; safe (curated copy, no raw ASC data).
   */
  findings?: Finding[] | undefined;
  /**
   * Locked-field upgrade surfaces (#61) — the surfaces a no-key run could NOT
   * read, each rendered as an honest inline "unlock to see + improve" lock. Empty
   * on a Mode-A run. Static capability/opportunity copy only (no ASC data) — safe
   * to serve. Absent on older traces (the UI falls back to isNoKeyRun).
   */
  locks?: SurfaceLock[] | undefined;
  /**
   * The slim, PII-safe display context for the findings card (category, counts,
   * version state) — present only on a Mode-A run. The full `ascSnapshot` is
   * deliberately NOT stored on the trace: it stays out of the client-served JSON.
   */
  ascContext?: AscContext | undefined;
  /**
   * ASC findings counts for the dashboard badge (PRD 04). Findings-only summary —
   * never raw ASC data. Absent on older traces (the badge degrades to none).
   */
  findingsSummary?: FindingsSummary | undefined;
  /**
   * Winnability-ranked keyword opportunities (PRD 06) — "where to push next."
   * Curated copy + drivers only; never raw ASC data. Absent on older traces (the
   * panel degrades to none). Sorted by opportunityScore desc by the engine.
   */
  opportunities?: Opportunity[] | undefined;
  /**
   * Keyword gaps (PRD 01): terms competitors VISIBLY use that you don't target or
   * rank top-50 for, sorted by winnability with a `fitsBudget` flag. Names-only
   * competitor attribution — safe to serve. Absent on older traces.
   */
  keywordGaps?: KeywordGap[] | undefined;
  /**
   * Metadata coverage report (PRD 03) — budget-efficiency score + itemized waste.
   * Computed in the run path from the current copy; served to the client (curated
   * counts + copy only, no raw ASC). Absent on older traces + runs with no copy.
   */
  coverage?: CoverageReport | undefined;
  /**
   * Localization expansion recommendations (PRD 04). ROI-sorted locales to add,
   * from a STATIC, bundled heuristic — never raw ASC data, never fabricated install
   * numbers. Derived only from live locale codes + the category name, so it's safe
   * to serve to the client. Present only on a Mode-A run that read the locale set.
   */
  localizationExpansion?: LocaleRecommendation[] | undefined;
  /** why this run was opened (cron threshold reasons, or "manual"/"connect"). */
  trigger: { source: "manual" | "cron" | "connect"; reasons: string[] };
};

/** Slim, counts-only finding summary for the dashboard badge (PRD 04). */
export type FindingsSummary = {
  total: number;
  critical: number;
  warn: number;
  good: number;
  info: number;
  /** the badge/card one-liner, e.g. "3 fixes available · 1 critical". */
  label: string;
};

// ── id helper (Workers have crypto.randomUUID) ───────────────────────────────

export const uuid = (): string => crypto.randomUUID();

const now = (): string => new Date().toISOString().replace("T", " ").slice(0, 19);

// ── users ────────────────────────────────────────────────────────────────────

const USER_COLS =
  "id, email, created_at, tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, github_installation_id, github_repo";

/** Get-or-create a user by email (magic-link/session resolves to this). Idempotent. */
export async function upsertUser(db: D1Database, email: string): Promise<UserRow> {
  const existing = await db
    .prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
  if (existing) return existing;

  const row: UserRow = {
    id: uuid(),
    email,
    created_at: now(),
    tier: "free",
    status: "active",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    github_installation_id: null,
    github_repo: null,
  };
  await db
    .prepare("INSERT INTO users (id, email, created_at, tier, status) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.email, row.created_at, row.tier, row.status)
    .run();
  return row;
}

export async function getUser(db: D1Database, userId: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`)
    .bind(userId)
    .first<UserRow>();
}

/** Save (or clear) a user's GitHub App connection — installation id + target repo. */
export async function setGithubConnection(
  db: D1Database,
  args: { userId: string; installationId: string | null; repo?: string | null },
): Promise<void> {
  const sets = ["github_installation_id = ?"];
  const binds: Array<string | null> = [args.installationId];
  if (args.repo !== undefined) {
    sets.push("github_repo = ?");
    binds.push(args.repo);
  }
  binds.push(args.userId);
  await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
}

/** The user's current tier (defaults to 'free' if the row is somehow missing). */
export async function getTier(db: D1Database, userId: string): Promise<Tier> {
  const row = await db
    .prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: Tier }>();
  return row?.tier ?? "free";
}

/**
 * Update a user's billing state (the webhook + checkout flows call this). Only
 * the provided fields are written; omit a field to leave it untouched.
 */
export async function setTier(
  db: D1Database,
  args: {
    userId: string;
    tier?: Tier;
    status?: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const binds: Array<string | null> = [];
  if (args.tier !== undefined) {
    sets.push("tier = ?");
    binds.push(args.tier);
  }
  if (args.status !== undefined) {
    sets.push("status = ?");
    binds.push(args.status);
  }
  if (args.stripeCustomerId !== undefined) {
    sets.push("stripe_customer_id = ?");
    binds.push(args.stripeCustomerId);
  }
  if (args.stripeSubscriptionId !== undefined) {
    sets.push("stripe_subscription_id = ?");
    binds.push(args.stripeSubscriptionId);
  }
  if (args.currentPeriodEnd !== undefined) {
    sets.push("current_period_end = ?");
    binds.push(args.currentPeriodEnd);
  }
  if (sets.length === 0) return;
  binds.push(args.userId);
  await db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}

/** Find a user by their Stripe customer id (webhook → local user resolution). */
export async function getUserByStripeCustomer(
  db: D1Database,
  customerId: string,
): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLS} FROM users WHERE stripe_customer_id = ?`)
    .bind(customerId)
    .first<UserRow>();
}

/** How many apps this user has connected (for the per-tier app-count gate). */
export async function countAppsForUser(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM apps WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── subscribers (landing email capture) ──────────────────────────────────────

/**
 * Record a launch-list signup. Idempotent on email (INSERT OR IGNORE), so a
 * repeat submit is a no-op, not an error. Returns true if a new row was added.
 */
export async function recordSubscriber(
  db: D1Database,
  email: string,
  source: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      "INSERT OR IGNORE INTO subscribers (id, email, source) VALUES (?, ?, ?)",
    )
    .bind(uuid(), email, source)
    .run();
  return (res.meta?.changes ?? 0) > 0;
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

/**
 * Delete an app and everything under it, atomically. The schema declares
 * ON DELETE CASCADE, but FK enforcement isn't guaranteed on every D1 connection,
 * so we delete the children EXPLICITLY (proposals/approvals via their runs, then
 * runs, rank/competitor snapshots, then the app) in one batch — no orphans.
 */
export async function deleteApp(db: D1Database, appId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM approvals WHERE run_id IN (SELECT id FROM runs WHERE app_id = ?)").bind(appId),
    db.prepare("DELETE FROM proposals WHERE run_id IN (SELECT id FROM runs WHERE app_id = ?)").bind(appId),
    db.prepare("DELETE FROM runs WHERE app_id = ?").bind(appId),
    db.prepare("DELETE FROM rank_snapshots WHERE app_id = ?").bind(appId),
    db.prepare("DELETE FROM competitor_snapshots WHERE app_id = ?").bind(appId),
    db.prepare("DELETE FROM apps WHERE id = ?").bind(appId),
  ]);
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
    currentCopy: result.currentCopy,
    proposedCopy: result.proposedCopy,
    pushCommands: result.pushCommands,
    // Findings/ascContext ride along when the run path computed them. We copy
    // ONLY the slim ascContext — never the raw `ascSnapshot` (it's omitted here
    // on purpose so it can't reach the client via the trace).
    ...(result.findings !== undefined ? { findings: result.findings } : {}),
    // Locked-field upgrade surfaces (#61) ride along when computed — static
    // capability/opportunity copy only (no raw ASC). Persisted so the run page
    // renders the inline 🔒 locks verbatim; empty on a keyed run.
    ...(result.locks !== undefined ? { locks: result.locks } : {}),
    ...(result.ascContext !== undefined ? { ascContext: result.ascContext } : {}),
    ...(result.opportunities !== undefined ? { opportunities: result.opportunities } : {}),
    // Keyword gaps (PRD 01) ride along when computed — names-only attribution,
    // safe to serve. Persisted on the trace so the run page renders them verbatim.
    ...(result.keywordGaps !== undefined ? { keywordGaps: result.keywordGaps } : {}),
    // Coverage report (PRD 03): budget-efficiency score + waste, curated copy +
    // counts only (no raw ASC). Rides along when the run path computed it.
    ...(result.coverage !== undefined ? { coverage: result.coverage } : {}),
    ...(result.localizationExpansion !== undefined
      ? { localizationExpansion: result.localizationExpansion }
      : {}),
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
 * atomically. approve → status 'approved' (the push commands are revealed but
 * never run — nothing has reached App Store Connect yet, so we do NOT claim
 * 'shipped'); reject → status 'rejected'. 'shipped' is reserved for a verified
 * push that actually reached Apple. The UNIQUE(run_id) constraint guarantees one
 * gate per run; a second call surfaces as a conflict to the caller.
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
  const nextStatus: RunStatus = args.decision === "approved" ? "approved" : "rejected";

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

/**
 * Persist the FINALIZED copy onto a run after a human edited the proposal and
 * cleared the gate (#39 Part 1, approach (a)). Rewrites the run trace's
 * `proposedCopy` + `pushCommands` (additive — every other trace field is kept
 * verbatim) and replaces the normalized `proposals` rows. Because the downstream
 * handoffs all read `trace.proposedCopy` / `trace.pushCommands`, this is the only
 * write needed for the edited copy to ship — no handoff route changes.
 *
 * The copy is the already-validated, already-merged result from
 * `finalizeEditedCopy`; the caller MUST have confirmed `validation.pass` first.
 * The whole rewrite runs in one atomic `db.batch` so the trace and the proposals
 * rows can never disagree.
 */
export async function updateRunCopy(
  db: D1Database,
  args: { runId: string; copy: CopyFields; pushCommands: PushCommand[] },
): Promise<void> {
  const run = await db
    .prepare("SELECT reasoning_json FROM runs WHERE id = ?")
    .bind(args.runId)
    .first<{ reasoning_json: string }>();
  if (!run) return;

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  // preserve the existing validation block's shape: it was already re-run by the
  // caller (finalizeEditedCopy), so carry it onto the trace's ProposedCopy.
  const prevValidation = trace.proposedCopy?.validation;
  trace.proposedCopy = {
    ...trace.proposedCopy,
    ...args.copy,
    ...(prevValidation !== undefined ? { validation: prevValidation } : {}),
  } as ProposedCopy;
  trace.pushCommands = args.pushCommands;

  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE runs SET reasoning_json = ? WHERE id = ?")
      .bind(JSON.stringify(trace), args.runId),
    db.prepare("DELETE FROM proposals WHERE run_id = ?").bind(args.runId),
  ];

  const fields: Array<[string, string | undefined]> = [
    ["name", args.copy.name],
    ["subtitle", args.copy.subtitle],
    ["keywords", args.copy.keywords],
    ["promo", args.copy.promo],
    ["description", args.copy.description],
  ];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    stmts.push(
      db
        .prepare(
          "INSERT INTO proposals (id, run_id, field, value, char_count) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(uuid(), args.runId, field, value, value.length),
    );
  }

  await db.batch(stmts);
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
