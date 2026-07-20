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
/**
 * A stored per-locale draft (#78): the fitted copy plus the verbatim
 * machine-translation caveat the UI must render. `label` is server-authored;
 * it is optional here only because runs approved before the caveat was
 * threaded through carry none.
 */
export type LocalizedCopy = CopyFields & { label?: string };
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

/** honest reachability bucket for an opportunity — labels longshots, never hides them. */
export type Reachability = "now" | "soon" | "longshot";
/**
 * A winnability-ranked keyword opportunity (PRD 06) — "where to push next."
 * Curated copy only (keyword + measured rank + score + correlational why); no
 * raw ASC data. Mirrors the engine `Opportunity`, trimmed to display fields.
 */
export type Opportunity = {
  keyword: string;
  /** current (latest) measured rank, 1-based, or null when not in the top results. */
  rank: number | null;
  /** 0–100 winnability, weighted over the measured drivers. */
  opportunityScore: number;
  /**
   * Is the score backed by a measured signal? `false` = unranked with no
   * competitor data and no history, so the score is a no-data artifact and the
   * UI shows "not enough data to score" instead of the number. Optional so
   * legacy/persisted rows (no flag) still render their score.
   */
  scored?: boolean;
  /** human, correlational explanation — never a promise. */
  why: string;
  reachability: Reachability;
};

/** storefront market-size tier for a locale recommendation. */
export type StorefrontTier = "large" | "mid" | "long-tail";
/**
 * A localization-expansion recommendation (PRD 04) — an ROI-sorted locale to add,
 * from a STATIC bundled heuristic (never live install numbers). Rationale is a
 * market/language descriptor, never a fabricated metric.
 */
export type LocaleRecommendation = {
  locale: string;
  rationale: string;
  storefrontTier: StorefrontTier;
  /** "translate" = existing copy to translate; "new" = net-new metadata. */
  effort: "translate" | "new";
};

/** one field's fill against its App Store char budget (30/30/100). */
export type FieldFill = {
  field: "name" | "subtitle" | "keywords";
  limit: number;
  used: number;
  fillPct: number;
  /** false = the field was unseen (a 0 here is UNKNOWN, never "empty"). */
  seen: boolean;
};
/** one itemized source of wasted metadata budget. */
export type CoverageWaste = {
  kind: "duplicate" | "brand_repeat" | "filler" | "unused";
  detail: string;
  chars: number;
};
/**
 * Metadata coverage report (PRD 03) — how hard the 30/30/100 char budget is
 * working, with itemized waste. Curated counts + copy only; no raw ASC data.
 */
export type CoverageReport = {
  coverageScore: number;
  fieldFill: FieldFill[];
  distinctTerms: number;
  waste: CoverageWaste[];
  topMissingValue?: string;
};

/**
 * A proposed Product Page Optimization treatment brief (#182 Phase 3) — a
 * concrete, ready-to-run outcome-led screenshot experiment. Recommendation copy
 * + a cited public result; no raw ASC data, no invented metrics.
 */
export type PpoTreatmentPlan = {
  headline: string;
  steps: string[];
  evidence: string;
  guidance: string;
  /** deep link into App Store Connect to set the test up, when the id is known. */
  ascUrl?: string;
};

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
  /** locales the human approved a localized draft for (#78) — the copy is theirs, plus the verbatim MT caveat. */
  localizedCopy?: Record<string, LocalizedCopy>;
  /** winnability-ranked keyword opportunities (PRD 06) — "where to push next." */
  opportunities?: Opportunity[];
  /** ROI-sorted locales to add (PRD 04) — static heuristic, PII-safe. */
  localizationExpansion?: LocaleRecommendation[];
  /** metadata budget-efficiency report (PRD 03) — score + itemized waste. */
  coverage?: CoverageReport;
  /** proposed outcome-led PPO treatment brief (#182 Phase 3) — read-only. */
  ppoTreatment?: PpoTreatmentPlan;
};

/** POST /runs/:id/localize — a generated localized draft for one locale (#78). */
export type LocalizedDraft = {
  locale: string;
  copy: CopyFields;
  /** fields trimmed to fit their App Store limit — surfaced honestly. */
  trimmed: string[];
  validation?: { pass: boolean };
  /** the verbatim machine-translation caveat the UI must render (server-authored). */
  label?: string;
};
/** POST /runs/:id/localize/approve · DELETE …/:locale — the approved-locale set. */
export type LocalizeResult = { approved: string[] };

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

// ── competitors (#72 — discover, the human confirms) ─────────────────────────
/** A watched/suggested competitor. status: "confirmed" feeds runs; "suggested" waits. */
export type Competitor = { key: string; name: string; source: string; status: string };
export type CompetitorsResponse = { competitors: Competitor[]; discovered?: number; note?: string };

// ── locale-native keyword ideas (#180 Phase 3) ───────────────────────────────
/** A keyword term measured from the top apps in a target storefront. */
export type LocaleKeywordCandidate = {
  term: string;
  market: string;
  usedByCount: number;
  usedBy: string[];
};
/** POST /apps/:id/locale-keywords — measured, market-native keyword ideas. */
export type LocaleKeywordsResult = {
  market: string;
  seeds?: string[];
  candidates: LocaleKeywordCandidate[];
  /** honest empty-state (no tracked keywords + no seeds). */
  note?: string;
};

// ── post-rejection assistant (#178 Phase 4) ──────────────────────────────────
export type ResolutionPath = "fix_and_resubmit" | "appeal";
/** POST /rejection-assistant — cited guideline + verbatim rule + recommendation + drafts. */
export type RejectionAnalysis = {
  guidelines: string[];
  primaryGuideline: string | null;
  /** verbatim rule text when the cited guideline is in our corpus, else null. */
  quote: string | null;
  recommended: ResolutionPath | "unclear";
  rationale: string;
  drafts: Record<ResolutionPath, string>;
};

// ── Google Play audit (#Android loop) ────────────────────────────────────────
/** POST /apps/:id/audit-play — read-only Play listing audit. Findings/locks are
 *  the SAME shapes the iOS run renders, so the UI reuses FindingsCard. */
export type PlayAudit = {
  appId: string;
  screenshots?: { grade?: string; score?: number | null } | null;
  findings: Finding[];
  summary?: FindingsSummary;
  locks: SurfaceLock[];
};

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

/** One measured month of the Play conversion funnel (PRD 02-D). Monthly + lagged;
 *  conversionRate is DERIVED (null when it can't be honestly computed). */
export type PlayFunnelMonth = {
  period: string;
  country: string;
  visitors: number | null;
  acquisitions: number | null;
  conversionRate: number | null;
};
export type PlayFunnelSurface = {
  state: "measured" | "empty";
  cadence: "monthly";
  throughPeriod: string | null;
  months: PlayFunnelMonth[];
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
/**
 * The teaser the Worker hands a logged-out visitor. Mirrors `AppPreview` in
 * cloud/src/engine/preview.ts EXACTLY — these field names are the wire contract.
 * (This type previously claimed `{ grade, summary, findings }`, which the server
 * has never sent; every field read `undefined` and the preview card rendered
 * empty. Every field here is required for that reason: an optional field that
 * doesn't exist type-checks fine and fails silently at runtime.)
 */
/** One field of the public report card — measured, or unreadable (never a fake 0). */
export type ReportFieldScore = {
  field: "title" | "subtitle" | "description" | "screenshots" | "ratings" | "freshness";
  max: number;
  /** measured points, or null when the public read couldn't see this field. */
  score: number | null;
  state: "measured" | "unreadable";
  note: string;
};

export type AppPreview = {
  appName: string;
  auditGrade: string | null;
  leadKeyword: string | null;
  leadRank: number | null;
  keywordsChecked: number;
  inTop10: number;
  /** a short ranked sample (keyword + position), enough to feel real */
  sample: { keyword: string; rank: number | null }[];
  /** per-field scored breakdown (#287) — the public report card. */
  breakdown: ReportFieldScore[];
  /** composite 0–100 over measurable fields, or null when nothing was measurable. */
  score: number | null;
  /** how many fields the public read could score, out of the total — a thin read isn't a perfect one. */
  fieldsMeasured: number;
  fieldsTotal: number;
};

/** POST /preview → candidate picker, a preview audit, or an error. */
export type PreviewResult = {
  needsChoice?: boolean;
  candidates?: Candidate[];
  bundleId?: string;
  country?: string;
  error?: string;
  preview?: AppPreview;
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

/** A scoped agent/MCP API key — metadata only; the raw key is never in here. */
export type ApiKeyMeta = {
  id: string;
  label: string;
  /** non-secret display prefix, e.g. "shipaso_1a2b3c4d…". */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** The create response — carries the raw `key` ONCE (copy it then; never shown again). */
export type ApiKeyCreated = ApiKeyMeta & { key: string };
