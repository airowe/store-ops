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
  ChartRank,
  LanguageCoverage,
  LocaleRecommendation,
  LocalizedCopyEntry,
  Opportunity,
  PlayChartRank,
  PpoTreatmentPlan,
  ProposedCopy,
  PushCommand,
  Rank,
  ReviewSentiment,
  ScoredKeyword,
  SurfaceLock,
} from "./engine/index.js";
import type { RunStatus } from "./engine/constants.js";
import type { EngagementRow } from "./engine/analyticsEngagement.js";
import type { CommerceRow } from "./engine/analyticsCommerce.js";
import type { UsageRow } from "./engine/analyticsUsage.js";
import { buildPreferenceRows } from "./engine/preferenceSignal.js";
import { encryptField } from "./crypto/rlhfCrypto.js";
import {
  importKek,
  openCredential,
  sealCredential,
  type SealedCredential,
  type VaultContext,
} from "./crypto/credentialVault.js";
import { currentKek, kekForVersion } from "./credentialStore.js";
import { effectiveTier } from "./billing.js";
import type { Env } from "./index.js";

// ── Row types (mirror schema.sql) ────────────────────────────────────────────

export type Tier = "free" | "indie" | "startup" | "scale";

/**
 * How often the cron snapshots an app's ranks (issue #94). 'weekly' (the default)
 * records ranks during the Monday autonomous sweep only; 'daily' adds a separate
 * lightweight daily rank snapshot WITHOUT running the draft/threshold/open-run
 * logic. The autonomous DRAFT cadence stays weekly/threshold-governed either way.
 */
export type RankCadence = "daily" | "weekly";

/**
 * Communication preference: the weekly digest email (comms-prefs Phase 1).
 * 'weekly' (default) = today's behavior; 'off' silences the digest for EVERY
 * app the user owns (the digest fans out per app; the pref is per-user). An
 * enum, not a boolean, so a future 'daily' digest slots into the same column.
 * Changing this NEVER changes what the agent does — only what we send.
 */
export type EmailDigest = "weekly" | "off";

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
  /** owner paused the weekly autonomous sweep (issue #51). 0/1 in SQLite → boolean here. */
  agent_paused: boolean;
  rlhf_opt_out: number; // 0 = capturing (default), 1 = opted out (#39 Part 2)
  /** how often the cron snapshots ranks (issue #94). 'weekly' default; 'daily' adds the lightweight daily snapshot. */
  rank_cadence: RankCadence;
  /** weekly digest email pref (comms-prefs). 'off' = no digest; the sweep runs regardless. */
  email_digest: EmailDigest;
  /** run-ready push pref (comms-prefs). false = notifyRunAwaitingApproval sends nothing. 0/1 in SQLite → boolean here. */
  push_run_ready: boolean;
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
  /** storefront the rank was checked in (lowercased ISO); '' = legacy row (#180 Phase 1). */
  country: string;
  checked_at: string;
};

/** Normalize a storefront code for rank_snapshots.country (lowercased, trimmed). */
function normCountry(country: string | undefined): string {
  return (country ?? "").trim().toLowerCase();
}

/** One persisted Play category-chart rank sample (ranking-parity step 1). */
export type PlayRankSnapshotRow = {
  id: string;
  app_id: string;
  package_name: string;
  collection: string;
  category: string;
  country: string;
  /** NULL = read the chart, app not in top out_of (honest "not charting"). */
  position: number | null;
  out_of: number;
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
  /**
   * Who authored the most recent STAGED edit to `proposedCopy` (migration
   * 0013). Read at the gate so the RLHF row records an agent-drafted approval
   * as such, instead of as a human preference. Absent on runs nothing staged
   * and on every trace written before this field existed — both mean 'human'.
   */
  lastEditSource?: ProposalEditSource;
  /**
   * #78 Phase 2: per-locale drafts the human APPROVED for handoff (locale →
   * fitted copy). Written ONLY by the explicit approve route; the fastlane
   * bundle emits exactly these locales and nothing else.
   */
  localizedCopy?: Record<string, LocalizedCopyEntry> | undefined;
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
  /** #182 Phase 3 — a proposed outcome-led PPO treatment brief (read-only). */
  ppoTreatment?: PpoTreatmentPlan | undefined;
  /** storefront-intel PRD 03 — measured language-level coverage for keyless runs. */
  languageCoverage?: LanguageCoverage | undefined;
  /** analytics-reports PRD 04 map — public category chart rank. */
  chartRank?: ChartRank | undefined;
  /**
   * PUBLIC review sentiment (#95) — overall sentiment + ranked OBSERVED topics
   * from Apple's free RSS customer-reviews feed. Sample size `n` ALWAYS carried;
   * the score is SUPPRESSED below threshold (#78). Public data only — safe to
   * serve. Absent on older traces + runs that fetched no reviews.
   */
  reviews?: ReviewSentiment | undefined;
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

import type { ChannelKind, Destination } from "./notify/channel.js";

export const uuid = (): string => crypto.randomUUID();

const now = (): string => new Date().toISOString().replace("T", " ").slice(0, 19);

// ── users ────────────────────────────────────────────────────────────────────

// NOTE: the migration-0012 columns (stripe_tier, iap_tier, iap_status,
// iap_product_id, iap_period_end, revenuecat_app_user_id) are deliberately NOT in
// USER_COLS — like `asc_write_opt_in` (0011), a migration-only column stays out of
// the shared SELECT so a schema.sql-only test DB (and any not-yet-migrated read)
// doesn't 'no such column'. They're written by setTier's targeted UPDATE and read
// by recomputeEffectiveTier's own SELECT.
const USER_COLS =
  "id, email, created_at, tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, github_installation_id, github_repo, agent_paused, rlhf_opt_out, rank_cadence, email_digest, push_run_ready";

/** SQLite stores booleans as 0/1, and pre-migration rows may lack newer columns. */
type RawUserRow = Omit<UserRow, "agent_paused" | "rank_cadence" | "email_digest" | "push_run_ready"> & {
  agent_paused?: number | null;
  rank_cadence?: RankCadence | null;
  email_digest?: EmailDigest | null;
  push_run_ready?: number | null;
};

/**
 * Normalize a raw `users` row from D1 into a `UserRow`. SQLite has no boolean,
 * so `agent_paused` comes back as 0/1 (or undefined on a legacy pre-migration
 * row) — fold it to a real boolean so callers never compare against `1`.
 * `rlhf_opt_out` (#39 Part 2) stays a 0/1 number and passes through unchanged.
 * `rank_cadence` (#94), `email_digest` and `push_run_ready` (comms-prefs)
 * default to today's behavior when null/absent, so a NULL-carrying row reads
 * as unchanged defaults. NOTE: this coalescing does NOT excuse deploy order —
 * USER_COLS names the new columns, so the ALTER migration must be applied
 * BEFORE a Worker referencing them is deployed (see schema.sql).
 */
function mapUserRow(raw: RawUserRow | null): UserRow | null {
  if (!raw) return null;
  return {
    ...raw,
    agent_paused: raw.agent_paused === 1,
    rank_cadence: raw.rank_cadence ?? "weekly",
    email_digest: raw.email_digest ?? "weekly",
    // default ON (fail-open = today's behavior): 0 is the only opt-out value.
    push_run_ready: raw.push_run_ready !== 0,
  };
}

/** Get-or-create a user by email (magic-link/session resolves to this). Idempotent. */
export async function upsertUser(db: D1Database, email: string): Promise<UserRow> {
  const existing = mapUserRow(
    await db
      .prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`)
      .bind(email)
      .first<RawUserRow>(),
  );
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
    agent_paused: false,
    rlhf_opt_out: 0, // capture is ON by default; the settings toggle sets this
    rank_cadence: "weekly", // weekly snapshotting by default (#94); the settings toggle opts into daily
    email_digest: "weekly", // digest on by default (comms-prefs); settings/unsubscribe turn it off
    push_run_ready: true, // run-ready push on by default (comms-prefs)
  };
  await db
    .prepare("INSERT INTO users (id, email, created_at, tier, status) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.email, row.created_at, row.tier, row.status)
    .run();
  return row;
}

export async function getUser(db: D1Database, userId: string): Promise<UserRow | null> {
  return mapUserRow(
    await db
      .prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`)
      .bind(userId)
      .first<RawUserRow>(),
  );
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
    /** Tier granted by the Stripe (web) source. Prefer this over `tier` for the
     *  Stripe webhook — `tier` is now the materialized effective value that
     *  `recomputeEffectiveTier` derives from `stripe_tier` + `iap_tier`. */
    stripeTier?: Tier;
    iapTier?: Tier | null;
    iapStatus?: string | null;
    iapProductId?: string | null;
    iapPeriodEnd?: string | null;
    revenuecatAppUserId?: string | null;
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
  if (args.stripeTier !== undefined) {
    sets.push("stripe_tier = ?");
    binds.push(args.stripeTier);
  }
  if (args.iapTier !== undefined) {
    sets.push("iap_tier = ?");
    binds.push(args.iapTier);
  }
  if (args.iapStatus !== undefined) {
    sets.push("iap_status = ?");
    binds.push(args.iapStatus);
  }
  if (args.iapProductId !== undefined) {
    sets.push("iap_product_id = ?");
    binds.push(args.iapProductId);
  }
  if (args.iapPeriodEnd !== undefined) {
    sets.push("iap_period_end = ?");
    binds.push(args.iapPeriodEnd);
  }
  if (args.revenuecatAppUserId !== undefined) {
    sets.push("revenuecat_app_user_id = ?");
    binds.push(args.revenuecatAppUserId);
  }
  if (sets.length === 0) return;
  binds.push(args.userId);
  await db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}

/**
 * Recompute and persist a user's effective `tier` — the highest active of their
 * Stripe (web) and RevenueCat (IAP) source tiers (policy: highest active tier
 * wins). Call after either billing webhook mutates a source. A no-op when the
 * effective tier is unchanged. Returns the effective tier.
 */
export async function recomputeEffectiveTier(db: D1Database, userId: string): Promise<Tier> {
  // Dedicated SELECT (not USER_COLS): the source columns are migration-0012-only.
  const row = await db
    .prepare("SELECT tier, stripe_tier, iap_tier FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: Tier; stripe_tier: Tier | null; iap_tier: Tier | null }>();
  if (!row) return "free";
  const eff = effectiveTier(row.stripe_tier, row.iap_tier);
  if (eff !== row.tier) {
    await db.prepare("UPDATE users SET tier = ? WHERE id = ?").bind(eff, userId).run();
  }
  return eff;
}

/**
 * Is this user opted OUT of RLHF capture? Capture is ON by default (returns
 * false when the row is missing), so the privacy-honoring read is conservative
 * only in that an opted-out user is never captured. Mirrors `getTier`.
 */
export async function getOptOut(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT rlhf_opt_out FROM users WHERE id = ?")
    .bind(userId)
    .first<{ rlhf_opt_out: number }>();
  return (row?.rlhf_opt_out ?? 0) === 1;
}

/** Set a user's RLHF opt-out flag (the settings toggle calls this). */
export async function setOptOut(
  db: D1Database,
  args: { userId: string; optOut: boolean },
): Promise<void> {
  await db
    .prepare("UPDATE users SET rlhf_opt_out = ? WHERE id = ?")
    .bind(args.optOut ? 1 : 0, args.userId)
    .run();
}

/**
 * Has this user opted IN to ShipASO performing App Store Connect writes on their
 * behalf — screenshot upload, PPO experiment, CPP create (#374)?
 *
 * Fails CLOSED: a missing row or a missing flag reads as `false`. The opposite
 * default would mean an unknown user is treated as having consented to mutating
 * a live listing, which is the failure this flag exists to prevent.
 *
 * This is CONSENT ONLY. A write additionally requires a paid tier
 * (`canAscWrite`), an approved run, and an explicit click — this answers just
 * "did the user say yes".
 */
export async function getAscWriteOptIn(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT asc_write_opt_in FROM users WHERE id = ?")
    .bind(userId)
    .first<{ asc_write_opt_in: number }>();
  return (row?.asc_write_opt_in ?? 0) === 1;
}

/** Set a user's ASC-write consent (the settings toggle calls this). */
export async function setAscWriteOptIn(
  db: D1Database,
  args: { userId: string; optIn: boolean },
): Promise<void> {
  await db
    .prepare("UPDATE users SET asc_write_opt_in = ? WHERE id = ?")
    .bind(args.optIn ? 1 : 0, args.userId)
    .run();
}

/**
 * Where the FINAL approved text came from (migration 0013).
 *   'human'       the human wrote or kept the value themselves
 *   'agent-draft' a page agent drafted it; the human approved that draft
 * Deliberately not CHECK-constrained in SQL — post-judging work adds more
 * sources, and a CHECK would force rebuilding a table of unrecoverable
 * encrypted rows. This type is the validation.
 */
export type ProposalEditSource = "human" | "agent-draft";

/**
 * Build the ANONYMOUS, ENCRYPTED `proposal_edits` INSERT statements for a decided
 * run (#39 Part 2), to be APPENDED to recordApproval's atomic batch so the
 * captured signal can never disagree with the recorded gate decision.
 *
 * Privacy by construction:
 *   • SAFE-DEGRADE — when `key` is null (env.RLHF_ENCRYPTION_KEY unset), returns
 *     [] and writes nothing. The approval proceeds normally.
 *   • ANONYMOUS — the INSERT carries NO user_id / NO app_id. A row cannot be
 *     traced to a user or app. (The OPT-OUT is honored upstream at the call site:
 *     an opted-out user never reaches this function, so it writes zero rows.)
 *   • ENCRYPTED — `proposed`/`final` are AES-256-GCM sealed before binding; the
 *     plaintext copy is never stored.
 *
 * PROVENANCE (migration 0013): `source` records where the FINAL text came from.
 * A page agent can draft an alternative that the human then approves unchanged
 * — which writes edited = 0, "shipped as proposed", indistinguishable from the
 * human assenting to the ORIGINAL agent's copy. Without this the RLHF signal
 * silently records an agent decision as a human preference. Defaults to
 * 'human', which is both today's behavior and the only thing pre-0013 rows can
 * be. 'human' | 'agent-draft' is a provenance CLASS, not an identifier — the
 * table stays fully anonymous.
 */
export async function captureProposalEdits(
  db: D1Database,
  key: CryptoKey | null,
  args: {
    proposed: Partial<CopyFields>;
    final: Partial<CopyFields>;
    decision: "approved" | "rejected";
    /** Where the FINAL text came from. Omitted ⇒ 'human' (the pre-0013 path). */
    source?: ProposalEditSource;
  },
): Promise<D1PreparedStatement[]> {
  if (!key) return []; // safe-degrade: no key ⇒ no capture, no error
  const source: ProposalEditSource = args.source ?? "human";
  const rows = buildPreferenceRows(args);
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const proposedEnc = await encryptField(key, r.proposed);
    const finalEnc = await encryptField(key, r.final);
    stmts.push(
      db
        .prepare(
          "INSERT INTO proposal_edits (id, field, decision, edited, proposed_enc, final_enc, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid(), r.field, r.decision, r.edited ? 1 : 0, proposedEnc, finalEnc, now(), source),
    );
  }
  return stmts;
}

/** Find a user by their Stripe customer id (webhook → local user resolution). */
export async function getUserByStripeCustomer(
  db: D1Database,
  customerId: string,
): Promise<UserRow | null> {
  return mapUserRow(
    await db
      .prepare(`SELECT ${USER_COLS} FROM users WHERE stripe_customer_id = ?`)
      .bind(customerId)
      .first<RawUserRow>(),
  );
}

/**
 * Is the autonomous weekly sweep paused for this target (issue #51)? Pause is
 * PER-USER today: the only persisted flag is `users.agent_paused`, set via the
 * /agent/pause|/resume routes. `appId` is accepted as an extension point — the
 * cron passes it so a future per-app override (an additive `apps.agent_paused`
 * column + an OR-fold here) needs no call-site change — but until that column
 * exists we resolve the app to its OWNER and read the per-user flag. This must
 * NOT reference `apps.agent_paused`: that column isn't in the schema, and doing
 * so threw `no such column` on every cron sweep. Defaults to NOT paused on a
 * missing row, preserving today's behavior for everyone.
 */
export async function isAgentPaused(
  db: D1Database,
  target: { userId: string; appId?: string },
): Promise<boolean> {
  if (target.appId !== undefined) {
    // Resolve the app to its owner and read the per-user flag. (When a per-app
    // column lands, OR-fold it in here — the cron call site stays unchanged.)
    const row = await db
      .prepare(
        `SELECT u.agent_paused AS agent_paused
           FROM apps a JOIN users u ON u.id = a.user_id
          WHERE a.id = ?`,
      )
      .bind(target.appId)
      .first<{ agent_paused: number | null }>();
    return row?.agent_paused === 1;
  }
  const row = await db
    .prepare("SELECT agent_paused FROM users WHERE id = ?")
    .bind(target.userId)
    .first<{ agent_paused: number | null }>();
  return row?.agent_paused === 1;
}

/**
 * Pause or resume the autonomous sweep (issue #51). Per-user: writes the boolean
 * as 0/1 to `users.agent_paused`. Modeled on `setTier`'s partial-update shape.
 *
 * Per-app pause is a deliberate non-goal here (see the PRD): the schema has no
 * `apps.agent_paused` column, so this never writes one — a per-app override is an
 * additive follow-up (add the column, extend isAgentPaused's OR-fold, add a
 * per-app route). Until then a paused owner silences every app they own.
 */
export async function setAgentPaused(
  db: D1Database,
  args: { userId: string; paused: boolean },
): Promise<void> {
  await db
    .prepare("UPDATE users SET agent_paused = ? WHERE id = ?")
    .bind(args.paused ? 1 : 0, args.userId)
    .run();
}

/**
 * This user's rank-snapshot cadence (issue #94). Per-user, modeled on `getTier`:
 * defaults to 'weekly' on a missing/null row so legacy users keep today's weekly
 * behavior. The daily snapshot cron reads this to decide which apps to snapshot.
 */
export async function getRankCadence(db: D1Database, userId: string): Promise<RankCadence> {
  const row = await db
    .prepare("SELECT rank_cadence FROM users WHERE id = ?")
    .bind(userId)
    .first<{ rank_cadence: RankCadence | null }>();
  return row?.rank_cadence ?? "weekly";
}

/**
 * Set this user's rank-snapshot cadence (the settings toggle calls this). Per-user:
 * writes the enum to `users.rank_cadence`. Mirrors `setAgentPaused`/`setOptOut`.
 */
export async function setRankCadence(
  db: D1Database,
  args: { userId: string; cadence: RankCadence },
): Promise<void> {
  await db
    .prepare("UPDATE users SET rank_cadence = ? WHERE id = ?")
    .bind(args.cadence, args.userId)
    .run();
}

/**
 * The user's communication prefs (comms-prefs Phase 1; email_run_ready added by
 * migration 0013).
 *
 * `email_digest` and `email_run_ready` answer DIFFERENT questions and are
 * deliberately independent: the digest is "send me the weekly roundup", while
 * run-ready is "tell me when work lands at the gate". Silencing one must never
 * silence the other — #493 is precisely the failure where work lands and
 * nothing says so.
 *
 * Missing/NULL → defaults (fail-open to the historical behavior).
 */
export type NotificationPrefs = {
  email_digest: EmailDigest;
  push_run_ready: boolean;
  email_run_ready: boolean;
};

export async function getNotificationPrefs(db: D1Database, userId: string): Promise<NotificationPrefs> {
  const row = await db
    .prepare("SELECT email_digest, push_run_ready, email_run_ready FROM users WHERE id = ?")
    .bind(userId)
    .first<{
      email_digest: EmailDigest | null;
      push_run_ready: number | null;
      email_run_ready: number | null;
    }>();
  return {
    email_digest: row?.email_digest ?? "weekly",
    push_run_ready: row ? row.push_run_ready !== 0 : true,
    email_run_ready: row ? row.email_run_ready !== 0 : true,
  };
}

/**
 * Partial-update the communication prefs (the settings toggles call this).
 * Only the provided fields change; validation happens at the API edge.
 */
export async function setNotificationPrefs(
  db: D1Database,
  args: {
    userId: string;
    email_digest?: EmailDigest;
    push_run_ready?: boolean;
    email_run_ready?: boolean;
  },
): Promise<void> {
  if (args.email_digest !== undefined) {
    await db
      .prepare("UPDATE users SET email_digest = ? WHERE id = ?")
      .bind(args.email_digest, args.userId)
      .run();
  }
  if (args.push_run_ready !== undefined) {
    await db
      .prepare("UPDATE users SET push_run_ready = ? WHERE id = ?")
      .bind(args.push_run_ready ? 1 : 0, args.userId)
      .run();
  }
  if (args.email_run_ready !== undefined) {
    await db
      .prepare("UPDATE users SET email_run_ready = ? WHERE id = ?")
      .bind(args.email_run_ready ? 1 : 0, args.userId)
      .run();
  }
}

/**
 * Unsubscribe flip (comms-prefs Phase 2): set the digest pref by EMAIL, the only
 * identity an unsubscribe token carries. NON-creating on purpose — an UPDATE
 * matches zero rows for a deleted account (never `upsertUser`, which would
 * resurrect it). Returns whether a row changed (the caller shows the same
 * success page either way — nothing to leak).
 */
export async function setEmailDigestByEmail(
  db: D1Database,
  email: string,
  value: EmailDigest,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE users SET email_digest = ? WHERE email = ?")
    .bind(value, email)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Slim read for the push gate (mirrors `getRankCadence`): is run-ready push ON
 * for this user? Missing row / NULL / pre-migration → TRUE (fail-open = today's
 * behavior) — 0 is the only opt-out value.
 */
export async function getPushRunReady(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT push_run_ready FROM users WHERE id = ?")
    .bind(userId)
    .first<{ push_run_ready: number | null }>();
  return row ? row.push_run_ready !== 0 : true;
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

/** Active (non-suppressed) subscriber emails — the broadcast recipients. */
export async function activeSubscribers(db: D1Database): Promise<{ email: string }[]> {
  const { results } = await db
    .prepare("SELECT email FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY created_at")
    .all<{ email: string }>();
  return results ?? [];
}

/** Split counts for the broadcast UI — never returns addresses. */
export async function subscriberCounts(db: D1Database): Promise<{ active: number; unsubscribed: number }> {
  const row = await db
    .prepare(
      "SELECT " +
        "SUM(CASE WHEN unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS active, " +
        "SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed " +
        "FROM subscribers",
    )
    .first<{ active: number | null; unsubscribed: number | null }>();
  return { active: row?.active ?? 0, unsubscribed: row?.unsubscribed ?? 0 };
}

/** Suppress an address (one-click list unsubscribe). Non-creating, idempotent. */
export async function unsubscribeSubscriber(db: D1Database, email: string): Promise<void> {
  await db
    .prepare("UPDATE subscribers SET unsubscribed_at = datetime('now') WHERE email = ? AND unsubscribed_at IS NULL")
    .bind(email.trim().toLowerCase())
    .run();
}

/** Record a broadcast send (audit). Returns the new row id. */
export async function recordBroadcast(
  db: D1Database,
  m: { subject: string; recipientCount: number; sender: string | null },
): Promise<string> {
  const id = uuid();
  await db
    .prepare("INSERT INTO broadcasts (id, subject, recipient_count, sender) VALUES (?, ?, ?, ?)")
    .bind(id, m.subject, m.recipientCount, m.sender)
    .run();
  return id;
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

/**
 * Register (or refresh) an Expo push token for a user. Idempotent: the token is
 * the primary key, so re-registering the SAME device just re-points it at this
 * user + updates the timestamp (a device that changed accounts follows the login).
 */
export async function registerDeviceToken(
  db: D1Database,
  userId: string,
  token: string,
  platform: "ios" | "android",
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO device_tokens (token, user_id, platform, created_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, created_at = excluded.created_at",
    )
    .bind(token, userId, platform, now())
    .run();
}

/** The Expo push tokens registered for a user (empty when none). */
export async function listDeviceTokensForUser(db: D1Database, userId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT token FROM device_tokens WHERE user_id = ?")
    .bind(userId)
    .all<{ token: string }>();
  return (res.results ?? []).map((r) => r.token);
}

/** Drop a token (e.g. Expo reported it unregistered). */
export async function deleteDeviceToken(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM device_tokens WHERE token = ?").bind(token).run();
}

/**
 * Drop a token ONLY if the caller owns it (the sign-out path). Returns whether a
 * row was removed — false for someone else's token or an already-gone one, so
 * sign-out stays idempotent and can never unregister another user's device.
 */
export async function deleteDeviceTokenForUser(
  db: D1Database,
  userId: string,
  token: string,
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM device_tokens WHERE token = ? AND user_id = ?")
    .bind(token, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
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

/**
 * All apps for a user, with the latest run's status/id AND the autonomous
 * loop's state folded in (for the list view).
 *
 * Loop state rides THIS query rather than a per-app read. The caller already
 * loops over the results doing a `getRun` each; adding two more sequential
 * awaits per app would be a visible regression on a 12-app account, which is a
 * real account size here. The correlated subqueries cost one scan of `runs`
 * per app on an already-indexed app_id.
 *
 * `app_settings` is LEFT JOINed: a row exists only once an app has settings, so
 * an app that has never been swept yields NULLs, which shape to "never swept"
 * rather than to a fabricated default.
 */
export async function listAppsForUser(
  db: D1Database,
  userId: string,
): Promise<
  Array<
    AppRow & {
      latest_run_id: string | null;
      latest_run_status: RunStatus | null;
      last_sweep_at: string | null;
      schedule_json: string | null;
      agent_run_count: number | null;
      agent_since: string | null;
    }
  >
> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.user_id, a.bundle_id, a.name, a.country, a.created_at,
              r.id AS latest_run_id, r.status AS latest_run_status,
              s.last_sweep_at AS last_sweep_at,
              s.schedule_json AS schedule_json,
              (SELECT COUNT(*) FROM runs cr
                WHERE cr.app_id = a.id
                  AND json_extract(cr.reasoning_json, '$.trigger.source') = 'cron'
              ) AS agent_run_count,
              (SELECT MIN(cr.created_at) FROM runs cr
                WHERE cr.app_id = a.id
                  AND json_extract(cr.reasoning_json, '$.trigger.source') = 'cron'
              ) AS agent_since
       FROM apps a
       LEFT JOIN runs r ON r.id = (
         SELECT id FROM runs WHERE app_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1
       )
       LEFT JOIN app_settings s ON s.app_id = a.id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC`,
    )
    .bind(userId)
    .all<
      AppRow & {
        latest_run_id: string | null;
        latest_run_status: RunStatus | null;
        last_sweep_at: string | null;
        schedule_json: string | null;
        agent_run_count: number | null;
        agent_since: string | null;
      }
    >();
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
    /** storefront these ranks were checked in (#180 Phase 1); '' when unknown. */
    country?: string;
  },
): Promise<string> {
  const runId = uuid();
  const createdAt = now();
  const country = normCountry(args.country);
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
    // #182 Phase 3: the proposed PPO treatment brief. Curated recommendation copy
    // + a cited public result — no raw ASC data. Rides along when computed.
    ...(result.ppoTreatment !== undefined ? { ppoTreatment: result.ppoTreatment } : {}),
    ...(result.languageCoverage !== undefined ? { languageCoverage: result.languageCoverage } : {}),
    ...(result.chartRank !== undefined ? { chartRank: result.chartRank } : {}),
    // PUBLIC review sentiment (#95): sample-size-honest sentiment + observed
    // topics from the free RSS feed. Public data only — safe to persist + serve.
    ...(result.reviews !== undefined ? { reviews: result.reviews } : {}),
    trigger: args.trigger,
  };

  const stmts: D1PreparedStatement[] = [];

  // Supersede: a NEW awaiting_approval run replaces any older still-open ones for
  // the same app (iterating shouldn't leave phantom "pending" runs). Runs FIRST in
  // the batch, before the INSERT, and excludes the new id defensively — so the new
  // run is never self-superseded. Decided runs (approved/rejected/shipped) are
  // history and are untouched (only status='awaiting_approval' is flipped).
  if (args.status === "awaiting_approval") {
    stmts.push(
      db
        .prepare(
          "UPDATE runs SET status = 'superseded' WHERE app_id = ? AND status = 'awaiting_approval' AND id != ?",
        )
        .bind(args.appId, runId),
    );
  }

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

  // rank snapshots — one per checked keyword, tagged with the storefront (#180)
  for (const r of result.ranks) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO rank_snapshots (id, app_id, keyword, rank, total, country, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid(), args.appId, r.keyword, r.rank, r.total, country, createdAt),
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

/**
 * The latest run's decoded trace for an app (storefront-intel PRD 05 —
 * portfolio detection reads `trace.audit.storefront.moreByDeveloper`). Returns
 * null when the app has no runs or the stored JSON won't parse (safe-degrade:
 * the caller reports `known:false`, never a 500).
 */
export async function latestRunTraceForApp(
  db: D1Database,
  appId: string,
): Promise<{ runId: string; createdAt: string; trace: ReasoningTrace } | null> {
  const row = await db
    .prepare(
      "SELECT id, created_at, reasoning_json FROM runs WHERE app_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(appId)
    .first<{ id: string; created_at: string; reasoning_json: string }>();
  if (!row) return null;
  try {
    const trace = JSON.parse(row.reasoning_json) as ReasoningTrace;
    return { runId: row.id, createdAt: row.created_at, trace };
  } catch {
    return null;
  }
}

/** All runs for an app, newest first (for the app-detail run history list). */
export async function listRunsForApp(
  db: D1Database,
  appId: string,
): Promise<
  Array<{ id: string; status: RunStatus; created_at: string; reasoning_json: string }>
> {
  const { results } = await db
    .prepare(
      // reasoning_json carries the trigger, which the list needs to say WHO
      // opened each run. Selected here rather than fetched per row: an app with
      // 29 runs (a real count on this account) would otherwise be 29 reads.
      "SELECT id, status, created_at, reasoning_json FROM runs WHERE app_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(appId)
    .all<{ id: string; status: RunStatus; created_at: string; reasoning_json: string }>();
  return results ?? [];
}

// ── portfolio reads (#356): ACROSS a user's apps, one statement each ──────────
// The three portfolio screens are fleet-wide, so the per-app helpers above would
// mean a query per app (and, for runs, a query per RUN to reach its trace). Each
// read below joins through `apps.user_id` instead: one statement, ownership
// enforced in SQL rather than by a caller remembering to check.

/**
 * Every run across a user's apps, carrying its app's id + name and its raw
 * reasoning trace (the caller extracts findingsSummary — reading the blob here
 * is what avoids a per-run round trip).
 *
 * ORDER: runs still at the human gate lead at ANY age — an awaiting_approval run
 * is the only row on this screen that needs a decision, so it must never be
 * pushed below a newer decided run. Within each group, newest first; `id` breaks
 * created_at ties so the order is stable across calls.
 */
export async function listRunsForUser(
  db: D1Database,
  userId: string,
): Promise<
  Array<{
    id: string;
    app_id: string;
    app_name: string;
    status: RunStatus;
    created_at: string;
    reasoning_json: string;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.app_id, a.name AS app_name, r.status, r.created_at, r.reasoning_json
       FROM runs r
       JOIN apps a ON a.id = r.app_id
       WHERE a.user_id = ?
       ORDER BY (r.status = 'awaiting_approval') DESC, r.created_at DESC, r.id DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      app_id: string;
      app_name: string;
      status: RunStatus;
      created_at: string;
      reasoning_json: string;
    }>();
  return results ?? [];
}

/**
 * Every rank snapshot across a user's apps, oldest → newest, each carrying its
 * app id/name and the storefront it was read in.
 *
 * A rank belongs to ONE app in ONE storefront, so the caller groups on
 * (app_id, country, keyword) — collapsing any of those would mean picking or
 * averaging, and both fabricate. Bounded so a large fleet can't unbound the read.
 */
export async function listRankSnapshotsForUser(
  db: D1Database,
  userId: string,
  limit = 5000,
): Promise<
  Array<{
    id: string;
    app_id: string;
    app_name: string;
    keyword: string;
    rank: number | null;
    total: number;
    country: string;
    checked_at: string;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT rs.id, rs.app_id, a.name AS app_name, rs.keyword, rs.rank, rs.total,
              rs.country, rs.checked_at
       FROM rank_snapshots rs
       JOIN apps a ON a.id = rs.app_id
       WHERE a.user_id = ?
       ORDER BY rs.checked_at ASC, rs.id ASC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<{
      id: string;
      app_id: string;
      app_name: string;
      keyword: string;
      rank: number | null;
      total: number;
      country: string;
      checked_at: string;
    }>();
  return results ?? [];
}

/**
 * Every watched/suggested competitor across a user's apps, with the watching
 * app's name. One row per (app, rival) — the pair, because `confirmed` is a
 * per-pair fact: the same rival can be watched for one app and merely suggested
 * for another. Missing-table tolerant, like the other app_competitors reads.
 */
export async function listCompetitorsForUser(
  db: D1Database,
  userId: string,
): Promise<Array<CompetitorRow & { app_name: string }>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT c.app_id, a.name AS app_name, c.comp_key, c.name, c.source, c.status
         FROM app_competitors c
         JOIN apps a ON a.id = c.app_id
         WHERE a.user_id = ?
         ORDER BY c.name ASC, a.name ASC`,
      )
      .bind(userId)
      .all<CompetitorRow & { app_name: string }>();
    return results ?? [];
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
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
  args: {
    runId: string;
    decision: "approved" | "rejected";
    /**
     * Extra statements to run in the SAME atomic batch as the gate decision
     * (#39 Part 2: the anonymous, encrypted `proposal_edits` capture rows). They
     * commit all-or-nothing with the approval, so the captured RLHF signal can
     * never disagree with the recorded decision. Empty/absent → unchanged behavior.
     */
    extraStmts?: D1PreparedStatement[];
  },
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
    ...(args.extraStmts ?? []),
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
  args: {
    runId: string;
    copy: CopyFields;
    pushCommands: PushCommand[];
    /** Who authored this copy. Omitted leaves any existing provenance intact. */
    source?: ProposalEditSource;
  },
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
  if (args.source !== undefined) trace.lastEditSource = args.source;

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

// `setRunStatus` lived here: an exported, arbitrary-status writer with no
// callers, left behind by #43 (approval sets 'approved', not 'shipped'). It
// made d1.ts read as though something could still move a run to 'shipped'.
// Nothing can, and nothing has since 2026-06-19 — see runStatusWriters.spec.ts.
// Status transitions belong to recordApproval (approved/rejected) and insertRun
// (superseded); a third one should be added deliberately, not restored.

// ── snapshots: lightweight writes (daily cadence) + reads ────────────────────

/**
 * Append dated rank rows for an app WITHOUT opening a run (issue #94). The daily
 * snapshot cron uses this: it records the same `rank_snapshots` time-series the
 * weekly sweep does (via persistRun), but skips the run/proposals/threshold logic
 * entirely — a snapshot, not a draft. Errored keyword fetches are skipped so we
 * never persist a fabricated row for a term whose rank we couldn't read (#78); an
 * honest `null` rank (in top-N but unranked) IS persisted. Atomic via DB.batch.
 */
export async function persistRankSnapshots(
  db: D1Database,
  args: { appId: string; ranks: Rank[]; country?: string },
): Promise<void> {
  const checkedAt = now();
  const country = normCountry(args.country);
  const stmts: D1PreparedStatement[] = [];
  for (const r of args.ranks) {
    if (r.error) continue; // honesty: a failed fetch is NOT a measured rank — record nothing
    stmts.push(
      db
        .prepare(
          "INSERT INTO rank_snapshots (id, app_id, keyword, rank, total, country, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid(), args.appId, r.keyword, r.rank, r.total, country, checkedAt),
    );
  }
  if (stmts.length === 0) return;
  await db.batch(stmts);
}

// ── snapshots: reads for trend charts + cron diffing ─────────────────────────

/**
 * Rank history for an app (oldest → newest), for the trend chart. Optionally
 * scoped to ONE storefront (#180 Phase 1) so a per-market chart proves movement
 * in that market alone; omit `country` to read across all storefronts (legacy
 * behavior). Every row carries its `country` so a caller can group by market.
 */
export async function getRankHistory(
  db: D1Database,
  appId: string,
  opts: { keyword?: string; limit?: number; country?: string } = {},
): Promise<RankSnapshotRow[]> {
  const limit = opts.limit ?? 500;
  const country = opts.country !== undefined ? normCountry(opts.country) : undefined;
  const conds = ["app_id = ?"];
  const binds: unknown[] = [appId];
  if (opts.keyword) {
    conds.push("keyword = ?");
    binds.push(opts.keyword);
  }
  if (country !== undefined) {
    conds.push("country = ?");
    binds.push(country);
  }
  const { results } = await db
    .prepare(
      `SELECT id, app_id, keyword, rank, total, country, checked_at
       FROM rank_snapshots WHERE ${conds.join(" AND ")}
       ORDER BY checked_at ASC, id ASC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<RankSnapshotRow>();
  return results ?? [];
}

/**
 * The distinct storefronts that have MEASURED rank data for an app (#180 Phase 2).
 * Powers the market picker: the UI populates the storefront dropdown from markets
 * we actually track, never a guessed/aspirational list. Legacy Phase-1 rows carry
 * country '' — those aren't a real market, so they're excluded in SQL; the result
 * is additionally lowercased + de-duplicated defensively. Empty for an app with no
 * snapshots (no fabricated market).
 */
export async function listTrackedMarkets(db: D1Database, appId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT country FROM rank_snapshots
       WHERE app_id = ? AND country <> ''
       ORDER BY country ASC`,
    )
    .bind(appId)
    .all<{ country: string }>();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results ?? []) {
    const c = normCountry(r.country);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Persist ONE measured Play category-chart rank sample (ranking-parity step 1).
 * Honesty mirror of persistRankSnapshots: an UNKNOWN read (`rank === null`) is
 * NOT a measured fact → we record nothing. A measured chart — whether the app
 * ranked (position N) or was read-but-absent (`ranked:false` → position NULL) —
 * IS persisted. No-op on null so callers can pass the degrade-safe result directly.
 */
export async function persistPlayChartRank(
  db: D1Database,
  args: { appId: string; packageName: string; rank: PlayChartRank | null },
): Promise<void> {
  const r = args.rank;
  if (r === null) return; // UNKNOWN is not a measured sample — never persist
  await db
    .prepare(
      `INSERT INTO play_rank_snapshots
         (id, app_id, package_name, collection, category, country, position, out_of, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuid(),
      args.appId,
      args.packageName,
      r.collection,
      r.category,
      normCountry(r.country),
      r.ranked ? r.position : null,
      r.outOf,
      now(),
    )
    .run();
}

/** One corpus_snapshots row to persist (#63) — VISIBLE fields only, no app FK. */
export type CorpusRow = {
  seedKeyword: string;
  country: string;
  bundleId: string;
  trackId?: number;
  name: string;
  categoryId: string;
  categoryName: string;
  rank: number | null;
  version: string;
  rating: number | null;
  ratingCount: number | null;
  description: string;
};

/**
 * Persist a batch of category-corpus observations (#63). One row per observed
 * app; a null rank is persisted honestly (beyond the cap, not a fake 0). Atomic
 * via db.batch. No-op on an empty batch.
 */
export async function persistCorpusSnapshots(db: D1Database, rows: CorpusRow[]): Promise<void> {
  if (!rows.length) return;
  const at = now();
  // A FRESH prepared statement per row (mirrors persistRankSnapshots): each
  // carries its own bound args, so batch can't collapse to a shared/last binding.
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO corpus_snapshots
           (id, seed_keyword, country, bundle_id, track_id, name, category_id, category_name, rank, version, rating, rating_count, description, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uuid(),
        r.seedKeyword,
        r.country,
        r.bundleId,
        r.trackId ?? null,
        r.name,
        r.categoryId,
        r.categoryName,
        r.rank,
        r.version,
        r.rating,
        r.ratingCount,
        r.description,
        at,
      ),
  );
  await db.batch(stmts);
}

/** A corpus point read back for pattern-mining (#64) — mirrors CorpusPoint. */
export type CorpusPointRow = {
  seedKeyword: string;
  country: string;
  bundleId: string;
  name: string;
  rank: number | null;
  version: string;
  rating: number | null;
  description: string;
  checkedAt: string;
};

/**
 * Read corpus_snapshots for pattern-mining (#64), ordered by
 * (seed_keyword, bundle_id, checked_at) so buildTransitions can pair consecutive
 * snapshots. Optionally scoped by seed/country and a recency window. Bounded.
 */
export async function readCorpusPoints(
  db: D1Database,
  opts: { seedKeyword?: string; country?: string; sinceDays?: number; limit?: number } = {},
): Promise<CorpusPointRow[]> {
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (opts.seedKeyword) {
    conds.push("seed_keyword = ?");
    binds.push(opts.seedKeyword);
  }
  if (opts.country) {
    conds.push("country = ?");
    binds.push(opts.country);
  }
  if (opts.sinceDays !== undefined) {
    conds.push("checked_at >= datetime('now', ?)");
    binds.push(`-${opts.sinceDays} days`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = opts.limit ?? 5000;
  const { results } = await db
    .prepare(
      `SELECT seed_keyword, country, bundle_id, name, rank, version, rating, description, checked_at
       FROM corpus_snapshots ${where}
       ORDER BY seed_keyword ASC, bundle_id ASC, checked_at ASC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      seed_keyword: string;
      country: string;
      bundle_id: string;
      name: string;
      rank: number | null;
      version: string;
      rating: number | null;
      description: string;
      checked_at: string;
    }>();
  return (results ?? []).map((r) => ({
    seedKeyword: r.seed_keyword,
    country: r.country,
    bundleId: r.bundle_id,
    name: r.name,
    rank: r.rank,
    version: r.version,
    rating: r.rating,
    description: r.description,
    checkedAt: r.checked_at,
  }));
}

/**
 * Play chart-rank history for an app (oldest → newest), for a Play rank-delta
 * chart and the analysis modules. Optionally scoped to one (category, collection,
 * country) so a series proves movement in one chart, not a blended claim.
 */
export async function getPlayChartRankHistory(
  db: D1Database,
  appId: string,
  opts: { category?: string; collection?: string; country?: string; limit?: number } = {},
): Promise<PlayRankSnapshotRow[]> {
  const limit = opts.limit ?? 500;
  const conds = ["app_id = ?"];
  const binds: unknown[] = [appId];
  if (opts.category) {
    conds.push("category = ?");
    binds.push(opts.category);
  }
  if (opts.collection) {
    conds.push("collection = ?");
    binds.push(opts.collection);
  }
  if (opts.country !== undefined) {
    conds.push("country = ?");
    binds.push(normCountry(opts.country));
  }
  const { results } = await db
    .prepare(
      `SELECT id, app_id, package_name, collection, category, country, position, out_of, checked_at
       FROM play_rank_snapshots WHERE ${conds.join(" AND ")}
       ORDER BY checked_at ASC, id ASC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<PlayRankSnapshotRow>();
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

/**
 * The latest rank per keyword for an app (for cron threshold checks). Optionally
 * scoped to ONE storefront (#180 Phase 1); omit `country` for the legacy
 * all-storefronts behavior (unchanged while an app checks a single market).
 */
export async function getLatestRanks(
  db: D1Database,
  appId: string,
  country?: string,
): Promise<Array<{ keyword: string; rank: number | null }>> {
  const filter = country !== undefined ? " AND country = ?" : "";
  const c = country !== undefined ? normCountry(country) : undefined;
  const binds = c !== undefined ? [appId, c, appId, c] : [appId, appId];
  const { results } = await db
    .prepare(
      `SELECT rs.keyword, rs.rank
       FROM rank_snapshots rs
       JOIN (
         SELECT keyword, MAX(checked_at) AS max_checked
         FROM rank_snapshots WHERE app_id = ?${filter} GROUP BY keyword
       ) latest ON latest.keyword = rs.keyword AND latest.max_checked = rs.checked_at
       WHERE rs.app_id = ?${filter}`,
    )
    .bind(...binds)
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

/**
 * Age in whole days of the app's OLDEST open approval gate, or null when none
 * is open. Callers decide what counts as stale; this only measures.
 *
 * `hasOpenRun` answers "is one open?", which is the wrong question for the
 * weekly sweep: an unanswered gate made the app permanently ineligible for a
 * new one, so a single un-approved run silenced every future notification
 * (#492). Age is what distinguishes "the human is still deciding" from "this
 * has been abandoned and the app has gone quiet".
 *
 * julianday() rather than date arithmetic on strings: created_at is stored as
 * `datetime('now')` (UTC, second precision), and a text comparison would count
 * a gate opened 23 hours ago as a day old.
 */
export async function openRunAgeDays(db: D1Database, appId: string): Promise<number | null> {
  const row = await db
    .prepare(
      "SELECT CAST(julianday('now') - julianday(MIN(created_at)) AS INTEGER) age " +
        "FROM runs WHERE app_id = ? AND status = 'awaiting_approval'",
    )
    .bind(appId)
    .first<{ age: number | null }>();
  return row?.age ?? null;
}

// ── App competitors (#72) ─────────────────────────────────────────────────────
// The competitors an app actually WATCHES. Two sources: auto-discovery
// (status='suggested' until the human confirms) and user entry (confirmed
// immediately). Only CONFIRMED rows feed runs + the weekly sweep — a suggestion
// is never silently watched. All reads are missing-table tolerant (deploy-order
// safety: a Worker deployed before the table exists degrades to "no
// competitors", never a crashed run — though the deploy now applies migrations
// before the Worker, so ordering is guaranteed).

export type CompetitorRow = {
  app_id: string;
  comp_key: string;
  name: string;
  source: "user" | "discovered";
  status: "suggested" | "confirmed";
};

/** True for the "table doesn't exist yet" error — the deploy-order window. */
function isMissingTable(e: unknown): boolean {
  return e instanceof Error && /no such table/i.test(e.message);
}

export async function listCompetitors(
  db: D1Database,
  appId: string,
): Promise<CompetitorRow[]> {
  try {
    const { results } = await db
      .prepare(
        "SELECT app_id, comp_key, name, source, status FROM app_competitors WHERE app_id = ? ORDER BY status DESC, name",
      )
      .bind(appId)
      .all<CompetitorRow>();
    return results ?? [];
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/** The confirmed competitor keys — what runs + the weekly sweep actually watch. */
export async function confirmedCompetitorKeys(
  db: D1Database,
  appId: string,
): Promise<string[]> {
  try {
    const { results } = await db
      .prepare(
        "SELECT comp_key FROM app_competitors WHERE app_id = ? AND status = 'confirmed' ORDER BY name",
      )
      .bind(appId)
      .all<{ comp_key: string }>();
    return (results ?? []).map((r) => r.comp_key);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/**
 * Insert or refresh a competitor row. An existing row keeps its STATUS (a
 * user's confirmation is never downgraded by a re-discovery) but takes the
 * fresher name.
 */
export async function upsertCompetitor(
  db: D1Database,
  row: { appId: string; compKey: string; name: string; source: CompetitorRow["source"]; status: CompetitorRow["status"] },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_competitors (app_id, comp_key, name, source, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (app_id, comp_key) DO UPDATE SET name = excluded.name`,
    )
    .bind(row.appId, row.compKey, row.name, row.source, row.status)
    .run();
}

/** Confirm a suggested competitor. Returns false when the row doesn't exist. */
export async function confirmCompetitor(
  db: D1Database,
  appId: string,
  compKey: string,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE app_competitors SET status = 'confirmed' WHERE app_id = ? AND comp_key = ?")
    .bind(appId, compKey)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Remove a competitor (suggested or confirmed). */
export async function deleteCompetitor(
  db: D1Database,
  appId: string,
  compKey: string,
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM app_competitors WHERE app_id = ? AND comp_key = ?")
    .bind(appId, compKey)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Distinct tracked keywords for an app (most recent first) — discovery seeds. */
export async function distinctTrackedKeywords(
  db: D1Database,
  appId: string,
  limit = 5,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT keyword, MAX(checked_at) AS latest FROM rank_snapshots
       WHERE app_id = ? GROUP BY keyword ORDER BY latest DESC LIMIT ?`,
    )
    .bind(appId, limit)
    .all<{ keyword: string }>();
  return (results ?? []).map((r) => r.keyword);
}

// ── App settings: run thresholds (#53) ────────────────────────────────────────
import { DEFAULT_THRESHOLDS, parseThresholds, type ThresholdConfig } from "./thresholds.js";

/**
 * The app's run-threshold config. FAIL-OPEN: missing row, NULL, garbage JSON,
 * or a missing table (deploy-order window) all resolve to DEFAULT_THRESHOLDS —
 * today's behavior.
 */
export async function getThresholds(db: D1Database, appId: string): Promise<ThresholdConfig> {
  try {
    const row = await db
      .prepare("SELECT threshold_json FROM app_settings WHERE app_id = ?")
      .bind(appId)
      .first<{ threshold_json: string | null }>();
    return parseThresholds(row?.threshold_json);
  } catch (e) {
    if (e instanceof Error && /no such table/i.test(e.message)) return { ...DEFAULT_THRESHOLDS };
    throw e;
  }
}

/** Merge a validated partial patch into the stored config; returns the result. */
export async function setThresholds(
  db: D1Database,
  appId: string,
  patch: Partial<ThresholdConfig>,
): Promise<ThresholdConfig> {
  const current = await getThresholds(db, appId);
  const next: ThresholdConfig = { ...current, ...patch };
  await db
    .prepare(
      `INSERT INTO app_settings (app_id, threshold_json) VALUES (?, ?)
       ON CONFLICT (app_id) DO UPDATE SET threshold_json = excluded.threshold_json`,
    )
    .bind(appId, JSON.stringify(next))
    .run();
  return next;
}

/** All competitor snapshots for an app, seen_at ASC — the #62 annotation input. */
export async function listCompetitorSnapshots(
  db: D1Database,
  appId: string,
  limit = 500,
): Promise<Array<{ comp_id: string; name: string; version: string; rating: string; seen_at: string }>> {
  const { results } = await db
    .prepare(
      `SELECT comp_id, name, version, rating, seen_at
       FROM competitor_snapshots WHERE app_id = ?
       ORDER BY seen_at ASC, id ASC LIMIT ?`,
    )
    .bind(appId, limit)
    .all<{ comp_id: string; name: string; version: string; rating: string; seen_at: string }>();
  return results ?? [];
}

// ── App settings: sweep schedule (#52) ────────────────────────────────────────
import { DEFAULT_SCHEDULE, parseSchedule, type SweepSchedule } from "./schedule.js";

/** Missing row / column / table (deploy-order window) → the default schedule. */
export async function getSchedule(db: D1Database, appId: string): Promise<SweepSchedule> {
  try {
    const row = await db
      .prepare("SELECT schedule_json FROM app_settings WHERE app_id = ?")
      .bind(appId)
      .first<{ schedule_json: string | null }>();
    return parseSchedule(row?.schedule_json);
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/i.test(e.message)) {
      return { ...DEFAULT_SCHEDULE };
    }
    throw e;
  }
}

export async function setSchedule(
  db: D1Database,
  appId: string,
  schedule: SweepSchedule,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (app_id, schedule_json) VALUES (?, ?)
       ON CONFLICT (app_id) DO UPDATE SET schedule_json = excluded.schedule_json`,
    )
    .bind(appId, JSON.stringify(schedule))
    .run();
}

/** The app's last COMPLETED sweep timestamp, or null. Fail-open like reads above. */
export async function getLastSweepAt(db: D1Database, appId: string): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT last_sweep_at FROM app_settings WHERE app_id = ?")
      .bind(appId)
      .first<{ last_sweep_at: string | null }>();
    return row?.last_sweep_at ?? null;
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/i.test(e.message)) return null;
    throw e;
  }
}

/**
 * One app's loop-state row, for the detail view. Mirrors the aggregate that
 * rides `listAppsForUser`, and fails open the same way `getLastSweepAt` does:
 * a missing table/column predates this feature and must read as "no data", not
 * as an error that blanks the whole page.
 */
export async function loopStateRowForApp(
  db: D1Database,
  appId: string,
): Promise<{
  last_sweep_at: string | null;
  schedule_json: string | null;
  agent_run_count: number | null;
  agent_since: string | null;
} | null> {
  try {
    return await db
      .prepare(
        `SELECT s.last_sweep_at AS last_sweep_at,
                s.schedule_json AS schedule_json,
                (SELECT COUNT(*) FROM runs cr
                  WHERE cr.app_id = ?1
                    AND json_extract(cr.reasoning_json, '$.trigger.source') = 'cron'
                ) AS agent_run_count,
                (SELECT MIN(cr.created_at) FROM runs cr
                  WHERE cr.app_id = ?1
                    AND json_extract(cr.reasoning_json, '$.trigger.source') = 'cron'
                ) AS agent_since
         FROM apps a
         LEFT JOIN app_settings s ON s.app_id = a.id
         WHERE a.id = ?1`,
      )
      .bind(appId)
      .first<{
        last_sweep_at: string | null;
        schedule_json: string | null;
        agent_run_count: number | null;
        agent_since: string | null;
      }>();
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/i.test(e.message)) return null;
    throw e;
  }
}

/** Stamp the sweep completion. Best-effort: a failed stamp never fails the sweep. */
export async function setLastSweepAt(db: D1Database, appId: string, at: string): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO app_settings (app_id, last_sweep_at) VALUES (?, ?)
         ON CONFLICT (app_id) DO UPDATE SET last_sweep_at = excluded.last_sweep_at`,
      )
      .bind(appId, at)
      .run();
  } catch (e) {
    // SELECT errors say "no such column"; INSERT says "has no column named".
    if (e instanceof Error && /no such (table|column)|has no column named/i.test(e.message)) return;
    throw e;
  }
}

// ── Localized drafts on the run trace (#78 Phase 2) ───────────────────────────

/** Store (or replace) an APPROVED per-locale draft on the run's trace. */
export async function setLocalizedCopy(
  db: D1Database,
  runId: string,
  locale: string,
  copy: LocalizedCopyEntry,
): Promise<boolean> {
  const run = await db
    .prepare("SELECT reasoning_json FROM runs WHERE id = ?")
    .bind(runId)
    .first<{ reasoning_json: string }>();
  if (!run) return false;
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  trace.localizedCopy = { ...(trace.localizedCopy ?? {}), [locale]: copy };
  await db
    .prepare("UPDATE runs SET reasoning_json = ? WHERE id = ?")
    .bind(JSON.stringify(trace), runId)
    .run();
  return true;
}

/** Un-approve a locale (remove it from the handoff). False when absent. */
export async function deleteLocalizedCopy(
  db: D1Database,
  runId: string,
  locale: string,
): Promise<boolean> {
  const run = await db
    .prepare("SELECT reasoning_json FROM runs WHERE id = ?")
    .bind(runId)
    .first<{ reasoning_json: string }>();
  if (!run) return false;
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  if (!trace.localizedCopy || !(locale in trace.localizedCopy)) return false;
  delete trace.localizedCopy[locale];
  await db
    .prepare("UPDATE runs SET reasoning_json = ? WHERE id = ?")
    .bind(JSON.stringify(trace), runId)
    .run();
  return true;
}

// ── Analytics Engagement series (analytics-reports Phase 2) ────────────────────

/** One persisted row of the measured Engagement series (metrics NULL when the
 *  report didn't carry them — never a fabricated 0). */
export type EngagementSeriesRow = {
  date: string;
  source: string;
  cpp: string;
  pageType: string;
  impressions: number | null;
  productPageViews: number | null;
  downloads: number | null;
};

/**
 * Idempotently persist parsed Engagement rows. Keyed by the dimension tuple
 * (app/date/source/cpp/page_type), so re-ingesting a day RESTATES it (Apple
 * revises recent days) rather than duplicating. An absent metric binds NULL, an
 * absent dimension binds '' — the honesty boundary: we never invent a 0 or a CPP.
 * One atomic batch; a no-op on empty input (no write, returns 0).
 */
export async function upsertEngagementRows(
  db: D1Database,
  appId: string,
  rows: EngagementRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO analytics_engagement
           (app_id, date, source, cpp, page_type, impressions, product_page_views, downloads)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, date, source, cpp, page_type) DO UPDATE SET
           impressions = excluded.impressions,
           product_page_views = excluded.product_page_views,
           downloads = excluded.downloads,
           ingested_at = datetime('now')`,
      )
      .bind(
        appId,
        r.date,
        r.source ?? "",
        r.cpp ?? "",
        r.pageType ?? "",
        r.impressions ?? null,
        r.productPageViews ?? null,
        r.downloads ?? null,
      ),
  );
  await db.batch(stmts);
  return stmts.length;
}

/** Read an app's Engagement series (ascending by date, then source), scoped to
 *  the app. Metrics are returned as-stored (NULL preserved as null). */
export async function getEngagementSeries(
  db: D1Database,
  appId: string,
): Promise<EngagementSeriesRow[]> {
  const { results } = await db
    .prepare(
      `SELECT date, source, cpp, page_type, impressions, product_page_views, downloads
         FROM analytics_engagement
        WHERE app_id = ?
        ORDER BY date ASC, source ASC`,
    )
    .bind(appId)
    .all<{
      date: string;
      source: string;
      cpp: string;
      page_type: string;
      impressions: number | null;
      product_page_views: number | null;
      downloads: number | null;
    }>();
  return (results ?? []).map((r) => ({
    date: r.date,
    source: r.source,
    cpp: r.cpp,
    pageType: r.page_type,
    impressions: r.impressions,
    productPageViews: r.product_page_views,
    downloads: r.downloads,
  }));
}

/** One persisted month of the Play funnel (PRD 02-D). */
export type PlayFunnelSeriesRow = {
  period: string;
  country: string;
  visitors: number | null;
  acquisitions: number | null;
};

/**
 * Idempotently persist parsed Play funnel rows, keyed by (app, period, country),
 * so re-ingesting a month RESTATES it rather than duplicating (Google revises
 * recent months). An absent metric binds NULL (never a fabricated 0). One atomic
 * batch; a no-op on empty input (returns 0). Play funnel is `import("./engine/index.js").PlayFunnelRow`.
 */
export async function upsertPlayFunnelRows(
  db: D1Database,
  appId: string,
  rows: import("./engine/index.js").PlayFunnelRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO play_funnel_snapshots (app_id, period, country, visitors, acquisitions)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(app_id, period, country) DO UPDATE SET
           visitors = excluded.visitors,
           acquisitions = excluded.acquisitions,
           ingested_at = datetime('now')`,
      )
      .bind(appId, r.period, r.country ?? "", r.visitors ?? null, r.acquisitions ?? null),
  );
  await db.batch(stmts);
  return stmts.length;
}

/** Read an app's Play funnel series (ascending by period, then country). Metrics
 *  as-stored (NULL preserved). */
export async function getPlayFunnelSeries(
  db: D1Database,
  appId: string,
): Promise<PlayFunnelSeriesRow[]> {
  const { results } = await db
    .prepare(
      `SELECT period, country, visitors, acquisitions
         FROM play_funnel_snapshots WHERE app_id = ?
        ORDER BY period ASC, country ASC`,
    )
    .bind(appId)
    .all<{ period: string; country: string; visitors: number | null; acquisitions: number | null }>();
  return (results ?? []).map((r) => ({
    period: r.period,
    country: r.country,
    visitors: r.visitors,
    acquisitions: r.acquisitions,
  }));
}

/**
 * Idempotently persist parsed COMMERCE rows, keyed by (app, date, content_name,
 * purchase_type) — a sibling of upsertPlayFunnelRows/analytics_engagement. An
 * absent metric binds NULL (never a fabricated 0). One atomic batch; a no-op on
 * empty input (returns 0).
 */
export async function upsertCommerceRows(db: D1Database, appId: string, rows: CommerceRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO analytics_commerce (app_id, date, content_name, purchase_type, sales, proceeds, paying_users)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, date, content_name, purchase_type) DO UPDATE SET
           sales = excluded.sales, proceeds = excluded.proceeds, paying_users = excluded.paying_users,
           ingested_at = datetime('now')`,
      )
      .bind(appId, r.date, r.contentName ?? "", r.purchaseType ?? "", r.sales ?? null, r.proceeds ?? null, r.payingUsers ?? null),
  );
  await db.batch(stmts);
  return stmts.length;
}

/** Read an app's COMMERCE series (ascending by date, then content_name). Metrics
 *  as-stored (NULL preserved). */
export async function getCommerceSeries(db: D1Database, appId: string): Promise<CommerceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT date, content_name, purchase_type, sales, proceeds, paying_users
         FROM analytics_commerce WHERE app_id = ? ORDER BY date ASC, content_name ASC`,
    )
    .bind(appId)
    .all<{
      date: string;
      content_name: string;
      purchase_type: string;
      sales: number | null;
      proceeds: number | null;
      paying_users: number | null;
    }>();
  return (results ?? []).map((r) => ({
    date: r.date,
    contentName: r.content_name,
    purchaseType: r.purchase_type,
    sales: r.sales,
    proceeds: r.proceeds,
    payingUsers: r.paying_users,
  })) as CommerceRow[];
}

/**
 * Idempotently persist parsed APP_USAGE rows, keyed by (app, date, app_version,
 * device). An absent metric binds NULL (never a fabricated 0). One atomic batch;
 * a no-op on empty input (returns 0).
 */
export async function upsertUsageRows(db: D1Database, appId: string, rows: UsageRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO analytics_usage (app_id, date, app_version, device, sessions, active_devices, installations, deletions, crashes, unique_devices)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, date, app_version, device) DO UPDATE SET
           sessions = excluded.sessions, active_devices = excluded.active_devices,
           installations = excluded.installations, deletions = excluded.deletions,
           crashes = excluded.crashes, unique_devices = excluded.unique_devices,
           ingested_at = datetime('now')`,
      )
      .bind(
        appId,
        r.date,
        r.appVersion ?? "",
        r.device ?? "",
        r.sessions ?? null,
        r.activeDevices ?? null,
        r.installations ?? null,
        r.deletions ?? null,
        r.crashes ?? null,
        r.uniqueDevices ?? null,
      ),
  );
  await db.batch(stmts);
  return stmts.length;
}

/** Read an app's APP_USAGE series (ascending by date, then app_version). Metrics
 *  as-stored (NULL preserved), including the verified crash/unique-device cols. */
export async function getUsageSeries(db: D1Database, appId: string): Promise<UsageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT date, app_version, device, sessions, active_devices, installations, deletions, crashes, unique_devices
         FROM analytics_usage WHERE app_id = ? ORDER BY date ASC, app_version ASC`,
    )
    .bind(appId)
    .all<{
      date: string;
      app_version: string;
      device: string;
      sessions: number | null;
      active_devices: number | null;
      installations: number | null;
      deletions: number | null;
      crashes: number | null;
      unique_devices: number | null;
    }>();
  return (results ?? []).map((r) => ({
    date: r.date,
    appVersion: r.app_version,
    device: r.device,
    sessions: r.sessions,
    activeDevices: r.active_devices,
    installations: r.installations,
    deletions: r.deletions,
    crashes: r.crashes,
    uniqueDevices: r.unique_devices,
  })) as UsageRow[];
}

/** Capture Apple's real header row for a category so an unconfirmed COLUMN_MAP is
 *  a visible, one-line fix. Idempotent on (app_id, category, header_row). */
export async function recordReportHeaders(
  db: D1Database,
  args: { appId: string; category: string; reportVersion?: string; header: string },
): Promise<void> {
  if (!args.header) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO analytics_report_headers (app_id, category, report_version, header_row)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(args.appId, args.category, args.reportVersion ?? "", args.header)
    .run();
}

/**
 * Insert a webhook delivery; the PRIMARY KEY makes a repeat a no-op. Returns
 * fresh:false when the delivery id already existed (Apple's at-least-once retry).
 */
export async function enqueueWebhookDelivery(
  db: D1Database,
  args: { deliveryId: string; ascAppId: string; eventType: string; at: string },
): Promise<{ fresh: boolean }> {
  const res = await db
    .prepare(
      "INSERT OR IGNORE INTO webhook_deliveries (delivery_id, asc_app_id, event_type, received_at) VALUES (?, ?, ?, ?)",
    )
    .bind(args.deliveryId, args.ascAppId, args.eventType, args.at)
    .run();
  return { fresh: (res.meta?.changes ?? 0) > 0 };
}

/** True when the app was swept from a webhook within `windowSeconds` of `now`
 *  (unix seconds). False when never swept. */
export async function shouldDebounce(
  db: D1Database,
  ascAppId: string,
  windowSeconds: number,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT last_swept_at FROM webhook_sweeps WHERE asc_app_id = ?")
    .bind(ascAppId)
    .first<{ last_swept_at: string }>();
  if (!row) return false;
  const last = Date.parse(row.last_swept_at) / 1000;
  return Number.isFinite(last) && now - last < windowSeconds;
}

/** Record that the app was just swept from a webhook (upsert). */
export async function markWebhookSwept(db: D1Database, ascAppId: string, at: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO webhook_sweeps (asc_app_id, last_swept_at) VALUES (?, ?) ON CONFLICT (asc_app_id) DO UPDATE SET last_swept_at = excluded.last_swept_at",
    )
    .bind(ascAppId, at)
    .run();
}

/** The stable AAD context for a webhook secret's envelope, keyed by the ASC
 *  numeric app id (the only identity available at both seal and open time —
 *  the receiver has no user id until AFTER verification). Must be
 *  reconstructable identically from the stored row at read time. */
function webhookSecretCtx(ascAppId: string, kekVersion: number): VaultContext {
  return { userId: "webhook", appId: ascAppId, kind: "asc", kekVersion };
}

/**
 * Save (or replace) the webhook HMAC secret for an app, keyed by the ASC
 * numeric app id — the receiver has only that id to work with until AFTER
 * verification. SEALED via the credentialVault KEK/DEK envelope (the same
 * crypto as `stored_credentials`) — see migrations/0008_webhook_secrets.sql.
 */
export async function saveWebhookSecret(
  env: Env,
  args: { ascAppId: string; appId: string; secret: string },
): Promise<void> {
  const kek = currentKek(env);
  if (!kek) throw new Error("credential storage is not enabled on this deployment");
  const key = await importKek(kek.b64);
  const sealed = await sealCredential(key, args.secret, webhookSecretCtx(args.ascAppId, kek.version));
  await env.DB.prepare(
    `INSERT INTO webhook_secrets (asc_app_id, app_id, ciphertext, wrapped_dek, kek_version) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (asc_app_id) DO UPDATE SET
       app_id = excluded.app_id, ciphertext = excluded.ciphertext,
       wrapped_dek = excluded.wrapped_dek, kek_version = excluded.kek_version`,
  )
    .bind(args.ascAppId, args.appId, sealed.ciphertext, sealed.wrappedDek, kek.version)
    .run();
}

/**
 * Resolve the app row + stored webhook secret for an ASC numeric app id.
 * Returns null when no secret is on file (unregistered app, or the
 * `webhook_secrets` table hasn't migrated in yet) — the receiver treats that
 * as unauthorized rather than leaking whether the app id is known. Throws on
 * a genuine decrypt failure (tamper / a KEK version whose secret is missing)
 * — an operator-visible error, never a broken secret.
 */
export async function getWebhookSecretByAscAppId(
  env: Env,
  ascAppId: string,
): Promise<{ app: AppRow; secret: string } | null> {
  let row: { app_id: string; ciphertext: string; wrapped_dek: string; kek_version: number } | null;
  try {
    row = await env.DB
      .prepare("SELECT app_id, ciphertext, wrapped_dek, kek_version FROM webhook_secrets WHERE asc_app_id = ?")
      .bind(ascAppId)
      .first<{ app_id: string; ciphertext: string; wrapped_dek: string; kek_version: number }>();
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
  if (!row) return null;
  const app = await getApp(env.DB, row.app_id);
  if (!app) return null;

  const rowKekB64 = kekForVersion(env, row.kek_version);
  if (!rowKekB64) {
    throw new Error(`webhook secret sealed under KEK v${row.kek_version}, whose secret is not configured`);
  }
  const rowKek = await importKek(rowKekB64);
  const sealed: SealedCredential = {
    ciphertext: row.ciphertext,
    wrappedDek: row.wrapped_dek,
    kekVersion: row.kek_version,
  };
  const secret = await openCredential(rowKek, sealed, webhookSecretCtx(ascAppId, row.kek_version));
  return { app, secret };
}

// ── notification channels (migration 0014) ───────────────────────────────────

/**
 * One user's delivery destination. `verified` is the safety-critical field: an
 * unverified row is an address nobody has proven they control, so it is never
 * delivered to (see `deliverableDestinations`).
 */
export type NotificationChannelRow = {
  channel: ChannelKind;
  address: string;
  label: string;
  enabled: boolean;
  verified: boolean;
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
};

type RawChannelRow = {
  channel: string;
  address: string;
  label: string | null;
  enabled: number | null;
  verified_at: string | null;
  last_sent_at: string | null;
  last_failed_at: string | null;
  last_error: string | null;
};

const mapChannelRow = (r: RawChannelRow): NotificationChannelRow => ({
  channel: r.channel as ChannelKind,
  address: r.address,
  label: r.label ?? "",
  enabled: r.enabled !== 0,
  verified: r.verified_at !== null,
  lastSentAt: r.last_sent_at,
  lastFailedAt: r.last_failed_at,
  lastError: r.last_error,
});

const CHANNEL_COLS =
  "channel, address, label, enabled, verified_at, last_sent_at, last_failed_at, last_error";

/**
 * Add (or re-add) a destination. ALWAYS lands UNVERIFIED — proving ownership is
 * a separate, explicit step, so a typo'd or hostile address cannot receive
 * anything before someone demonstrates control of it.
 *
 * Re-adding the same (user, channel, address) UPDATES the label rather than
 * inserting a duplicate: two identical rows would double-send every
 * notification. It deliberately does NOT re-verify — a re-add is not proof.
 */
export async function addNotificationChannel(
  db: D1Database,
  args: { userId: string; channel: ChannelKind; address: string; label?: string },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO notification_channels (id, user_id, channel, address, label, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (user_id, channel, address) DO UPDATE SET label = excluded.label",
    )
    .bind(uuid(), args.userId, args.channel, args.address, args.label ?? "", now())
    .run();
}

/** Every destination this user has configured, verified or not (a settings view). */
export async function listNotificationChannels(
  db: D1Database,
  userId: string,
): Promise<NotificationChannelRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${CHANNEL_COLS} FROM notification_channels WHERE user_id = ? ORDER BY created_at`,
    )
    .bind(userId)
    .all<RawChannelRow>();
  return (results ?? []).map(mapChannelRow);
}

/**
 * The destinations a notification may actually go to.
 *
 * Both filters are load-bearing and neither is redundant:
 *   • verified_at IS NOT NULL — ownership proven. Without it a typo'd chat id
 *     sends another account's listing copy to a stranger.
 *   • enabled = 1 — the user wants traffic here right now.
 * Scoped to one user_id, so a query can never fan out across accounts.
 */
export async function deliverableDestinations(
  db: D1Database,
  userId: string,
): Promise<Destination[]> {
  const { results } = await db
    .prepare(
      "SELECT channel, address FROM notification_channels " +
        "WHERE user_id = ? AND enabled = 1 AND verified_at IS NOT NULL ORDER BY created_at",
    )
    .bind(userId)
    .all<{ channel: string; address: string }>();
  return (results ?? []).map((r) => ({ channel: r.channel as ChannelKind, address: r.address }));
}

/** Mark a destination as proven. Idempotent — re-verifying keeps the first timestamp. */
export async function verifyNotificationChannel(
  db: D1Database,
  args: { userId: string; channel: ChannelKind; address: string },
): Promise<void> {
  await db
    .prepare(
      "UPDATE notification_channels SET verified_at = COALESCE(verified_at, ?) " +
        "WHERE user_id = ? AND channel = ? AND address = ?",
    )
    .bind(now(), args.userId, args.channel, args.address)
    .run();
}

/** Mute / unmute WITHOUT touching verification — muting must not cost proof. */
export async function setNotificationChannelEnabled(
  db: D1Database,
  args: { userId: string; channel: ChannelKind; address: string; enabled: boolean },
): Promise<void> {
  await db
    .prepare(
      "UPDATE notification_channels SET enabled = ? WHERE user_id = ? AND channel = ? AND address = ?",
    )
    .bind(args.enabled ? 1 : 0, args.userId, args.channel, args.address)
    .run();
}

export async function removeNotificationChannel(
  db: D1Database,
  args: { userId: string; channel: ChannelKind; address: string },
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM notification_channels WHERE user_id = ? AND channel = ? AND address = ?",
    )
    .bind(args.userId, args.channel, args.address)
    .run();
}

/**
 * Record what happened on a delivery attempt, so a destination that has gone
 * dead is VISIBLE. A channel that silently stopped working is indistinguishable
 * from a quiet week unless the failure is written down.
 *
 * Best-effort by contract: this is bookkeeping about a notification, and it must
 * never throw into a caller whose real job was the run.
 */
export async function markChannelDelivery(
  db: D1Database,
  args: {
    userId: string;
    channel: ChannelKind;
    address: string;
    result: { ok: true } | { ok: false; error: string };
  },
): Promise<void> {
  try {
    if (args.result.ok) {
      await db
        .prepare(
          "UPDATE notification_channels SET last_sent_at = ?, last_error = NULL " +
            "WHERE user_id = ? AND channel = ? AND address = ?",
        )
        .bind(now(), args.userId, args.channel, args.address)
        .run();
      return;
    }
    await db
      .prepare(
        "UPDATE notification_channels SET last_failed_at = ?, last_error = ? " +
          "WHERE user_id = ? AND channel = ? AND address = ?",
      )
      .bind(now(), args.result.error.slice(0, 500), args.userId, args.channel, args.address)
      .run();
  } catch (e) {
    console.error("[store-ops] markChannelDelivery failed (non-fatal):", e);
  }
}

/**
 * How many of this user's apps are on the DAILY sweep, EXCLUDING one.
 *
 * Excluding the app under change is the point: re-setting an already-daily app
 * to daily must not be blocked by its own existing row, which is exactly the
 * off-by-one that would make the bound feel arbitrary.
 *
 * Fail-open on an unreadable schedule, matching parseSchedule's contract — a
 * garbage row counts as its default (weekly), never as daily.
 */
export async function dailyAppCountExcluding(
  db: D1Database,
  args: { userId: string; exceptAppId: string },
): Promise<number> {
  const { results } = await db
    .prepare(
      "SELECT s.schedule_json AS schedule_json FROM app_settings s " +
        "JOIN apps a ON a.id = s.app_id " +
        "WHERE a.user_id = ? AND s.app_id != ?",
    )
    .bind(args.userId, args.exceptAppId)
    .all<{ schedule_json: string | null }>();
  return (results ?? []).filter((r) => parseSchedule(r.schedule_json).cadence === "daily").length;
}

/**
 * How many runs this user has opened across all their apps since `sinceIso`.
 *
 * Backs the agent-triggered run bound. Counts every run regardless of status: a
 * run that failed validation still spent the inference that the bound exists to
 * damp, so excluding it would let a loop of failing runs run free.
 */
export async function runCountSince(
  db: D1Database,
  args: { userId: string; sinceIso: string },
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM runs r JOIN apps a ON a.id = r.app_id " +
        "WHERE a.user_id = ? AND r.created_at >= ?",
    )
    .bind(args.userId, args.sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── channel link codes (migration 0015) ──────────────────────────────────────

/**
 * A claim resolved from a link code — who was linking, and to what.
 * `null` from `consumeChannelLinkCode` means unknown, spent, or expired, and
 * the caller must not distinguish them: telling a stranger which of the three
 * it was is free information about another account's state.
 */
export type ChannelLinkClaim = {
  userId: string;
  channel: ChannelKind;
  label: string;
};

/** How long a link code stays usable. Short: it is pasted into a chat log. */
export const CHANNEL_LINK_TTL_SECONDS = 15 * 60;

/**
 * Mint a single-use code for a deep link.
 *
 * OPAQUE AND SHORT rather than a signed token, because Telegram documents the
 * start payload as "up to 64 base64url characters" and this codebase's signed
 * tokens measure 116 and contain a '.'. 128 bits of randomness, base64url — no
 * meaning in the string, all of it in the row.
 */
export async function createChannelLinkCode(
  db: D1Database,
  args: {
    userId: string;
    channel: ChannelKind;
    label?: string;
    ttlSeconds?: number;
    now?: () => Date;
  },
): Promise<string> {
  const at = args.now?.() ?? new Date();
  const ttl = args.ttlSeconds ?? CHANNEL_LINK_TTL_SECONDS;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const code = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await db
    .prepare(
      "INSERT INTO channel_link_codes (code, user_id, channel, label, created_at, expires_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      code,
      args.userId,
      args.channel,
      args.label ?? "",
      at.toISOString(),
      new Date(at.getTime() + ttl * 1000).toISOString(),
    )
    .run();
  return code;
}

/**
 * Resolve a code and SPEND it. Returns null when the code is unknown, already
 * spent, or expired.
 *
 * Single use is the property that matters: a deep link sits in a chat log, so
 * replay is the realistic attack, not forgery. Reading and deleting in that
 * order means a second caller finds nothing.
 *
 * Expiry is enforced HERE rather than by the sweeper, so a cron that never runs
 * cannot resurrect a stale code.
 */
export async function consumeChannelLinkCode(
  db: D1Database,
  code: string,
  opts?: { now?: () => Date },
): Promise<ChannelLinkClaim | null> {
  const trimmed = code.trim();
  if (!trimmed) return null; // never let an empty string match a blank row
  const row = await db
    .prepare("SELECT user_id, channel, label, expires_at FROM channel_link_codes WHERE code = ?")
    .bind(trimmed)
    .first<{ user_id: string; channel: string; label: string | null; expires_at: string }>();
  if (!row) return null;
  // Spend it regardless of freshness: an expired row has no further use, and
  // deleting it here keeps a replayed stale code from lingering.
  await db.prepare("DELETE FROM channel_link_codes WHERE code = ?").bind(trimmed).run();
  const at = opts?.now?.() ?? new Date();
  if (Date.parse(row.expires_at) <= at.getTime()) return null;
  return {
    userId: row.user_id,
    channel: row.channel as ChannelKind,
    label: row.label ?? "",
  };
}

/**
 * How many of this user's codes are still live — so a settings screen can say
 * "waiting for you to open the link" rather than looking inert. Expired rows
 * are NOT counted: a stale code is not a wait.
 */
export async function pendingChannelLinkCount(
  db: D1Database,
  userId: string,
  opts?: { now?: () => Date },
): Promise<number> {
  const at = opts?.now?.() ?? new Date();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM channel_link_codes WHERE user_id = ? AND expires_at > ?",
    )
    .bind(userId, at.toISOString())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Housekeeping. NOT the security boundary — expiry is enforced on read. */
export async function sweepExpiredChannelLinkCodes(
  db: D1Database,
  opts?: { now?: () => Date },
): Promise<void> {
  const at = opts?.now?.() ?? new Date();
  await db
    .prepare("DELETE FROM channel_link_codes WHERE expires_at <= ?")
    .bind(at.toISOString())
    .run();
}
