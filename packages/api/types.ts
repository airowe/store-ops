/**
 * SPIKE SUBSET of the API types. Production (PRD 01) lifts the full
 * `mobile/src/types/api.ts` here verbatim and makes THIS the canonical location
 * both the app(s) and — for request/response parity — the Worker import. Kept
 * small here to prove the client shape typechecks end to end.
 */

/**
 * Mirrors schema.sql's `runs.status` CHECK constraint and the server's
 * `RUN_STATUSES` (cloud/src/engine/constants.ts) — the union must admit every
 * status a real row can carry, or the client is typed against a lie.
 *
 * `superseded` is terminal: an older awaiting_approval run replaced by a newer
 * one for the same app. It is written by `setRunStatus` and reaches the client
 * on any run list, so it belongs here.
 */
export type RunStatus =
  | "detected" | "researching" | "awaiting_approval"
  | "approved" | "rejected" | "shipped" | "superseded";

export type RankSummary = { lead_keyword: string; lead_rank: number | null };
/**
 * The findings roll-up as the engine actually sends it.
 *
 * This was declared as `{ label, critical }` while `summarizeFindings` has
 * always emitted all seven fields — verified against a live run:
 * `{critical:0, warn:0, good:0, info:4, total:4, topImpact:"completeness",
 * label:"No fixes found"}`. The narrow type meant the web could not tell
 * "4 info notes" from "4 fixes" without re-counting the findings array itself.
 *
 * `critical + warn` are the actionable ones; `info`/`good` are context and must
 * never be presented as work.
 */
export type FindingsSummary = {
  label: string;
  critical: number;
  warn: number;
  good: number;
  info: number;
  total: number;
  topImpact: string | null;
};

/**
 * What the autonomous loop has done for an app. Every field is nullable except
 * the count, because an app can predate the sweep or never have been swept —
 * and a fabricated cadence would be exactly the placeholder the measured-or-
 * nothing rule forbids, applied to a time instead of a rank.
 */
export type LoopState = {
  /** ISO. null = never swept. */
  last_sweep_at: string | null;
  /** ISO of the next scheduled slot. A CHECK, not a promise of a run. */
  next_sweep_at: string | null;
  /** Runs the agent opened by itself. 0 is a measurement here, not an absence. */
  agent_run_count: number;
  /** ISO of the first agent-opened run — "watching since". null when none. */
  agent_since: string | null;
};

export type AppListItem = {
  id: string;
  name: string;
  bundle_id: string;
  latest_run: { status: RunStatus; created_at: string } | null;
  rank_summary: RankSummary | null;
  findings_summary: FindingsSummary | null;
  /**
   * Optional, not just nullable: a Worker deployed before this field omits the
   * key entirely, and the web/mobile clients must render against that response
   * during the deploy-order window rather than crash on it.
   */
  loop?: LoopState | null;
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
  /**
   * "lost" means we measured and the term fell out of the results — a real,
   * bad-news event. It is NOT "unmeasured", which means we have no current
   * reading at all. The engine has always emitted "lost" (digest.ts) but the
   * union omitted it, so the value shipped off-contract and the UI rendered it
   * as neutral silence (#360).
   */
  direction: "up" | "down" | "same" | "new" | "lost" | "unmeasured";
};
export type DeltasResponse = { entries: DeltaEntry[] };

/**
 * One keyword's LATEST reading (#473) — the standing view's row. Distinct from
 * DeltaEntry: it carries `total` (apps competing) and `checked_at` (when we
 * read it), which the delta reduction drops and a standing view cannot
 * reconstruct. `rank: null` means searched-and-not-found, never the scan depth.
 */
export type StandingEntry = {
  keyword: string;
  rank: number | null;
  total: number | null;
  checked_at: string;
};
export type StandingResponse = {
  entries: StandingEntry[];
  ranked: number;
  tracked: number;
  /** the strongest measured position, or null when nothing ranks. Never 0. */
  best: number | null;
};

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

export type RunRow = {
  id: string;
  status: RunStatus;
  created_at: string;
  /**
   * Who opened this run. null for a run predating the field — the UI shows NO
   * actor marker in that case rather than an invented default.
   */
  trigger?: RunTrigger | null;
};
export type AppDetail = {
  app: { id: string; bundle_id: string; name: string; country: string };
  runs: RunRow[];
  /** Optional: a Worker predating this field omits the key entirely. */
  loop?: LoopState | null;
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
  /**
   * #324: where to actually DO this. Absent on findings with no fix, and on
   * runs persisted before #324.
   */
  action?: FindingAction;
};

/** an existing ShipASO builder a finding can hand off to (#324 Tier 2). */
export type FindingTool = "screenshots" | "cpp";
/**
 * #324: the action attached to a finding that would otherwise read as
 * "→ do X in App Store Connect".
 *
 * `url` is always on Apple's console host but is not always precise: Apple does
 * not document the console's route structure, so `appScoped` says whether we
 * reached THIS app's page or only the generic console. The UI states which,
 * rather than implying a precision we don't have. `tool` is present only where a
 * real in-product builder continues the finding — never a guessed handoff.
 */
export type FindingAction = {
  url: string;
  label: string;
  appScoped: boolean;
  tool?: FindingTool;
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
/** the three ranking fields, in canonical order. */
export type CoverageField = "name" | "subtitle" | "keywords";
/** one itemized source of wasted metadata budget. */
export type CoverageWaste = {
  kind: "duplicate" | "brand_repeat" | "filler" | "unused";
  detail: string;
  chars: number;
  /**
   * #322: WHICH field(s) the waste lives in, name → subtitle → keywords. Always
   * measured (the term was tokenized out of that field), never inferred.
   * Optional so runs persisted before #322 still render.
   */
  fields?: CoverageField[];
  /**
   * #322: true only for filler confined to the KEYWORD field, where Apple
   * ignores it for ranking — removing it reclaims chars with no readability
   * cost. Name/subtitle filler, duplicates and brand repeats are all false:
   * those are human judgement calls.
   */
  safeToStrip?: boolean;
};
/**
 * #322: the safe, reversible keyword-field tightening — before/after so the
 * change is SHOWN and reviewable, never applied silently. Absent when nothing
 * is safely strippable or the keyword field was never read.
 */
export type KeywordFieldStrip = {
  before: string;
  after: string;
  removed: string[];
  reclaimedChars: number;
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
  /** #322: the safe keyword-field tightening, when there is one to show. */
  keywordFieldStrip?: KeywordFieldStrip;
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
  /**
   * The live version string, when the run's listing read returned one (#326).
   * Absent = unread. The status bar shows "v—", never a plausible "1.0".
   */
  liveVersion?: string;
  /**
   * The measured star rating (#326). Each half is independently measured, so a
   * read average with an unread count is `{ average, count: null }` — never a
   * fabricated count. Absent when neither half was readable; an unrated app is
   * absent, never a 0-star app.
   *
   * `source` names the App Store surface the pair was read from: the lookup API
   * wins whenever it read either half, and the public listing page backs up a
   * lookup that carried no rating at all. The surfaces can disagree, so halves
   * are never merged across them — a pair always describes ONE surface.
   */
  rating?: { average: number | null; count: number | null; source: "lookup" | "storefront" };
  /**
   * The app's CATEGORY chart position (#326). `rank: null` means the chart WAS
   * read and the app is not in it; the field is absent when the chart was never
   * read (unknown), so the bar falls back to its "#—" placeholder.
   *
   * `category` is optional: a genre id we cannot name is NOT a category name,
   * so it is omitted and the bar renders a bare "#42" rather than "#42 in 6013".
   */
  categoryRank?: { rank: number | null; category?: string };
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

/** POST /runs/:id/asc/push — Apple's verdict, verbatim; never a silent failure.
 *  name/subtitle and keywords/description live on DIFFERENT ASC resources, so a
 *  push can land one and be refused on the other: `partialFailure` carries the
 *  refusal for the fields that did NOT land, while `fieldsPushed` lists those
 *  that did. Honesty invariant: a refused field is never reported as pushed. */
export type AscPushResult =
  | { ok: true; versionId: string; localizationId: string; fieldsPushed: string[]; partialFailure?: string }
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

// ── portfolio screens (#356) — the fleet-wide siblings of the per-app views ───

/**
 * GET /runs. A run, app-first: `app_name` is REQUIRED because a run id means
 * nothing on a fleet screen without the app it belongs to.
 *
 * `findings_summary` is the same shape `AppListItem` carries. `null` = this run
 * has no summary (an older trace, or a run path that never computed findings),
 * and the UI renders NO chip. It is never 0 — a zero would claim "audited, and
 * nothing was critical", which is a different and unearned statement.
 *
 * Ordering is server-side: runs at the human gate lead at ANY age, then
 * created_at descending.
 */
export type PortfolioRunRow = RunRow & {
  app_id: string;
  app_name: string;
  findings_summary: FindingsSummary | null;
};
export type PortfolioRunsResponse = { runs: PortfolioRunRow[] };

/**
 * GET /keywords. One row per keyword × app × STOREFRONT — a rank belongs to one
 * app in one storefront, so a keyword-only row would have to pick or average,
 * and either fabricates. `country` names the storefront the rank was read in.
 */
export type PortfolioDeltaEntry = DeltaEntry & {
  app_id: string;
  app_name: string;
  /** the storefront the rank was read in (lowercased ISO, e.g. "us", "jp"). */
  country: string;
};
export type PortfolioKeywordsResponse = { entries: PortfolioDeltaEntry[] };

/**
 * GET /competitors. Grouped by RIVAL, because one rival typically competes with
 * several of your apps — but watching stays PER-PAIR: `status` and `source` are
 * facts about (this app, this rival), so confirming a rival for one app never
 * silently confirms it for another.
 *
 * There is deliberately NO `sharedTerms` count. Measuring "how many of this
 * app's tracked keywords the rival also ranks for" would need rival-vs-our-
 * keyword rank data that is never persisted (the war room live-fetches it per
 * request), so the number could only be estimated — and an absent count is
 * honest where a guessed one is not.
 */
export type PortfolioRivalPair = {
  app_id: string;
  app_name: string;
  /** same values as `Competitor.status`. */
  status: string;
  source: string;
};
export type PortfolioRival = { key: string; name: string; pairs: PortfolioRivalPair[] };
export type PortfolioCompetitorsResponse = { rivals: PortfolioRival[] };

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
/**
 * Why a run exists: the agent's own account, persisted on every run since runs
 * existed. `source` is who caused it; `reasons` are the measured observations
 * the sweep recorded when it decided to open one (empty for manual/connect).
 *
 * Optional because runs persisted before the field was added carry no trigger —
 * a consumer must render nothing rather than infer one.
 */
export type RunTrigger = {
  source: "manual" | "cron" | "connect";
  reasons: string[];
};

export type RunDetail = {
  id: string;
  app_id: string;
  status: string;
  created_at: string;
  approval: RunApproval | null;
  /** Present on runs opened after the field shipped; absent on older rows. */
  trigger?: RunTrigger | null;
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
/**
 * `email_run_ready` is separate from `email_digest` rather than a third digest
 * value: SQLite cannot ALTER a CHECK constraint, so widening the enum would
 * have meant rebuilding `users` (migration 0013).
 */
export type NotificationPrefs = {
  push_run_ready: boolean;
  email_digest: EmailDigest;
  /** Tell me on my verified channels the moment a run reaches the gate. */
  email_run_ready: boolean;
};
export type Me = {
  /**
   * Whether there is a session at all. `/auth/me` answers `{authed:false}` to a
   * signed-out caller — a 200, not a 401 — so a consumer that only reads the
   * preference fields sees `undefined` for each and falls through to its own
   * defaults, presenting them as though they were the user's. Model it, and
   * "nobody is signed in" stays distinguishable from "signed in, nothing set".
   */
  authed?: boolean;
  email: string | null;
  push_run_ready?: boolean;
  email_digest?: EmailDigest;
  email_run_ready?: boolean;
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
  /**
   * #372: false when the stored key can no longer be DECRYPTED — the row is
   * present but the key-encryption key it was sealed under is not the one
   * configured (e.g. CRED_KEK_V1 replaced instead of rotated to V2).
   *
   * Optional so an older API response (which omits it) is treated as readable
   * rather than a fleet of keys silently reading as broken. The UI must withhold
   * push affordances when it is explicitly false: metadata listing never
   * decrypts, so without this a dead key looks perfectly healthy.
   */
  readable?: boolean;
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

// ── ShipShots (#153) — LLM-planned, deterministically-rendered screenshots ────

/** The fixed ShipShots template library — matches the engine's TEMPLATE_IDS. */
export type TemplateId = "headline-top" | "headline-bottom" | "full-bleed" | "duo";

/**
 * One planned shot (mirrors the engine's PlannedShot). A "MISSING" sourceScreen
 * is an honest gap — the local renderer draws a labeled placeholder, never a
 * fabricated screen. `needsReview` flags a bad headline (kept, not dropped).
 */
export type PlannedShot = {
  sourceScreen: string;
  missingReason?: string;
  headline: string;
  subline?: string;
  templateId: TemplateId;
  accent?: string;
  needsReview?: boolean;
  headlineIssue?: string;
};

/**
 * The planner's output (mirrors the engine's ScreenshotPlan). `degraded` = the
 * deterministic fallback shaped it (no model). `label` is the verbatim draft
 * caveat, shown as-is.
 */
export type ScreenshotPlan = {
  narrative: string;
  shots: PlannedShot[];
  label: string;
  degraded: boolean;
};

/** Request body for POST /plan/screenshots. */
export type ScreenshotPlanInputs = {
  appName: string;
  subtitle?: string;
  keywords?: string[];
  rawScreens?: string[];
  audit: { grade?: string; recommendedCount: number; findings: string[] };
  brandPalette?: string[];
};

// ── CPP sets (#154 Part 2) — per-intent Custom Product Page screenshot sets ────

/** A cluster of tracked keywords sharing a term — the evidence a CPP is for. */
export type KeywordIntent = { label: string; keywords: string[] };

/** One proposed CPP set: the named intent + the ShipShots plan pitched at it. */
export type CppSet = { intent: KeywordIntent; plan: ScreenshotPlan };

/**
 * POST /cpp/sets result. `ok:false` is the honest sparse-data refusal (a CPP is
 * only worth proposing per distinct measured intent) — a valid answer, not an
 * error. `ok:true` carries one set per qualifying intent.
 */
export type CppSetsResult =
  | { ok: false; reason: string }
  | { ok: true; sets: CppSet[]; intentsMeasured: number };

/** Request body for POST /cpp/sets. */
export type CppSetsInputs = {
  appName: string;
  subtitle?: string;
  keywords?: string[];
  rawScreens?: string[];
  auditGrade?: string;
  findings?: string[];
  brandPalette?: string[];
  recommendedCount?: number;
};

// ── sweep schedule (#52) — WHEN the unattended sweep checks an app ───────────
export type SweepCadence = "daily" | "weekly" | "biweekly";
/** Day is UTC 0=Sunday…6=Saturday, ignored for daily; hourUtc is 0–23. */
export type SweepSchedule = { cadence: SweepCadence; day: number; hourUtc: number };
export type ScheduleResult = { schedule: SweepSchedule };

/**
 * POST /runs/:id/approval-nonce — the token that lets the NEXT request approve
 * this run (ADR-001). Minting is harmless: it writes nothing and expires unused.
 */
export type ApprovalNonce = { nonce: string; expiresInSeconds: number };

/** POST /runs/:id/edits — a staged proposal edit. Never a decision. */
export type StagedEdit = {
  id: string;
  status: "awaiting_approval";
  staged: string[];
  proposedCopy: CopyFields;
  note: string;
};

// ── notification channels (migrations 0014/0015) ─────────────────────────────
export type ChannelKind = "email" | "telegram";

/**
 * One delivery destination. `verified` is safety-critical: an unverified row is
 * an address nobody has proven they control, and is never delivered to.
 * `enabled` is separate, so muting a channel never costs its proof.
 */
export type NotificationChannel = {
  channel: ChannelKind;
  address: string;
  label: string;
  enabled: boolean;
  verified: boolean;
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
};

export type ChannelsResult = {
  channels: NotificationChannel[];
  /** Links minted but not yet opened — lets a UI say "waiting" honestly. */
  pendingLinks: number;
  /** What this deployment can actually deliver on. */
  available: ChannelKind[];
};

/** POST /account/channels/link — the deep link that proves control of a chat. */
export type ChannelLink = {
  channel: ChannelKind;
  code: string;
  url: string;
  expiresInSeconds: number;
  note: string;
};
