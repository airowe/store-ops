/**
 * SPIKE SUBSET of the API types. Production (PRD 01) lifts the full
 * `mobile/src/types/api.ts` here verbatim and makes THIS the canonical location
 * both the app(s) and — for request/response parity — the Worker import. Kept
 * small here to prove the client shape typechecks end to end.
 */

export type RunStatus =
  | "detected" | "researching" | "awaiting_approval"
  | "approved" | "rejected" | "shipped";

export type RankSummary = { lead_keyword: string; lead_rank: number | null };
export type FindingsSummary = { label: string; critical: number };

export type AppListItem = {
  id: string;
  name: string;
  bundle_id: string;
  latest_run: { status: RunStatus; created_at: string } | null;
  rank_summary: RankSummary | null;
  findings_summary: FindingsSummary | null;
};

/** Honest rank point: null rank = unmeasured, never 0. */
export type RankPoint = { rank: number | null; total: number | null; checked_at: string };
export type RankAnnotation = { at: string; kind: "push" | "competitor"; label: string };
export type RanksSeries = { points: RankPoint[]; annotations?: RankAnnotation[] };

export type DeltaEntry = {
  keyword: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
  direction: "up" | "down" | "same" | "new" | "unmeasured";
};
export type DeltasResponse = { entries: DeltaEntry[] };

export type WarTrend = "gaining" | "losing" | "flat" | "new" | "lost" | (string & {});
export type HeadToHead = {
  keyword: string;
  /** your current rank, or null if unranked (never 0). */
  you: number | null;
  /** your prior rank, or null when there's only one snapshot (skip count-up). */
  youPrevious: number | null;
  competitors: Array<{ name: string; rank: number | null }>;
  /** your rank − best competitor rank; null when there's no gap to close. */
  gapToBest: number | null;
  trend: WarTrend;
  winning: boolean;
};
export type WarRoomView = {
  appName: string;
  warRoom: HeadToHead[];
  competitors: string[];
  window: number;
  checkedAt: string;
};
export type Run = { id: string; app_id: string; status: RunStatus; created_at: string };

export type RunRow = { id: string; status: RunStatus; created_at: string };
export type AppDetail = {
  app: { id: string; bundle_id: string; name: string; country: string };
  runs: RunRow[];
};

// ── run detail (the money screen) ───────────────────────────────────────────
export type CopyFields = {
  name?: string;
  subtitle?: string;
  /** the keyword FIELD (comma-joined). */
  keywords?: string;
  promo?: string;
  description?: string;
  whatsNew?: string;
};
export type PushCommand = {
  store: "appstore" | "googleplay";
  tool: "asc" | "gplay";
  description: string;
  command: string;
};
export type RunApproval = { decision: string; decided_at: string };

// ── listing audit surfaces (served by every run; PRD 02 privacy boundary) ────
export type FindingSeverity = "critical" | "warn" | "good" | "info";
export type Finding = {
  id: string;
  surface: string;
  severity: FindingSeverity;
  impact: "ranking" | "conversion" | "trust" | "completeness";
  title: string;
  detail: string;
  fix: string;
  evidence?: string;
  /** true = status/context fact (rendered apart), absent = actionable fix. */
  context?: true;
};
/** A surface the run could NOT read — an honest 🔒 "unlock to see + improve". */
export type SurfaceLock = { surface: string; label: string; unlockCopy: string };
export type RunAudit = {
  app?: string;
  bundleId?: string;
  liveName?: string;
  /** null = couldn't read screenshots (unmeasured, never "zero"). */
  screenshots?: {
    grade: string;
    score: number | null;
    findings: string[];
    iphoneCount: number;
    ipadCount: number;
  } | null;
};

export type RunResult = {
  currentCopy: CopyFields;
  proposedCopy: CopyFields;
  /** withheld ([]) until the human approves — the server privacy boundary. */
  pushCommands: PushCommand[];
  findingsSummary?: FindingsSummary;
  audit?: RunAudit;
  findings?: Finding[];
  locks?: SurfaceLock[];
};

/** POST /runs/:id/asc/push — Apple's verdict, verbatim; never a silent failure. */
export type AscPushResult =
  | { ok: true; versionId: string; localizationId: string; fieldsPushed: string[] }
  | { ok: false; reason: string };
/** POST /apps/:id/run-asc — the keyed (Mode-A) run. */
export type RunAscResult = { id: string; status: string; digest: string; ascRead: boolean };
/** POST /runs/:id/asc/create-version (#34) — Apple's verdict, verbatim. */
export type AscCreateVersionResult =
  | { ok: true; versionId: string; versionString: string; state: string }
  | { ok: false; reason: string };
/** POST /runs/approve-all — bulk-approve every pending run (Scale ergonomic). */
export type ApproveAllResult = { approved: string[]; approvedCount: number; skipped: unknown[] };

// ── GitHub metadata-PR path (#8) ─────────────────────────────────────────────
/** GET /github/status — is the App configured on this deploy + is a repo linked? */
export type GithubStatus = { appConfigured: boolean; connected: boolean; repo: string | null };
/** POST /github/connect — link/unlink the installation + repo. */
export type GithubConnectResult = { connected: boolean; repo: string | null };
/** POST /runs/:id/github/pr — the opened PR, or Apple/GitHub's refusal verbatim. */
export type GithubPrResult =
  | { ok: true; url: string; number: number; branch: string }
  | { ok: false; reason: string };
export type RunDetail = {
  id: string;
  app_id: string;
  status: string;
  created_at: string;
  approval: RunApproval | null;
  result: RunResult;
};

/**
 * The approve/reject response is a SLIM partial, NOT a full RunDetail: the server
 * returns only the changed fields (status, the revealed pushCommands, and — on
 * approve — the finalized proposedCopy reflecting any human edits). It carries no
 * `result`/`currentCopy`, so callers must MERGE it onto the cached RunDetail
 * rather than replace it.
 */
export type RunDecision = {
  id: string;
  status: string;
  note?: string;
  proposedCopy?: CopyFields;
  pushCommands: PushCommand[];
};

// ── analytics: measured conversion + movement (analytics-reports Phase 3) ─────
/** How conversion moved around one approved push. Correlational, measured. */
export type ConversionMovement = {
  at: string;
  runId?: string;
  /** "" = all sources (aggregate); otherwise a specific traffic source. */
  source: string;
  /** measured conversion fraction (0..1) before / from the push. */
  before: number;
  after: number;
  delta: number;
  samplesBefore: number;
  samplesAfter: number;
};
/** The honest Phase-1 analytics state (POST …/analytics/enable). No metric — a
 *  disclosure: needs Admin, still generating, not set up, or a transient failure. */
export type AnalyticsState =
  | { state: "admin_required"; message: string }
  | { state: "unavailable"; message: string }
  | { state: "not_requested"; message: string }
  | { state: "pending"; message: string; requestId: string; created: boolean };
/** POST …/analytics/ingest — the enable-state passthrough, or a persisted count. */
export type AnalyticsIngestResult =
  | AnalyticsState
  | { state: "pending"; message: string }
  | { state: "ingested"; instances: number; rowsPersisted: number; days: number };

/** GET /apps/:id/analytics/engagement — the measured conversion surface. `no_data`
 *  until something is ingested; `measured` carries the numbers (latest may be null
 *  = unmeasured, never a fabricated 0). */
export type EngagementSurface =
  | { state: "no_data"; message: string }
  | {
      state: "measured";
      latestConversion: { date: string; rate: number } | null;
      movements: ConversionMovement[];
      days: number;
    };

// ── connect / resolve ───────────────────────────────────────────────────────
export type Candidate = {
  bundle_id: string;
  name: string;
  publisher?: string;
  genres?: string[];
  icon_url?: string;
};
export type ConnectResult =
  | { id: string; name: string; bundleId: string }
  | { needsChoice: true; candidates: Candidate[] };

// ── public surfaces (funnel) ────────────────────────────────────────────────
export type ProofAggregate = {
  appsWithWins: number;
  totalWins: number;
  bestImprovement: number;
  medianImprovement: number;
};
/** POST /preview → candidate picker, a preview audit, or an error. */
export type PreviewResult = {
  needsChoice?: boolean;
  candidates?: Candidate[];
  bundleId?: string;
  error?: string;
  preview?: { grade?: string | null; summary?: string; findings?: string[] };
};

// ── settings (comms-prefs) ──────────────────────────────────────────────────
export type RankCadence = "weekly" | "daily";
export type EmailDigest = "weekly" | "off";
export type NotificationPrefs = { push_run_ready: boolean; email_digest: EmailDigest };
export type Me = {
  email: string | null;
  push_run_ready?: boolean;
  email_digest?: EmailDigest;
  rank_cadence?: RankCadence;
  /** the per-user master switch for the weekly autonomous sweep (#51). */
  paused?: boolean;
};

/** POST /account/asa-credential (#78-2) — verified + stored ASA key metadata. */
export type AsaConnectResult = { credential: StoredCredential; popularityLive: boolean; note: string };

/** Stored-credential METADATA only — never key material (honesty boundary). */
export type StoredCredential = {
  id: string;
  appId: string | null;
  kind: "asc" | "play" | "asa";
  keyId: string;
  issuerId: string;
  createdAt: string;
  lastUsedAt: string | null;
  kekVersion: number;
};
