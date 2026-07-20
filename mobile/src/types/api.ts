/**
 * Shared API DTOs — the response/result shapes the mobile app consumes from the
 * Worker API (`https://api.shipaso.com`). These MIRROR the engine's public types
 * in `cloud/src/engine/**` and `cloud/src/api/index.ts`; the phone is a dumb
 * client of that JSON and does NOT re-implement the ASO engine (see
 * `docs/prd/expo-app/00-implementation-plan.md` §1b — share types, not the engine).
 *
 * The load-bearing honesty contract rides through these types unchanged:
 *   • a string (incl. "") is MEASURED; `null` is UNREAD / UNMEASURED.
 *   • `keywordField` is ALWAYS null for Google Play (Play has no keyword field).
 *   • a `score` of `null` (grade "?") means unknown/unreadable — NOT zero.
 *   • `seen:false` on a coverage field means UNKNOWN, not a measured 0.
 *   • `SurfaceLock`s are capability gaps ("connect to unlock"), never deficiencies.
 *
 * Kept narrow on purpose: only the shapes a screen renders. When `cloud/` later
 * imports a shared package to guarantee no drift, these are the canonical fields.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

/** `GET /auth/me` — the session boot check. */
/** Communication preferences (comms-prefs). Server truth; boolean at the API edge. */
export type NotificationPrefs = {
  /** 'off' silences the weekly digest email — the agent keeps working. */
  email_digest: "weekly" | "off";
  /** false = the server sends no run-ready push — the run still opens. */
  push_run_ready: boolean;
};

/** How often the cron snapshots ranks (data collection, NOT email frequency). */
export type RankCadence = "daily" | "weekly";

export type Me = {
  authed: boolean;
  /** how the caller was identified. "demo" is the X-User-Email stub (dev only). */
  via?: "session" | "demo";
  email?: string;
  /** present when authed (comms-prefs Phase 1 puts these on /auth/me). */
  email_digest?: NotificationPrefs["email_digest"];
  push_run_ready?: boolean;
  rank_cadence?: RankCadence;
};

/** `POST /auth/request {email}` — passwordless magic-link request. Always sent. */
export type AuthRequestResult = { sent: true };

/**
 * Mobile auth callback/exchange — the magic-link token is exchanged for a signed
 * session token the app stores in SecureStore and sends as `Authorization: Bearer`.
 * (Server gate: the JSON/mobile mode on `/auth/callback` or `/auth/exchange`.)
 */
export type AuthExchangeResult = { token: string };

// ── Resolve / connect (dashboard) ────────────────────────────────────────────

export type Query =
  | { kind: "appstore-id"; id: string }
  | { kind: "bundle-id"; id: string }
  | { kind: "name"; term: string };

/** A connectable app candidate, normalized from a store search result. */
export type AppCandidate = {
  bundleId: string;
  name: string;
  publisher: string | null;
  genres: string[];
  trackId: number | null;
  iconUrl: string | null;
};

// ── logged-out preview (try-before-signup) ───────────────────────────────────
//
// NOTE the casing: /preview returns snake_case `bundle_id`, NOT the camelCase
// `bundleId` that /resolve returns on AppCandidate above. Different routes,
// different wire shapes — reusing AppCandidate here would silently read
// undefined. These mirror `packages/api`'s Candidate + PreviewResult exactly.

/** One pick-list entry when a preview query is ambiguous. */
export type PreviewCandidate = {
  bundle_id: string;
  name: string;
  publisher?: string;
  genres?: string[];
};

/**
 * The teaser the Worker hands back to a logged-out visitor: the REAL grade and
 * findings, never an inflated one. The payoff (optimized copy + push commands)
 * is withheld until they sign up and connect the app.
 */
export type PreviewResult = {
  needsChoice?: boolean;
  candidates?: PreviewCandidate[];
  bundleId?: string;
  error?: string;
  country?: string;
  preview?: AppPreview;
};

/**
 * The teaser itself. Mirrors `AppPreview` in cloud/src/engine/preview.ts EXACTLY
 * — these names are the wire contract. Fields are REQUIRED on purpose: the old
 * shape claimed optional `{ grade, summary, findings }`, which the server has
 * never sent, so every read was `undefined` and the card rendered empty while
 * still type-checking.
 */
export type AppPreview = {
  appName: string;
  auditGrade: string | null;
  leadKeyword: string | null;
  leadRank: number | null;
  keywordsChecked: number;
  inTop10: number;
  sample: { keyword: string; rank: number | null }[];
};

/** `POST /resolve {query}` — classify a query into a connectable result. */
export type ResolveResult = {
  /**
   * resolved   — exactly one connectable match (connect can proceed directly)
   * candidates — several matches; the user must pick one
   * not-found  — nothing connectable matched
   */
  kind: "resolved" | "candidates" | "not-found";
  query: Query;
  candidates: AppCandidate[];
  /** the offset this page started at (0 for the first page). */
  offset: number;
  /** true when another page of name-search results exists (drives "Show more"). */
  hasMore: boolean;
};

// ── Findings ─────────────────────────────────────────────────────────────────

export type FindingSeverity = "critical" | "warn" | "good" | "info";
export type FindingImpact = "ranking" | "conversion" | "trust" | "completeness";

export type Finding = {
  /** stable id, e.g. "privacy_policy_missing" */
  id: string;
  /** the surface it came from, e.g. "appInfo" | "previews" | "screenshots" */
  surface: string;
  severity: FindingSeverity;
  impact: FindingImpact;
  title: string;
  detail: string;
  fix: string;
  /** the data point, when it sharpens the point. */
  evidence?: string;
  /** #71-C: true = STATUS/CONTEXT (rendered in the Listing status strip, never
   *  among the actionable fixes). Absent = actionable. */
  context?: boolean;
};

/**
 * A surface a run could NOT read — an honest capability lock ("we can't SEE this
 * without access"), never a deficiency. Renders as a "connect to unlock" prompt.
 */
export type SurfaceLock = {
  surface: string;
  label: string;
  unlockCopy: string;
};

export type FindingsSummary = {
  critical: number;
  warn: number;
  good: number;
  info: number;
  total: number;
  /** the impact lane of the highest-weighted finding, or null when there are none. */
  topImpact: FindingImpact | null;
  /** human one-liner, e.g. "3 fixes available · 1 critical" or "No fixes found". */
  label: string;
};

// ── Screenshots ──────────────────────────────────────────────────────────────

export type Grade = "A" | "B" | "C" | "D" | "F" | "?";

/** A prioritized, quantified C→B→A improvement lever. */
export type Lever = {
  id: "count" | "ipad" | "aspect";
  label: string;
  detail: string;
  /** point gain (> 0 always — never a no-op lever). */
  delta: number;
  fromGrade: Grade;
  toGrade: Grade;
  /** true → offer the screenshots skill linkout. */
  skill?: boolean;
};

/** iOS screenshot score (iphone/ipad families). */
export type ShotScore = {
  app: string;
  iphoneCount: number;
  ipadCount: number;
  /** 0–100, or null when grade is "?" (unknown/unreadable). */
  score: number | null;
  grade: Grade;
  findings: string[];
  aspectHint: string;
  /** the REAL screenshot URLs graded, App Store order. Empty for the "?" set. */
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
  /** empty for the unreadable "?" set and for an A-grade set (no headroom). */
  levers: Lever[];
};

/** One device family's resolved shots (store-agnostic, e.g. Play phone/tablet). */
export type DeviceFamilyShot = {
  family: string;
  label: string;
  count: number;
  /** the resolved (loadable) URLs, in store order. */
  urls: string[];
};

/** A store-agnostic screenshot score keyed by device family. */
export type FamilyShotScore = {
  app: string;
  /** the primary family key (drives the count budget). */
  primaryFamily: string;
  primaryCount: number;
  families: DeviceFamilyShot[];
  /** 0–100, or null when grade is "?" (unreadable/unknown). */
  score: number | null;
  grade: Grade;
  findings: string[];
  aspectHint: string;
};

// ── Coverage (iOS) ───────────────────────────────────────────────────────────

export type CoverageWaste = {
  kind: "duplicate" | "brand_repeat" | "filler" | "unused";
  detail: string;
  chars: number;
};

export type FieldFill = {
  field: "name" | "subtitle" | "keywords";
  limit: number;
  /** chars used — 0 for an unseen field (carries no measured value). */
  used: number;
  fillPct: number;
  /** false when the field's input was undefined (unseen) — a 0 here is UNKNOWN. */
  seen: boolean;
};

export type CoverageReport = {
  /** 0–100: (available budget − total waste chars) / available budget, clamped. */
  coverageScore: number;
  usedChars: { name: number; subtitle: number; keywords: number };
  fieldFill: FieldFill[];
  distinctTerms: number;
  waste: CoverageWaste[];
  /** a high-value term that would fit. Deferred → omitted. */
  topMissingValue?: string;
};

// ── Google Play (connected-tier own-app audit) ───────────────────────────────

export type StoreId = "appstore" | "googleplay";

/** A device family's screenshot URLs, joined to a `DeviceFamily.key`. */
export type ScreenshotGroup = { family: string; urls: string[] };

/**
 * The store-agnostic listing the engine reads. HONEST tri-state on every text
 * field: a string (incl. "") = MEASURED; `null` = UNREAD. `keywordField` is
 * ALWAYS null for Play (absent, never "empty").
 */
export type NormalizedListing = {
  store: StoreId;
  /** bundleId (iOS) / packageName (Play). */
  appId: string;
  title: string | null;
  /** subtitle (iOS) / short description (Play). */
  tagline: string | null;
  /** iOS keyword field; ALWAYS null on Play. */
  keywordField: string | null;
  longDescription: string | null;
  screenshots: ScreenshotGroup[];
  category: { id: string; name: string | null } | null;
  /** is this source trustworthy for ABSENCE? false → empty means UNKNOWN, not zero. */
  reliable: boolean;
};

export type PlayFieldFill = {
  field: "title" | "shortDescription" | "description";
  limit: number;
  used: number;
  fillPct: number;
  seen: boolean;
};

export type PlayCoverageWaste = {
  kind: "stuffing" | "brand_repeat";
  detail: string;
  term: string;
  count: number;
};

export type PlayCoverageReport = {
  fieldFill: PlayFieldFill[];
  distinctTerms: number;
  waste: PlayCoverageWaste[];
  /** 0–100 efficiency heuristic — "how hard your indexed text works", NOT rank. */
  coverageScore: number;
  stuffingRisk: boolean;
};

export type PlayTermCoverage = {
  term: string;
  inTitle: boolean;
  inShortDescription: boolean;
  inDescription: boolean;
  /** MEASURED occurrences in the long description (never extrapolated to volume). */
  descriptionCount: number;
  covered: boolean;
};

export type PlayKeywordReport = {
  terms: PlayTermCoverage[];
  missingFromDescription: string[];
  uncovered: string[];
  stuffed: string[];
};

export type PlayAudit = {
  appId: string;
  listing: NormalizedListing;
  screenshots: FamilyShotScore;
  coverage: PlayCoverageReport;
  keywords: PlayKeywordReport;
  findings: Finding[];
  summary: FindingsSummary;
  /** surfaces this run could not read (capability locks, never deficiencies). */
  locks: SurfaceLock[];
};

/** `POST /play/verify` — service-account credential check (key used once). */
export type PlayVerifyResult = {
  ok: boolean;
  reason?: string;
  appAccessible?: boolean;
};

// ── Dashboard rows ───────────────────────────────────────────────────────────

export type RankSummary = {
  lead_keyword: string;
  lead_rank: number | null;
  top10: number;
  tracked: number;
};

export type LatestRun = {
  id: string;
  status: string;
  created_at: string;
};

/** `GET /apps` — one app card: identity + latest-run badge + rank/findings summary. */
export type AppListItem = {
  id: string;
  bundle_id: string;
  name: string;
  country: string;
  created_at: string;
  latest_run: LatestRun | null;
  rank_summary: RankSummary | null;
  findings_summary: FindingsSummary | null;
};

export type AppList = { apps: AppListItem[] };

// ── Run detail (the money screen) ──────────────────────────────────────────────

/** A generated, NON-executed store handoff command. Never run on the client. */
export type PushCommand = {
  store: "appstore" | "googleplay";
  tool: "asc" | "gplay";
  description: string;
  command: string;
};

/** Editable listing copy. Fields absent (undefined) are unknown/unread. */
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
 * it is optional because runs approved before the caveat was threaded through
 * carry none. Mirrors the shared @shipaso/api `LocalizedCopy`.
 */
export type LocalizedCopy = CopyFields & { label?: string };

/** A generated localized draft for one locale (POST /runs/:id/localize, #78). */
export type LocalizedDraft = {
  locale: string;
  copy: CopyFields;
  /** fields trimmed to fit their App Store limit — surfaced honestly. */
  trimmed: string[];
  validation?: { pass: boolean };
  /** the verbatim machine-translation caveat the UI must render. */
  label?: string;
};

/** POST /runs/:id/localize/approve · DELETE …/:locale — the approved-locale set. */
export type LocalizeResult = { approved: string[] };

export type StorefrontTier = "large" | "mid" | "long-tail";

/** ROI-sorted locale to add (PRD 04) — static heuristic, PII-safe. */
export type LocaleRecommendation = {
  locale: string;
  rationale: string;
  storefrontTier: StorefrontTier;
  /** "translate" = existing copy to translate; "new" = net-new metadata. */
  effort: "translate" | "new";
};

/** A keyword term measured from the top apps in a target storefront (#180). */
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

/** Keyword gap (PRD 01) — a term competitors use that you could win. */
export type KeywordGap = {
  keyword: string;
  competitorsUsing: string[];
  /** your current organic rank for this term, if any. null = unmeasured. */
  youRank: number | null;
  inYourMetadata: boolean;
  score: number;
  fitsBudget: boolean;
};

export type OpportunityDrivers = { distance: number; competitorWeakness: number; momentum: number };
export type Reachability = "reachable" | "stretch" | "longshot" | string;

/** Winnability opportunity (PRD 06) — "where to push next." */
export type Opportunity = {
  keyword: string;
  /** current rank, or null when not in the top results (unmeasured ≠ 0). */
  rank: number | null;
  opportunityScore: number;
  why: string;
  reachability: Reachability;
  drivers: OpportunityDrivers;
};

/** The slim, PII-safe ASC context a Mode-A run carries (when ASC was read). */
export type AscContext = {
  category?: string | null;
  [k: string]: unknown;
};

/** The run-page `result` block — curated copy + counts only (privacy boundary). */
export type RunResult = {
  audit: {
    /** iOS screenshot grade; null when unreadable/absent. */
    screenshots?: ShotScore | null;
    liveName?: string;
    liveSubtitle?: string;
    [k: string]: unknown;
  };
  findings: Finding[];
  findingsSummary: FindingsSummary;
  currentCopy: CopyFields;
  proposedCopy: CopyFields & { [k: string]: unknown };
  /** withheld ([]) until the human approves the run. */
  pushCommands: PushCommand[];
  coverage?: CoverageReport;
  locks?: SurfaceLock[];
  opportunities?: Opportunity[];
  keywordGaps?: KeywordGap[];
  /** locales the human approved a localized draft for (#78) — copy + verbatim MT caveat. */
  localizedCopy?: Record<string, LocalizedCopy>;
  /** ROI-sorted locales to add (PRD 04) — static heuristic, PII-safe. */
  localizationExpansion?: LocaleRecommendation[];
};

export type RunApproval = { decision: string; decided_at: string };

export type RunDetail = {
  id: string;
  app_id: string;
  status: string;
  created_at: string;
  approval: RunApproval | null;
  trigger?: { source?: string; reasons?: string[] } | null;
  result: RunResult;
};

/** `GET /apps/:id` — the app row + its run history. */
export type RunRow = { id: string; status: string; created_at: string };
export type AppDetail = {
  app: { id: string; bundle_id: string; name: string; country: string };
  runs: RunRow[];
};

// ── Trend / movement ───────────────────────────────────────────────────────────
export type RankPoint = { rank: number | null; total: number | null; checked_at: string };
export type RanksSeries = {
  keyword: string;
  points: RankPoint[];
  /** #62: observed-change markers (own approved pushes, competitor visible diffs). */
  annotations?: RankAnnotation[];
};

/** #62: one observed change on the rank timeline. Correlational, never causal. */
export type RankAnnotation = {
  at: string;
  kind: "push" | "competitor";
  label: string;
  runId?: string;
};

/** #72: one competitor on the app's watch list. Only confirmed rows are watched. */
export type Competitor = {
  key: string;
  name: string;
  source: "user" | "discovered";
  status: "suggested" | "confirmed";
};

/** #53: what opens an awaiting_approval run. Defaults = historical behavior. */
export type ThresholdConfig = {
  unranked: boolean;
  competitorChanges: boolean;
  rankDropAtLeast: number | null;
  mutedKeywords: string[];
  mutedCompetitors: string[];
  notifyOnly: boolean;
};

/** #52: when the autonomous sweep runs for this app (default weekly Mon 09:00 UTC). */
export type SweepSchedule = {
  cadence: "daily" | "weekly" | "biweekly";
  day: number;
  hourUtc: number;
};

export type DeltaDirection = "up" | "down" | "flat" | string;
export type DeltaEntry = {
  keyword: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: DeltaDirection;
};
export type DeltasView = { appName: string; entries: DeltaEntry[]; anyMovement: boolean };

// ── Phase 4: extras ────────────────────────────────────────────────────────────

export type WarTrend = "gaining" | "losing" | "flat" | "new" | "lost" | string;
export type HeadToHead = {
  keyword: string;
  /** your current rank, or null if unranked. */
  you: number | null;
  /** your prior rank, or null when there's only one snapshot (skip count-up; never 0). */
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

/** One app in the Scale portfolio roll-up. */
export type PortfolioCard = {
  appId: string;
  name: string;
  grade: string | null;
  leadKeyword: string | null;
  leadRank: number | null;
  pendingApproval: boolean;
};
export type PortfolioSummary = {
  totalApps: number;
  pendingApprovals: number;
  gradeBreakdown: Record<string, number>;
  appsTracked: number;
  cards: PortfolioCard[];
};

/** Public proof aggregates (anonymized). */
export type ProofAggregate = {
  appsWithWins: number;
  totalWins: number;
  bestImprovement: number;
  medianImprovement: number;
};

export type CheckoutResult = { url: string };
