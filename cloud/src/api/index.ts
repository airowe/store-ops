/**
 * store-ops REST API — a plain Cloudflare Workers fetch handler (no framework,
 * zero extra deps). Routed from `src/index.ts`. Talks to D1 via `../d1.js` and
 * runs the ASO loop via the engine's `runAgent`.
 *
 * AUTH (passwordless magic-link → signed session cookie):
 *   - Real path: POST /auth/request mints an HMAC-signed, expiring magic-link
 *     token and "sends" it (ConsoleEmailSender by default). GET /auth/callback
 *     verifies it, upserts the user, and sets an HttpOnly/Secure/SameSite=Lax
 *     session cookie (a separate, longer-lived signed token). POST /auth/logout
 *     clears it. See src/auth.ts for the crypto.
 *   - `requireUser` precedence: session cookie > X-User-Email (demo only) > 401.
 *     The X-User-Email header is kept ALIVE in APP_ENV==="demo" so the live demo
 *     + existing tests still work; outside demo it is ignored.
 *   All app/run access is scoped to the user — you can't read another user's data.
 *
 * BILLING (Stripe, see src/billing.ts + commercial/OFFER.md): POST
 * /billing/checkout mints a Stripe Checkout Session for a tier; POST
 * /billing/webhook applies subscription state to the user's tier (signature
 * verified). Tier gates: free = manual only + 1 app; indie/startup/scale =
 * cron autonomy + more apps. A blocked gate returns 402.
 *
 * CORS: echoes the dashboard origin (not "*") and allows credentials so the
 * session cookie rides cross-origin from the Pages dashboard. Preflight handled.
 *
 * ROUTES:
 *   POST /auth/request      {email} → mint + "send" a magic link. Always 200
 *                           {sent:true} (never leaks whether the email exists).
 *   GET  /auth/callback     ?token=… → verify the magic link, set the session
 *                           cookie, redirect to the dashboard (or 200 {ok}).
 *   POST /auth/exchange     {token} → MOBILE: verify the magic link, return the
 *                           session token as JSON {token} (no cookie) for Bearer.
 *   POST /auth/logout       clear the session cookie.
 *   GET  /auth/me           { authed, via:"session"|"demo", email? } — the
 *                           dashboard's boot check (login screen vs app).
 *   POST /billing/checkout  {tier} → create a Stripe Checkout Session, return
 *                           {url}. tier ∈ indie|startup|scale.
 *   POST /billing/webhook   Stripe events → update the user's tier/status. The
 *                           Stripe-Signature header is verified (raw body HMAC).
 *   POST /subscribe         public launch-list capture (HTML form → 303 back, or
 *                           JSON → 200). Idempotent on email; no auth.
 *   GET  /proof             public anonymized aggregate proof (rank-win numbers
 *                           for the landing). No app/user data. Cached 1h.
 *   GET  /health            authed production-readiness audit (200 ready / 503
 *                           when an error-severity check fails). Not public.
 *   GET  /portfolio         Scale-tier roll-up: every app's grade / lead rank /
 *                           pending-approval + summary counts (402 below Scale).
 *   POST /runs/approve-all  bulk-approve every pending run across the user's apps.
 *   POST /resolve           {query} → connectable candidates (name / App Store or
 *                           Play URL / numeric id / bundle id). No connect, no run.
 *                           kind: "resolved" | "candidates" | "not-found".
 *   POST /apps              connect an app {bundle_id | query, name?, country?} →
 *                           resolves the live listing, creates the app row, runs the
 *                           agent once, stores run+proposals+snapshots
 *                           (awaiting_approval). An ambiguous `query` returns
 *                           {needsChoice:true, candidates} instead of connecting.
 *   GET  /apps              list the user's apps + latest run status
 *   POST /apps/:id/run      trigger an agent run {keywords?, competitors?, baseCopy?}
 *                           → stores a new awaiting_approval run
 *   GET  /apps/:id          app detail (row + latest run + proposals)
 *   GET  /apps/:id/ranks    rank history for the trend chart (?keyword= optional)
 *   GET  /runs/:id          run + reasoning + proposed copy + push commands
 *   POST /runs/:id/approve  {decision:'approve'|'reject'} → records approval;
 *                           approve → status 'approved' + returns push COMMANDS
 *                           (we hand off commands, we never execute them)
 */
import {
  type AgentResult,
  type AppCandidate,
  type CopyFields,
  type FetchLike,
  type GoogleServiceAccount,
  type ProposedCopy,
  type PushCommand,
  type PushInput,
  type WarRoomRankSnapshot,
  ANDROIDPUBLISHER_SCOPE,
  auditPlayListing,
  buildPushCommands,
  buildWarRoom,
  fetchPlayChartRank,
  lookup,
  mintGoogleAccessToken,
  PLAYDEVELOPERREPORTING_SCOPE,
  playApiTransportForServiceAccount,
  playChartRankFinding,
  playChartSource,
  playDataSafetyFindings,
  playDeveloperApiAdapter,
  playQualityFindings,
  playSearchRankFinding,
  playSearchSource,
  playVitalsFindings,
  playWebSource,
  fetchPlaySearchRank,
  rankOpportunities,
  ranksFor,
  readPlayDataSafety,
  readPlayListing,
  readPlayQualityRates,
  readPlayVitals,
  validateSafetyLabelsCsv,
  writeDataSafetyLabels,
  resolveAppQuery,
  resolveNameToBundle,
  runAgent,
  sortFindings,
  verifyPlayServiceAccount,
} from "../engine/index.js";
import type { ReasoningTrace, AppRow, FindingsSummary } from "../d1.js";
import { buildPreview } from "../engine/preview.js";
import { discoverCompetitors, resolveNameToId } from "../engine/competitorWatch.js";
import { resolveSimilarCompetitors } from "../engine/competitorDiscover.js";
import { fetchStorefrontListing } from "../engine/storefrontListing.js";
import { asResponse, buildUrl, fetchJson, ItunesError } from "../engine/itunes.js";
import { ITUNES_LOOKUP_URL } from "../engine/constants.js";
import { detectPortfolio } from "../engine/portfolio.js";
import { fetchChartRank } from "../engine/chartRank.js";
import { buildRankAnnotations } from "../engine/rankAnnotations.js";
import { deriveBrandTokens, localizeCopy, LocalizeError, validateLocalizedSubmission } from "../engine/localizeCopy.js";
import { readLocaleKeywords } from "../engine/localeKeywords.js";
import { analyzeRejection } from "../engine/rejectionAssistant.js";
import { localizeScreenshots, type LayeredSource, type TextSlot } from "../engine/localizeScreenshots.js";
import { localizerForEnv } from "./aiLocalizer.js";
import { credentialsEnabled, deleteCredential, listCredentialMeta, saveCredential, useCredential } from "../credentialStore.js";
import { createApiKey, listApiKeys, looksLikeApiKey, resolveApiKey, revokeApiKey } from "../apiKeys.js";
import { serializeAsaBundle, verifyAsaCredentials, type AsaKeyBundle } from "../engine/asaAuth.js";
import localesData from "../engine/locales-data.json";
import { validateThresholdPatch } from "../thresholds.js";
import { validateSchedule } from "../schedule.js";
import {
  captureProposalEdits,
  confirmCompetitor,
  confirmedCompetitorKeys,
  countAppsForUser,
  createApp,
  deleteApp,
  deleteCompetitor,
  deleteDeviceTokenForUser,
  deleteLocalizedCopy,
  distinctTrackedKeywords,
  getApp,
  getNotificationPrefs,
  getSchedule,
  getThresholds,
  getOptOut,
  getUser,
  getApproval,
  getLatestCompetitorMap,
  getRankHistory,
  getRun,
  getTier,
  getUserByStripeCustomer,
  latestRunTraceForApp,
  listAllApps,
  listAppsForUser,
  listCompetitors,
  listCompetitorSnapshots,
  listRunsForApp,
  persistPlayChartRank,
  persistRankSnapshots,
  persistRun,
  recordApproval,
  recordSubscriber,
  registerDeviceToken,
  setAgentPaused,
  setGithubConnection,
  setEmailDigestByEmail,
  setNotificationPrefs,
  setOptOut,
  setLocalizedCopy,
  setRankCadence,
  setSchedule,
  setThresholds,
  setTier,
  unsubscribeSubscriber,
  updateRunCopy,
  upsertCompetitor,
  upsertEngagementRows,
  getEngagementSeries,
  upsertUser,
} from "../d1.js";
import { isExpoPushToken } from "../push.js";
import { finalizeEditedCopy } from "./proposalEdit.js";
import { decryptField, importKeyFromBase64 } from "../crypto/rlhfCrypto.js";
import {
  mintMagicToken,
  mintSessionToken,
  parseCookie,
  resolveSessionSecret,
  serializeLogoutCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
  verifyMagicToken,
  verifyUnsubToken,
  verifyListUnsubToken,
  verifySessionToken,
} from "../auth.js";
import { emailSenderForEnv } from "../emailSender.js";
import { rankDeltasView } from "../digest.js";
import { pickShareWin, renderShareCardSvg } from "../shareCard.js";
import { aggregateProof, extractWins } from "../proof.js";
import { type AppCard, summarizePortfolio } from "../portfolio.js";
import { type RunRef, planBulkApprove } from "../bulkApprove.js";
import { auditReadiness } from "../readiness.js";
import {
  appLimitForTier,
  createCheckoutSession,
  dunningEmail,
  dunningOutcome,
  type StripePriceEnv,
  tierForPriceId,
  verifyStripeSignature,
} from "../billing.js";
import { buildAppInput, descriptionFromTrace, type RunOverrides } from "./runConfig.js";
import { type AscCred, type AscCredBody, AscCredentialError, resolveAscCredential } from "./ascCredentials.js";
import { reasonerForEnv } from "./aiReasoner.js";
import { captionAnalyzerForEnv } from "./aiCaptionVision.js";
import { analyzeFirstShot, captionFindings } from "../engine/captionLens.js";
import { screenshotClaimFindings } from "../engine/screenshotCompliance.js";
import { buildPpoTreatmentPlan } from "../engine/ppoTreatment.js";
import { fetchForEnv, fetchLikeForEnv } from "../fetchAdapter.js";
import { buildFastlaneBundle } from "../engine/fastlane.js";
import { zipStore } from "../engine/zip.js";
import { mintAscJwt } from "../engine/ascJwt.js";
import { findAscAppId, applyAscMetadata, createAscLocalization, createAscVersion, getEditableVersionId, isValidVersionString, readAscLocalization, AscWriteError } from "../engine/ascWrite.js";
import { readAscSnapshot, ascScreenshotsToListing, type AscSnapshot } from "../engine/ascRead.js";
import { PENDING_MESSAGE, UNAVAILABLE_MESSAGE, enableAnalyticsReports, getAnalyticsStatus } from "../engine/ascAnalytics.js";
import { gunzipText, ingestEngagement } from "../engine/analyticsEngagement.js";
import { conversionMovements, latestConversion } from "../engine/conversionMovement.js";
import { score as scoreScreenshots } from "../engine/screenshotScore.js";
import { auditFindings, summarizeFindings, surfaceLocks } from "../engine/auditFindings.js";
import {
  analyzeSentiment,
  fetchReviewsForBundle,
  reviewKeywordCandidates,
  type Review,
} from "../engine/reviewSentiment.js";
import { withReviewCandidates } from "../engine/keywordGap.js";
import { buildAscContext } from "../engine/ascContext.js";
import { metadataCoverage } from "../engine/metadataCoverage.js";
import { recommendLocales } from "../engine/localizationExpansion.js";
import { recommendLocalesFromLanguages } from "../engine/languageCoverage.js";
import { mintAppJwt, installationToken, GithubAppError } from "../engine/githubApp.js";
import { openMetadataPr } from "../engine/githubPr.js";
import { handleMcp } from "../mcp/server.js";
import { sendBroadcastToList } from "../broadcast.js";
import { activeSubscribers, subscriberCounts, recordBroadcast } from "../d1.js";
import type { Env } from "../index.js";

// ── token + cookie lifetimes ───────────────────────────────────────────────────
/** Magic-link is short-lived (single use, clicked within minutes). */
const MAGIC_LINK_TTL_SECONDS = 15 * 60; // 15 min
/** Session cookie is long-lived (stay signed-in). */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const JSON_HEADERS = { "content-type": "application/json" } as const;

/**
 * CORS for a credentialed (cookie-bearing) cross-origin dashboard. We must echo a
 * concrete origin — never "*" — when credentials are allowed, so we reflect the
 * request Origin (the dashboard). `DASHBOARD_ORIGIN`, when set, is preferred so a
 * no-Origin caller (curl/tests) still gets a sane, fixed value.
 */
function corsHeaders(origin: string | null, env?: Env): Record<string, string> {
  const allowOrigin = origin ?? env?.DASHBOARD_ORIGIN ?? "*";
  const headers: Record<string, string> = {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-user-email,stripe-signature,x-broadcast-token",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
  // Credentials can only be combined with a concrete origin, not "*".
  if (allowOrigin !== "*") headers["access-control-allow-credentials"] = "true";
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  env?: Env,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin, env), ...extra },
  });
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid or missing JSON body");
  }
}

// ── response shaping ───────────────────────────────────────────────────────────

/**
 * The public run view the dashboard renders. We hand back the engine's full
 * decision trace verbatim under `result` (the exact AgentResult shapes the
 * frontend + mock.js are built against): audit / ranks / competitors.changes /
 * reasoning / proposedCopy (with validation) / pushCommands.
 *
 * The approval gate is enforced here: pushCommands are only included once the
 * run has been approved (status 'approved', or a legacy 'shipped' row). Before that they are
 * withheld so a pre-approval client literally cannot read them.
 */
async function runView(env: Env, runId: string) {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  const approval = await getApproval(env.DB, runId);
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;

  const approved = run.status === "shipped" || run.status === "approved";

  return {
    id: run.id,
    app_id: run.app_id,
    status: run.status,
    created_at: run.created_at,
    approval: approval
      ? { decision: approval.decision, decided_at: approval.decided_at }
      : null,
    trigger: trace.trigger,
    result: serializeRunResult(trace, approved),
  };
}

/**
 * The run-page `result` block — the privacy boundary in code form (PRD 02). Pure
 * + network-free so the boundary (findings/summary/ascContext present; raw ASC
 * data ABSENT) is unit-testable. Returns ONLY curated copy + counts:
 *  - `findings` — the engine's sorted `Finding[]` (curated copy, safe).
 *  - `findingsSummary` — counts for the card header/badge.
 *  - `ascContext` — the slim PII-safe display context, when the run read ASC.
 * The raw `ascSnapshot` is never on the trace, so it can't leak here. The
 * approval gate still withholds `pushCommands` until the human approves.
 */
export function serializeRunResult(trace: ReasoningTrace, approved: boolean) {
  // Older traces (persisted before PRD 02) carry no findings — default to an
  // empty array so the response shape is always present and stable.
  const findings = trace.findings ?? [];
  return {
    audit: trace.audit,
    ranks: trace.ranks,
    competitors: trace.competitors,
    reasoning: trace.reasoning,
    currentCopy: trace.currentCopy,
    proposedCopy: trace.proposedCopy,
    // approval gate: commands withheld until the human approves.
    pushCommands: approved ? trace.pushCommands : [],
    // Findings + summary + slim context. Curated copy + counts only — never the
    // raw `ascSnapshot` (it was never written to the trace). The findings array
    // is sorted by the engine; summary feeds the card header.
    findings,
    findingsSummary: summarizeFindings(findings),
    // Locked-field upgrade surfaces (#61): the per-surface "unlock to see +
    // improve" data the no-key UI renders as inline 🔒 locks. Static capability/
    // opportunity copy only (no raw ASC) — the same privacy boundary as findings.
    // Present only when the trace carried them (older traces omit it; the UI then
    // falls back to isNoKeyRun) so the response shape stays stable + truthful.
    ...(trace.locks !== undefined ? { locks: trace.locks } : {}),
    ...(trace.ascContext !== undefined ? { ascContext: trace.ascContext } : {}),
    // Winnability opportunities (PRD 06) — "where to push next." Curated copy +
    // drivers only; safe to serve. Older traces have none → empty array.
    opportunities: trace.opportunities ?? [],
    // Keyword gaps (PRD 01) — names-only competitor attribution, no raw listing.
    // Served verbatim so the run page renders the "Keyword opportunities" card.
    ...(trace.keywordGaps !== undefined ? { keywordGaps: trace.keywordGaps } : {}),
    // Metadata coverage (PRD 03): budget-efficiency score + itemized waste. Curated
    // counts + copy only — the privacy boundary holds (no raw ASC pricing/locale/
    // policy ever rode the trace). Present once a run computed it; omitted otherwise.
    ...(trace.coverage !== undefined ? { coverage: trace.coverage } : {}),
    // PRD 04 localization expansion: ROI-sorted locale recommendations (static
    // heuristic, PII-safe). Present only when the Mode-A run computed them.
    ...(trace.localizationExpansion !== undefined
      ? { localizationExpansion: trace.localizationExpansion }
      : {}),
    // #182 Phase 3: the proposed outcome-led PPO treatment brief. Curated
    // recommendation copy + a cited public result — no raw ASC data. Present only
    // when a keyed run had no test running; omitted otherwise.
    ...(trace.ppoTreatment !== undefined ? { ppoTreatment: trace.ppoTreatment } : {}),
    // storefront-intel PRD 03: MEASURED language-level coverage for keyless runs
    // (source:"storefront"). Public data only — safe to serve. Keyed runs never
    // carry it (ASC's locale list is authoritative). Omitted when absent.
    ...(trace.languageCoverage !== undefined ? { languageCoverage: trace.languageCoverage } : {}),
    // PUBLIC category chart rank (analytics-reports PRD 04 map). Public data —
    // safe to serve. Absent when unknown/unread.
    ...(trace.chartRank !== undefined ? { chartRank: trace.chartRank } : {}),
    // #78 Phase 2: the locales whose drafts the human APPROVED for handoff.
    // Full copy included so the review lane can render/edit what's stored.
    ...(trace.localizedCopy !== undefined ? { localizedCopy: trace.localizedCopy } : {}),
    // PRD 03 / #95: PUBLIC review sentiment + observed topics. Sample size is
    // ALWAYS carried and the score is SUPPRESSED below threshold (#78). Public
    // data only — safe to serve. Older traces have none → field omitted.
    ...(trace.reviews !== undefined ? { reviews: trace.reviews } : {}),
  };
}

/**
 * PUBLIC review sentiment (#95) — best-effort. Fetches the app's public App Store
 * reviews (Apple's free RSS feed, keyed by the bundle's numeric track id), shapes
 * an honest sentiment read (sample size ALWAYS carried; score SUPPRESSED below
 * threshold — #78), and threads the review-derived keyword candidates onto the
 * existing keyword-gap list LABELED `source:'reviews'` so they're never confused
 * with measured search volume. Mutates `result` in place. NEVER throws and never
 * strands the run: an empty/failed fetch simply leaves `result.reviews` honest
 * (n=0, low confidence) and adds no candidates. Read-only public data — no push.
 */
async function attachReviews(env: Env, app: AppRow, result: AgentResult): Promise<void> {
  let reviews: Review[] = [];
  try {
    reviews = await fetchReviewsForBundle(fetchForEnv(env), app.bundle_id, {
      country: app.country?.toLowerCase() || "us",
      pages: 2,
    });
  } catch {
    reviews = []; // honest: a read limitation degrades to "no reviews", never an error.
  }
  result.reviews = await analyzeSentiment(reviews, reasonerForEnv(env.AI));
  // Bridge review vocabulary onto the keyword surface, labeled source:'reviews'.
  const candidates = reviewKeywordCandidates(reviews);
  if (candidates.length > 0) {
    result.keywordGaps = withReviewCandidates(result.keywordGaps ?? [], candidates);
  }
}

/**
 * Append the first-screenshot caption finding (#182 Phase 1). OCR of the primary
 * screenshot's headline via the Workers AI vision model, gated behind
 * CAPTION_OCR_ENABLED + an AI binding. When the flag is off, no binding exists,
 * there's no screenshot, or the model can't read a headline, this is a SILENT
 * no-op — result.findings is untouched. Best-effort and last, so a caption read
 * never strands a run. Call AFTER auditFindings has populated result.findings.
 */
async function attachCaptionFindings(env: Env, result: AgentResult): Promise<void> {
  const analyzer = captionAnalyzerForEnv(env, (url) => fetch(url));
  if (!analyzer) return;
  const analysis = await analyzeFirstShot(analyzer, result.audit.screenshots?.screenshotUrls);
  // #182: feature-led caption lens + #178 Phase 3: claim-compliance on the SAME
  // OCR'd caption (unverifiable / price claims baked into the screenshot art).
  const extra = [...captionFindings(analysis), ...screenshotClaimFindings(analysis?.caption)];
  if (extra.length > 0) result.findings = [...(result.findings ?? []), ...extra];
}

/**
 * Attach the PUBLIC category chart rank (analytics-reports PRD 04 map). Best-
 * effort and keyless: reads the app's primary-genre chart from the free RSS feed
 * and locates the app. Absent trackId/genre or an unreadable feed leaves
 * `chartRank` undefined (unknown) — never a false "not charting".
 */
async function attachChartRank(env: Env, app: AppRow, result: AgentResult): Promise<void> {
  const { trackId, primaryGenreId, primaryGenreName } = result.audit;
  if (!trackId || !primaryGenreId) return;
  const cr = await fetchChartRank(fetchForEnv(env), {
    appId: trackId,
    genreId: primaryGenreId,
    ...(primaryGenreName !== undefined ? { genreName: primaryGenreName } : {}),
    country: app.country?.toLowerCase() || "us",
  });
  if (cr) result.chartRank = cr;
}

/**
 * Compute the metadata coverage report (PRD 03) for a run from its CURRENT copy.
 * The brand word is the first token of the live/app name — used to flag a brand
 * repeat in the subtitle (#42) and to keep the brand out of the term analysis.
 * Pure derivation off copy we already hold; reads no new ASC data.
 */
function coverageForRun(
  currentCopy: { name?: string | undefined; subtitle?: string | undefined; keywords?: string | undefined },
  appName: string,
): ReturnType<typeof metadataCoverage> {
  const brand = (currentCopy.name ?? appName).trim().split(/\s+/)[0] ?? "";
  return metadataCoverage(
    {
      name: currentCopy.name,
      subtitle: currentCopy.subtitle,
      keywords: currentCopy.keywords,
    },
    brand ? { brand } : {},
  );
}

/** Lead rank + top-10 count + tracked count from a stored run's rank trace. */
function rankSummary(
  ranks: Array<{ keyword: string; rank: number | null }>,
): { lead_keyword: string; lead_rank: number | null; top10: number; tracked: number } | null {
  if (!ranks.length) return null;
  const ranked = ranks.filter((r) => r.rank != null) as Array<{ keyword: string; rank: number }>;
  const lead = ranked.length
    ? ranked.reduce((a, b) => (a.rank <= b.rank ? a : b))
    : null;
  return {
    lead_keyword: lead ? lead.keyword : (ranks[0]?.keyword ?? ""),
    lead_rank: lead ? lead.rank : null,
    top10: ranked.filter((r) => r.rank <= 10).length,
    tracked: ranks.length,
  };
}

/**
 * Compute the winnability opportunities (PRD 06) for a finished run. Pure-engine
 * call: feeds the keyword scores from the run's `reasoning` and the rank history
 * (prior snapshots + this pass, so momentum reads correctly). No competitor rank
 * data is wired yet — `rankOpportunities` degrades gracefully (competitorWeakness
 * defaults to "open field"), keeping the run honest about what it doesn't know.
 * Mutates `result.opportunities` so it rides onto the persisted trace.
 */
async function attachOpportunities(
  env: Env,
  appId: string,
  result: AgentResult,
): Promise<void> {
  // Prior snapshots give momentum; the run's current ranks are appended as the
  // latest snapshot (history may not yet include this pass at compute time).
  // Opportunities are scored from MEASURED rank signals only — no fabricated
  // per-keyword volume/difficulty is threaded in anymore (#65).
  const checkedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const prior = await getRankHistory(env.DB, appId, {});
  // #73: opportunities = "where to push NEXT", so only keywords the run currently
  // TARGETS may appear. Prior history is for MOMENTUM on those keywords — it must
  // NOT resurrect keywords we've since dropped (e.g. pre-#57 'manager'/'mangia'
  // tombstoned in old snapshots). Restrict the keyword universe to this run's
  // target set; history only contributes momentum for keywords still targeted.
  const targeted = new Set(result.ranks.map((r) => r.keyword));
  const ranks = [
    ...prior
      .filter((r) => targeted.has(r.keyword))
      .map((r) => ({ keyword: r.keyword, rank: r.rank, total: r.total, checked_at: r.checked_at })),
    ...result.ranks.map((r) => ({ keyword: r.keyword, rank: r.rank, total: r.total, checked_at: checkedAt })),
  ];

  result.opportunities = rankOpportunities({ ranks });
}

// ── auth ─────────────────────────────────────────────────────────────────────

/** The signing secret for this env (dev fallback in demo, required otherwise). */
function sessionSecret(env: Env): string {
  return resolveSessionSecret(env.SESSION_SECRET, env.APP_ENV);
}

/**
 * Identify the request's user. Precedence:
 *   1. a valid signed session cookie (the real auth path), else
 *   2. an `Authorization: Bearer <session-token>` header — the SAME signed
 *      session token, just carried in a header instead of a cookie. This is how
 *      non-browser clients (the MCP server, #93) authenticate, since they can't
 *      send cookies. Fail-closed: an invalid bearer falls through, never grants.
 *   3. the X-User-Email header — ONLY in APP_ENV==="demo" (keeps the live demo +
 *      existing tests working), else
 *   4. 401.
 * In every valid path the email get-or-creates the `users` row.
 */
async function requireUser(req: Request, env: Env): Promise<{ id: string; email: string }> {
  // (1) session cookie
  const jar = parseCookie(req.headers.get("Cookie"));
  const token = jar[SESSION_COOKIE];
  if (token) {
    const res = await verifySessionToken(sessionSecret(env), token);
    if (res.ok) {
      const user = await upsertUser(env.DB, res.email);
      return { id: user.id, email: user.email };
    }
  }

  // (2) Authorization: Bearer <token> — the cookieless path for MCP/API clients.
  // Two accepted shapes, both fail-closed:
  //   • a scoped `shipaso_…` API key (agent access, #93) — verified by HASH
  //     lookup, resolves the owning user; a key can only reach read/draft tools.
  //   • the signed session token itself (mobile/Bearer) — verified as-is.
  const authz = req.headers.get("Authorization");
  if (authz && /^Bearer\s+/i.test(authz)) {
    const bearer = authz.replace(/^Bearer\s+/i, "").trim();
    if (bearer) {
      if (looksLikeApiKey(bearer)) {
        const owner = await resolveApiKey(env.DB, bearer);
        if (owner) return owner;
      } else {
        const res = await verifySessionToken(sessionSecret(env), bearer);
        if (res.ok) {
          const user = await upsertUser(env.DB, res.email);
          return { id: user.id, email: user.email };
        }
      }
    }
  }

  // (3) demo-only header fallback
  if (env.APP_ENV === "demo") {
    const email = req.headers.get("x-user-email")?.trim().toLowerCase();
    if (email && email.includes("@")) {
      const user = await upsertUser(env.DB, email);
      return { id: user.id, email: user.email };
    }
  }

  throw new HttpError(401, "authentication required");
}

/**
 * The email sender is selected by `emailSenderForEnv` (shared with the cron's
 * weekly digest) — Resend when configured, else the console logger.
 */

/**
 * Cookie scope for this env. With COOKIE_DOMAIN set (split app/api subdomains),
 * the session cookie is shared across `.shipaso.com` and uses SameSite=None so it
 * rides cross-site fetches from the dashboard. Unset → host-only, SameSite=Lax.
 */
function cookieOpts(env: Env): { sameSite: "Lax" | "None"; domain?: string } {
  return env.COOKIE_DOMAIN
    ? { sameSite: "None", domain: env.COOKIE_DOMAIN }
    : { sameSite: "Lax" };
}

/** Base URL for building the magic-link callback (dashboard origin or request). */
function authBaseUrl(req: Request, env: Env): string {
  if (env.DASHBOARD_ORIGIN) return env.DASHBOARD_ORIGIN.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

/**
 * POST /auth/request {email} — mint + "send" a magic link. We ALWAYS answer 200
 * {sent:true} regardless of whether the email is known, so we never leak account
 * existence. A malformed email is also treated as "sent" (no enumeration).
 */
/**
 * Build the URL the magic-link email points at. Default (MAGIC_LINK_BASE unset):
 * the worker's own `/auth/callback` — today's web-only flow, byte-for-byte. When
 * MAGIC_LINK_BASE is set to the web/Pages origin, the link becomes a UNIVERSAL
 * LINK to `/auth/m?token=…` that opens the mobile app on a device that has it and
 * falls back to the cookie flow for web. Pure + exported so it's unit-tested
 * directly (no email side effects).
 */
export function buildMagicLink(env: Env, requestOrigin: string, token: string): string {
  const t = encodeURIComponent(token);
  const linkBase = env.MAGIC_LINK_BASE?.replace(/\/+$/, "");
  return linkBase ? `${linkBase}/auth/m?token=${t}` : `${requestOrigin}/auth/callback?token=${t}`;
}

async function authRequest(req: Request, env: Env): Promise<unknown> {
  const body = await readJson<{ email?: string }>(req);
  const email = body.email?.trim().toLowerCase();
  if (email && email.includes("@")) {
    const token = await mintMagicToken(sessionSecret(env), email, {
      ttlSeconds: MAGIC_LINK_TTL_SECONDS,
    });
    const link = buildMagicLink(env, new URL(req.url).origin, token);
    // Delivery failure must NOT change the response (no account enumeration, no
    // leaking vendor errors). Log server-side and still answer {sent:true}.
    try {
      await emailSenderForEnv(env).sendMagicLink(email, link);
    } catch (e) {
      console.error(`[store-ops auth] magic-link send failed for ${email}: ${String(e)}`);
    }
  }
  return { sent: true };
}

/**
 * GET /auth/callback?token=… — verify the magic link, upsert the user, set the
 * session cookie. Redirects to the dashboard (302) so the browser lands signed
 * in; an Accept: application/json caller gets a 200 body instead.
 */
async function authCallback(req: Request, env: Env, origin: string | null): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const res = await verifyMagicToken(sessionSecret(env), token);
  if (!res.ok) {
    return json({ error: "invalid or expired link" }, 400, origin, env);
  }
  await upsertUser(env.DB, res.email);
  const session = await mintSessionToken(sessionSecret(env), res.email, {
    ttlSeconds: SESSION_TTL_SECONDS,
  });
  const cookie = serializeSessionCookie(session, {
    maxAgeSeconds: SESSION_TTL_SECONDS,
    ...cookieOpts(env),
  });

  // Browser navigation → redirect home, signed in. JSON client → 200 body.
  const wantsJson = (req.headers.get("Accept") ?? "").includes("application/json");
  if (wantsJson) {
    return json({ ok: true, email: res.email }, 200, origin, env, { "set-cookie": cookie });
  }
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders(origin, env),
      "set-cookie": cookie,
      location: `${authBaseUrl(req, env)}/dashboard`,
    },
  });
}

/**
 * POST /auth/exchange { token } — the MOBILE counterpart to /auth/callback.
 *
 * A native app can't carry a session cookie, but `requireUser` already accepts
 * `Authorization: Bearer <session-token>`. So instead of setting a cookie and
 * redirecting (what the browser flow needs), the app posts its magic-link token
 * here and gets the freshly-minted session token back in the JSON BODY, which it
 * stores in the device keychain (expo-secure-store) and sends as a Bearer header.
 *
 * Reuses the exact same magic-link crypto + session minting as the cookie path —
 * the ONLY difference is delivery (body vs Set-Cookie). No cookie is set here.
 * Public route (the magic token IS the credential), same 400 on a bad/expired
 * link so we never reveal whether an email exists.
 */
async function authExchange(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get("Origin");
  const body = await readJson<{ token?: string }>(req);
  const token = typeof body.token === "string" ? body.token : "";
  const res = await verifyMagicToken(sessionSecret(env), token);
  if (!res.ok) {
    return json({ error: "invalid or expired link" }, 400, origin, env);
  }
  await upsertUser(env.DB, res.email);
  const session = await mintSessionToken(sessionSecret(env), res.email, {
    ttlSeconds: SESSION_TTL_SECONDS,
  });
  // Token in the body — NOT a cookie. The app stores it in SecureStore and sends
  // it as `Authorization: Bearer` on every call (the requireUser Bearer path).
  return json({ token: session, email: res.email }, 200, origin, env);
}

// ── Digest unsubscribe (comms-prefs Phase 2) — public, token-authenticated ────
//
// GET renders a CONFIRMATION page and never mutates: mail scanners and link
// prefetchers follow GET links, and a mutating GET would silently unsubscribe
// real users. POST does the flip — both the confirm-form POST and the RFC 8058
// one-click POST (`List-Unsubscribe=One-Click`) are form-encoded, so these
// handlers take the token from the QUERY STRING ONLY and never call readJson.
// Responses are HTML pages (not the json() helper). The flip is NON-creating
// (a deleted account gets the same success page; no row is resurrected).

/** Minimal HTML page response — inline styles, no cookies, no external assets. */
function htmlPage(title: string, bodyHtml: string, status = 200): Response {
  const doc =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtmlText(title)}</title></head>` +
    `<body style="margin:0;background:#07090e;color:#eef1f7;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif">` +
    `<div style="max-width:520px;margin:12vh auto 0;padding:0 20px">` +
    `<div style="font-weight:700;letter-spacing:.4px;color:#34d399;margin-bottom:18px">ShipASO</div>` +
    bodyHtml +
    `</div></body></html>`;
  return new Response(doc, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** HTML-escape for interpolating the (verified) email into the pages. */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const UNSUB_BAD_BODY =
  `<h1 style="font-size:22px;margin:0 0 10px">This link isn't valid anymore</h1>` +
  `<p style="color:#97a1b6">The unsubscribe link is invalid or has expired. ` +
  `A fresh one is at the bottom of every weekly digest, or manage emails in your dashboard settings.</p>`;

/** GET /email/unsubscribe?token=… — confirm page. NEVER mutates. */
async function unsubscribeGetRoute(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const res = await verifyUnsubToken(sessionSecret(env), token);
  if (!res.ok) return htmlPage("Unsubscribe", UNSUB_BAD_BODY, 400);
  const email = escapeHtmlText(res.email);
  return htmlPage(
    "Stop the weekly digest?",
    `<h1 style="font-size:22px;margin:0 0 10px">Stop the weekly digest?</h1>` +
      `<p style="color:#97a1b6">This turns off the weekly digest email for <strong style="color:#eef1f7">${email}</strong> — ` +
      `every app on the account. ShipASO keeps working either way: runs still open in your dashboard.</p>` +
      `<form method="post" action="${escapeHtmlText(url.pathname + url.search)}">` +
      `<button type="submit" style="background:#34d399;color:#07090e;border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer">Stop the weekly digest</button>` +
      `</form>`,
  );
}

/** POST /email/unsubscribe?token=… — the flip. Idempotent; form-encoded body ignored. */
async function unsubscribePostRoute(req: Request, env: Env): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const res = await verifyUnsubToken(sessionSecret(env), token);
  if (!res.ok) return htmlPage("Unsubscribe", UNSUB_BAD_BODY, 400);
  // Non-creating flip: a deleted account matches zero rows and gets the same
  // page — nothing to leak, nothing resurrected. Repeat POSTs are no-ops.
  await setEmailDigestByEmail(env.DB, res.email, "off");
  const email = escapeHtmlText(res.email);
  return htmlPage(
    "Weekly digest off",
    `<h1 style="font-size:22px;margin:0 0 10px">Weekly digest off</h1>` +
      `<p style="color:#97a1b6">No more weekly digest emails for <strong style="color:#eef1f7">${email}</strong>. ` +
      `ShipASO keeps working — runs still open in your dashboard, and you can turn the digest back on any time in Settings.</p>`,
  );
}

/** GET /list/unsubscribe?token=… — confirm page. NEVER mutates. */
async function listUnsubGetRoute(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const res = await verifyListUnsubToken(sessionSecret(env), token);
  if (!res.ok) return htmlPage("Unsubscribe", UNSUB_BAD_BODY, 400);
  const email = escapeHtmlText(res.email);
  return htmlPage(
    "Unsubscribe from ShipASO updates?",
    `<h1 style="font-size:22px;margin:0 0 10px">Unsubscribe?</h1>` +
      `<p style="color:#97a1b6">This stops launch + product update emails to <strong style="color:#eef1f7">${email}</strong>.</p>` +
      `<form method="post" action="${escapeHtmlText(url.pathname + url.search)}">` +
      `<button type="submit" style="background:#34d399;color:#07090e;border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer">Unsubscribe</button>` +
      `</form>`,
  );
}

/** POST /list/unsubscribe?token=… — the flip. Idempotent; form-encoded body ignored. */
async function listUnsubPostRoute(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const res = await verifyListUnsubToken(sessionSecret(env), token);
  if (!res.ok) return htmlPage("Unsubscribe", UNSUB_BAD_BODY, 400);
  await unsubscribeSubscriber(env.DB, res.email);
  return htmlPage("Unsubscribed", `<h1 style="font-size:22px;margin:0 0 10px">You're unsubscribed.</h1><p style="color:#97a1b6">You won't get further ShipASO update emails.</p>`, 200);
}

// ── Broadcast (owner-gated launch/newsletter send to the subscriber list) ────
//
// A single shared secret (`x-broadcast-token` header vs env.BROADCAST_TOKEN)
// gates all three routes — no admin-role system, so the secret IS the gate;
// unset means nobody can call it (degrades CLOSED, same pattern as the RLHF
// export gate above). /broadcast/send returns immediately with the queued
// count; the actual chunked send runs in ctx.waitUntil so the owner's request
// doesn't hang on hundreds of emails (falls back to an inline await when no
// ExecutionContext is available, e.g. some test paths).

function requireBroadcastToken(req: Request, env: Env): boolean {
  const token = env.BROADCAST_TOKEN;
  return !!token && req.headers.get("x-broadcast-token") === token;
}

function broadcastBaseUrl(env: Env): string {
  // /list/unsubscribe is a WORKER route (served at api.shipaso.com), not the
  // SPA (app.shipaso.com) — must use API_ORIGIN, not DASHBOARD_ORIGIN.
  return (env.API_ORIGIN ?? "https://api.shipaso.com").replace(/\/+$/, "");
}

async function broadcastSubscribersRoute(req: Request, env: Env, origin: string | null): Promise<Response> {
  if (!requireBroadcastToken(req, env)) return json({ error: "forbidden" }, 403, origin, env);
  return json(await subscriberCounts(env.DB), 200, origin, env);
}

async function broadcastTestRoute(req: Request, env: Env, origin: string | null): Promise<Response> {
  if (!requireBroadcastToken(req, env)) return json({ error: "forbidden" }, 403, origin, env);
  const body = await readJson<{ subject?: string; markdown?: string; to?: string }>(req);
  const subject = (body.subject ?? "").trim();
  const markdown = (body.markdown ?? "").trim();
  const to = (body.to ?? "").trim();
  if (!subject || !markdown || !looksLikeEmail(to)) throw new HttpError(400, "subject, markdown, and a valid `to` are required");
  await sendBroadcastToList({ env, subject, markdown, recipients: [{ email: to }], baseUrl: broadcastBaseUrl(env) });
  return json({ ok: true }, 200, origin, env);
}

async function broadcastSendRoute(req: Request, env: Env, origin: string | null, ctx?: ExecutionContext): Promise<Response> {
  if (!requireBroadcastToken(req, env)) return json({ error: "forbidden" }, 403, origin, env);
  const body = await readJson<{ subject?: string; markdown?: string; confirm?: boolean }>(req);
  const subject = (body.subject ?? "").trim();
  const markdown = (body.markdown ?? "").trim();
  if (!subject || !markdown) throw new HttpError(400, "subject and markdown are required");
  if (body.confirm !== true) throw new HttpError(400, "confirm must be true to send to the list");

  const recipients = await activeSubscribers(env.DB);
  await recordBroadcast(env.DB, { subject, recipientCount: recipients.length, sender: "owner" });

  const work = sendBroadcastToList({ env, subject, markdown, recipients, baseUrl: broadcastBaseUrl(env) });
  if (ctx) ctx.waitUntil(work);
  else await work; // no ctx (e.g. some test paths) → send inline
  return json({ ok: true, queued: recipients.length }, 200, origin, env);
}

/** POST /auth/logout — clear the session cookie (same scope it was set with). */
function authLogout(origin: string | null, env: Env): Response {
  return json({ ok: true }, 200, origin, env, {
    "set-cookie": serializeLogoutCookie(cookieOpts(env)),
  });
}

/**
 * GET /auth/me — who is the caller, and HOW are they authed? The dashboard polls
 * this on boot to decide between the logged-in app and the login screen.
 *   { authed:true,  via:"session", email }  → a real signed-in session
 *   { authed:true,  via:"demo",    email }  → the X-User-Email stub (demo only)
 *   { authed:false }                         → show the login screen
 * Always 200 (the body carries the state) so it's a simple client check.
 */
async function authMe(req: Request, env: Env, origin: string | null): Promise<Response> {
  // The session token may arrive as a cookie (web) OR an Authorization: Bearer
  // header (mobile — the same signed token, carried in a header). Mobile boots
  // via this route, so it must recognize the Bearer token, exactly like the
  // requireUser path does.
  const jar = parseCookie(req.headers.get("Cookie"));
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = /^Bearer\s+/i.test(authz) ? authz.replace(/^Bearer\s+/i, "").trim() : "";
  const token = jar[SESSION_COOKIE] || bearer;
  if (token) {
    const res = await verifySessionToken(sessionSecret(env), token);
    if (res.ok) {
      // Resolve the user (idempotent upsert) so the boot check carries the
      // per-user pause flag (#51 — the banner renders "active" vs "paused") AND
      // the RLHF opt-out (#39 Part 2 — the settings toggle), no extra round-trip.
      const user = await upsertUser(env.DB, res.email);
      return json(
        {
          authed: true,
          via: "session",
          email: user.email,
          paused: user.agent_paused,
          rlhf_opt_out: user.rlhf_opt_out === 1,
          rank_cadence: user.rank_cadence,
          email_digest: user.email_digest,
          push_run_ready: user.push_run_ready,
        },
        200,
        origin,
        env,
      );
    }
  }
  if (env.APP_ENV === "demo") {
    const email = req.headers.get("x-user-email")?.trim().toLowerCase();
    if (email && email.includes("@")) {
      const user = await upsertUser(env.DB, email);
      return json(
        {
          authed: true,
          via: "demo",
          email,
          paused: user.agent_paused,
          rlhf_opt_out: user.rlhf_opt_out === 1,
          rank_cadence: user.rank_cadence,
          email_digest: user.email_digest,
          push_run_ready: user.push_run_ready,
        },
        200,
        origin,
        env,
      );
    }
  }
  return json({ authed: false }, 200, origin, env);
}

/**
 * POST /account/rlhf-optout {optOut:boolean} — flip this user's RLHF capture
 * opt-out (#39 Part 2). Capture is ON by default; opting out means NO further
 * `proposal_edits` rows are written for this user (honored at write time). Returns
 * the new state. requireUser-gated (the caller decides for their own account).
 */
async function rlhfOptOutRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<{ optOut?: unknown }>(req);
  if (typeof body.optOut !== "boolean") {
    throw new HttpError(400, "optOut must be a boolean");
  }
  await setOptOut(env.DB, { userId, optOut: body.optOut });
  return { rlhf_opt_out: body.optOut };
}

/**
 * POST /account/rank-cadence {cadence:'daily'|'weekly'} — set how often the cron
 * snapshots this user's ranks (#94). 'weekly' (the default) records ranks during
 * the Monday autonomous sweep only; 'daily' adds the lightweight daily snapshot
 * WITHOUT changing the autonomous draft cadence (still weekly/threshold-governed).
 * Returns the new state. requireUser-gated (the caller decides for their own
 * account); a value outside the enum is rejected 400 (never silently coerced).
 */
async function rankCadenceRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<{ cadence?: unknown }>(req);
  if (body.cadence !== "daily" && body.cadence !== "weekly") {
    throw new HttpError(400, "cadence must be 'daily' or 'weekly'");
  }
  await setRankCadence(env.DB, { userId, cadence: body.cadence });
  return { rank_cadence: body.cadence };
}

/**
 * GET/POST /account/notifications — the communication prefs (comms-prefs Phase 1).
 * GET returns the current state; POST is a PARTIAL update (only the provided
 * fields change; invalid values → 400, never silently coerced) and returns the
 * full new state. Changing a pref changes what we SEND, never what the agent
 * does — the sweep/runs are untouched.
 */
async function notificationsGetRoute(env: Env, userId: string): Promise<unknown> {
  return getNotificationPrefs(env.DB, userId);
}

async function notificationsPostRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<{ email_digest?: unknown; push_run_ready?: unknown }>(req);
  const patch: { email_digest?: "weekly" | "off"; push_run_ready?: boolean } = {};
  if (body.email_digest !== undefined) {
    if (body.email_digest !== "weekly" && body.email_digest !== "off") {
      throw new HttpError(400, "email_digest must be 'weekly' or 'off'");
    }
    patch.email_digest = body.email_digest;
  }
  if (body.push_run_ready !== undefined) {
    if (typeof body.push_run_ready !== "boolean") {
      throw new HttpError(400, "push_run_ready must be a boolean");
    }
    patch.push_run_ready = body.push_run_ready;
  }
  if (patch.email_digest === undefined && patch.push_run_ready === undefined) {
    throw new HttpError(400, "provide email_digest and/or push_run_ready");
  }
  await setNotificationPrefs(env.DB, { userId, ...patch });
  return getNotificationPrefs(env.DB, userId);
}

/**
 * DELETE /account/push-token { token } — unregister THIS user's device (the
 * sign-out path). Deletes only a row the caller owns; someone else's token or
 * an already-gone one answers { removed:false } with 200 — sign-out must be
 * idempotent and can never unregister another user's device. A malformed token
 * is a 400 (nothing to look up).
 */
async function pushTokenDeleteRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<{ token?: unknown }>(req);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!isExpoPushToken(token)) {
    throw new HttpError(400, "a valid Expo push token is required");
  }
  const removed = await deleteDeviceTokenForUser(env.DB, userId, token);
  return { removed };
}

/**
 * POST /account/push-token { token, platform? } — register this device's Expo
 * push token so the cron can notify the owner when a run opens while they're away
 * (mobile, Phase 5). requireUser-gated; idempotent (re-registering the same token
 * just re-points it at this user). A malformed token is rejected 400 rather than
 * stored, so we never queue an unsendable notification.
 *
 * Known tradeoff (accepted): re-registration re-points an EXISTING token at the
 * caller — required so a device that switches accounts follows the new login.
 * A caller who somehow learned another user's push token could therefore
 * redirect that device's notifications to their own runs. Expo push tokens are
 * opaque, per-install, and never exposed by our API, so exploiting this needs a
 * token leak from the victim's device; the blast radius is mis-addressed
 * notifications (no data access). Revisit with a signed device attestation if
 * tokens ever become discoverable.
 */
async function pushTokenRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<{ token?: unknown; platform?: unknown }>(req);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!isExpoPushToken(token)) {
    throw new HttpError(400, "a valid Expo push token is required");
  }
  const platform = body.platform === "android" ? "android" : "ios";
  await registerDeviceToken(env.DB, userId, token, platform);
  return { registered: true, platform };
}

/**
 * GET /admin/preference-data — OWNER-ONLY export of the RLHF dataset (#39 Part 2).
 * Decrypts every anonymous `proposal_edits` row → JSONL of
 * `{field, decision, edited, proposed, final, created_at}` (still NO user/app id).
 *
 * Degrades CLOSED:
 *   • RLHF_EXPORT_TOKEN unset OR header mismatch → 403 (no admin-role system, so
 *     the secret IS the gate; unset means nobody can call it).
 *   • RLHF_ENCRYPTION_KEY unset/invalid → 503 with an honest message (the rows are
 *     encrypted; without the key there is nothing to export). Never crashes.
 */
async function preferenceDataExport(req: Request, env: Env, origin: string | null): Promise<Response> {
  const token = env.RLHF_EXPORT_TOKEN;
  const presented = req.headers.get("x-rlhf-export");
  if (!token || presented !== token) {
    return json({ error: "forbidden" }, 403, origin, env);
  }
  const key = await rlhfKey(env);
  if (!key) {
    return json(
      { error: "RLHF_ENCRYPTION_KEY is not configured — encrypted rows cannot be exported" },
      503,
      origin,
      env,
    );
  }
  const { results } = await env.DB.prepare(
    "SELECT field, decision, edited, proposed_enc, final_enc, created_at FROM proposal_edits ORDER BY created_at, id",
  ).all<{
    field: string;
    decision: string;
    edited: number;
    proposed_enc: string;
    final_enc: string;
    created_at: string;
  }>();

  const lines: string[] = [];
  for (const r of results ?? []) {
    const proposed = await decryptField(key, r.proposed_enc);
    const final = await decryptField(key, r.final_enc);
    lines.push(
      JSON.stringify({
        field: r.field,
        decision: r.decision,
        edited: r.edited === 1,
        proposed,
        final,
        created_at: r.created_at,
      }),
    );
  }
  const headers = corsHeaders(origin, env);
  headers["content-type"] = "application/x-ndjson";
  return new Response(lines.length ? lines.join("\n") + "\n" : "", { status: 200, headers });
}

/** Load an app and assert it belongs to this user. */
async function requireOwnedApp(env: Env, appId: string, userId: string) {
  const app = await getApp(env.DB, appId);
  if (!app || app.user_id !== userId) throw new HttpError(404, "app not found");
  return app;
}

// ── route handlers ─────────────────────────────────────────────────────────────

type ConnectBody = {
  bundle_id?: string;
  /** Free-form: an app name, App Store / Play URL, numeric id, or bundle id. */
  query?: string;
  name?: string;
  country?: string;
} & RunOverrides;

/** Shape a candidate for the dashboard picker. */
function candidateView(c: AppCandidate) {
  return {
    bundle_id: c.bundleId,
    name: c.name,
    publisher: c.publisher,
    genres: c.genres,
    icon_url: c.iconUrl,
  };
}

/**
 * POST /resolve — turn whatever the user pasted (name / URL / id / bundle) into
 * connectable candidates, WITHOUT connecting. The dashboard calls this to power
 * the search box + picker, then POSTs the chosen bundle_id to /apps.
 */
async function resolveQuery(req: Request, env: Env): Promise<unknown> {
  const body = await readJson<{ query?: string; country?: string; offset?: number }>(req);
  const query = body.query?.trim();
  if (!query) throw new HttpError(400, "query is required");
  const country = body.country?.trim() || env.DEFAULT_COUNTRY || "US";
  const offset = normalizeOffset(body.offset);
  const res = await resolveAppQuery(fetchForEnv(env), query, { country, offset });
  return {
    kind: res.kind, // "resolved" | "candidates" | "not-found"
    query: res.query,
    candidates: res.candidates.map(candidateView),
    offset: res.offset,
    hasMore: res.hasMore,
  };
}

/** Clamp a client-supplied offset to a sane non-negative integer. */
function normalizeOffset(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 200); // iTunes caps search results around 200
}

/**
 * POST /preview — PUBLIC try-before-signup. Resolve a query to a single app,
 * run the read-only agent (audit + rank baseline), and return a teaser-safe
 * subset (grade, lead rank, top-10 count, sample) — NO DB write, no auth. The
 * payoff (optimized copy + push commands) is withheld until the visitor signs
 * up and connects the app. If the query is ambiguous, hand back the pick-list so
 * the client can re-POST a bundle_id, same as /apps.
 */
async function previewApp(req: Request, env: Env): Promise<unknown> {
  // The preview path leans on the public App Store (iTunes) API for resolve,
  // lookup, and rank checks. When that upstream is rate-limited or slow,
  // fetchJson exhausts its retries and throws ItunesError — which is NOT an
  // HttpError, so without this it fell through the router to a bare
  // 500 "internal error" on the acquisition surface. Translate it into an
  // honest, human 503 (our own HttpError 400/404s below still propagate as-is).
  try {
    return await runPreview(req, env);
  } catch (e) {
    if (e instanceof ItunesError) {
      throw new HttpError(503, "Couldn’t reach the App Store just now — please try again in a moment.");
    }
    throw e;
  }
}

async function runPreview(req: Request, env: Env): Promise<unknown> {
  const body = await readJson<{ query?: string; bundle_id?: string; country?: string; offset?: number }>(req);
  const country = body.country?.trim() || env.DEFAULT_COUNTRY || "US";

  let bundleId = body.bundle_id?.trim();
  let name = "";
  if (!bundleId) {
    const query = body.query?.trim();
    if (!query) throw new HttpError(400, "query or bundle_id is required");
    const offset = normalizeOffset(body.offset);
    const res = await resolveAppQuery(fetchForEnv(env), query, { country, offset });
    if (res.kind === "not-found") throw new HttpError(404, `no app found for "${query}"`);
    if (res.kind === "candidates") {
      return {
        needsChoice: true,
        query: res.query,
        candidates: res.candidates.map(candidateView),
        offset: res.offset,
        hasMore: res.hasMore,
      };
    }
    bundleId = res.candidates[0]?.bundleId;
    name = res.candidates[0]?.name ?? "";
    if (!bundleId) throw new HttpError(404, `no connectable app for "${query}"`);
  }

  // Always seed from the live listing's name + genres (same as connectApp), so a
  // bare bundle_id preview doesn't tokenize the bundle id into junk keywords.
  if (!name) {
    const live = await lookup(fetchForEnv(env), bundleId, { by: "bundleId", country });
    name = [live.name, live.genres].filter(Boolean).join(" ").trim() || bundleId;
  }

  // Build a throwaway app row (never persisted) just to drive the engine.
  const appRow = { id: "preview", user_id: "preview", bundle_id: bundleId, name, country } as AppRow;
  const reasoner = reasonerForEnv(env.AI);
  const input = await buildAppInput(appRow, reasoner ? { reasoner } : {}, {});
  const result = await runAgent(fetchForEnv(env), input);
  return { preview: buildPreview(result), bundleId, country };
}

/** A loose email shape check — not validation, just "looks like an address". */
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * POST /subscribe — public launch-list capture from the marketing landing.
 * Accepts an HTML form (application/x-www-form-urlencoded → 303 redirect back to
 * the dashboard/landing with ?subscribed=1) or JSON (→ 200 {ok}). Idempotent on
 * email; never reveals whether the address was already on the list.
 */
async function subscribe(req: Request, env: Env, origin: string | null): Promise<Response> {
  const ctype = req.headers.get("content-type") ?? "";
  const isForm = ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data");

  let email = "";
  if (isForm) {
    const form = await req.formData().catch(() => null);
    email = String(form?.get("email") ?? "").trim().toLowerCase();
  } else {
    const body = await req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    email = (body.email ?? "").trim().toLowerCase();
  }

  if (looksLikeEmail(email)) {
    await recordSubscriber(env.DB, email, "landing").catch((e) => {
      console.error(`[store-ops] subscribe failed for ${email}: ${String(e)}`);
    });
  }

  // Form submitters are browsers → redirect back so they see a confirmation.
  if (isForm) {
    const back = (env.DASHBOARD_ORIGIN ?? "https://shipaso.com").replace(/\/+$/, "");
    return new Response(null, { status: 303, headers: { location: `${back}/?subscribed=1` } });
  }
  return json({ ok: true }, 200, origin, env);
}

/**
 * GET /proof — anonymized aggregate proof for the landing ("real movement across
 * N apps"). Iterates every app's rank history, extracts wins, and returns ONLY
 * numbers (no app names, no emails). Public + safe to cache.
 */
async function proofStats(env: Env, origin: string | null): Promise<Response> {
  const apps = await listAllApps(env.DB);
  const winsByApp = await Promise.all(
    apps.map(async (a) => extractWins(await getRankHistory(env.DB, a.id))),
  );
  const agg = aggregateProof(winsByApp);
  return json(agg, 200, origin, env, { "cache-control": "public, max-age=3600" });
}

/**
 * GET /portfolio — the Scale "one glance" roll-up: every app with its grade,
 * lead rank, and pending-approval flag, plus the summary counts. Scale-tier
 * gated (it's the agency/multi-app view). Pure shaping is summarizePortfolio;
 * here we assemble the cards from each app's latest run.
 */
async function portfolioView(env: Env, userId: string): Promise<unknown> {
  const tier = await getTier(env.DB, userId);
  if (tier !== "scale") {
    throw new HttpError(402, "the portfolio view is a Scale feature — upgrade to Scale");
  }
  const rows = await listAppsForUser(env.DB, userId);
  const cards: AppCard[] = await Promise.all(
    rows.map(async (a) => {
      let grade: string | null = null;
      let leadKeyword: string | null = null;
      let leadRank: number | null = null;
      let pendingApproval = false;
      if (a.latest_run_id) {
        const run = await getRun(env.DB, a.latest_run_id);
        if (run) {
          pendingApproval = run.status === "awaiting_approval";
          const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
          grade = trace.audit?.screenshots?.grade ?? null;
          const summary = rankSummary(trace.ranks);
          if (summary) {
            leadKeyword = summary.lead_keyword || null;
            leadRank = summary.lead_rank;
          }
        }
      }
      return { appId: a.id, name: a.name, grade, leadKeyword, leadRank, pendingApproval };
    }),
  );
  return summarizePortfolio(cards);
}

/**
 * POST /runs/approve-all — approve every run currently at the gate across the
 * user's apps (a Scale ergonomic). planBulkApprove decides approvability
 * (strictly awaiting_approval); we recordApproval each, ownership already
 * guaranteed by only gathering the caller's own runs.
 */
async function approveAll(env: Env, userId: string): Promise<unknown> {
  const apps = await listAppsForUser(env.DB, userId);
  const refs: RunRef[] = [];
  for (const a of apps) {
    const runs = await listRunsForApp(env.DB, a.id);
    for (const r of runs) refs.push({ runId: r.id, appId: a.id, status: r.status });
  }
  const plan = planBulkApprove(refs);

  const approved: string[] = [];
  for (const runId of plan.approvable) {
    // Re-check no prior approval (defensive — a concurrent single-approve could
    // have landed between the plan and here).
    const existing = await getApproval(env.DB, runId);
    if (existing) continue;
    await recordApproval(env.DB, { runId, decision: "approved" });
    approved.push(runId);
  }
  return { approved, approvedCount: approved.length, skipped: plan.skipped };
}

/** POST /apps — connect + initial run. */
async function connectApp(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<ConnectBody>(req);
  const country = body.country?.trim() || env.DEFAULT_COUNTRY || "US";

  // Accept either an exact bundle_id (original contract) or a free-form `query`
  // (name / store URL / numeric id / bundle). A query that maps to >1 app comes
  // back as a 200 pick-list instead of connecting the wrong app.
  let bundleId = body.bundle_id?.trim();
  if (!bundleId) {
    const query = body.query?.trim();
    if (!query) throw new HttpError(400, "bundle_id or query is required");
    const res = await resolveAppQuery(fetchForEnv(env), query, { country });
    if (res.kind === "not-found") {
      throw new HttpError(404, `no app found for "${query}"`);
    }
    if (res.kind === "candidates") {
      // Ambiguous — hand back the choices; the client re-POSTs with a bundle_id.
      return {
        needsChoice: true,
        query: res.query,
        candidates: res.candidates.map(candidateView),
      };
    }
    bundleId = res.candidates[0]?.bundleId;
    if (!bundleId) throw new HttpError(404, `no connectable app for "${query}"`);
  }

  // Tier gate: enforce the per-tier connected-app limit BEFORE we resolve/create.
  // Re-connecting an app the user already owns is always allowed (no new slot).
  const tier = await getTier(env.DB, userId);
  const existingForBundle = (await listAppsForUser(env.DB, userId)).find(
    (a) => a.bundle_id === bundleId,
  );
  if (!existingForBundle) {
    const count = await countAppsForUser(env.DB, userId);
    const limit = appLimitForTier(tier);
    if (count >= limit) {
      throw new HttpError(
        402,
        `your ${tier} plan allows ${limit} connected app${limit === 1 ? "" : "s"}. ` +
          `Upgrade to connect more.`,
      );
    }
  }

  // Look up the live listing up front so we store the RICH name (e.g. "Heathen -
  // Secular Meditation" + its genres) — this is what the keyword seeder reads, so
  // a bare connect still yields a real keyword set, not just the brand word.
  const live = await lookup(fetchForEnv(env), bundleId, { by: "bundleId", country });
  const richName =
    body.name?.trim() ||
    [live.name, live.genres].filter(Boolean).join(" ").trim() ||
    bundleId;

  const app = await createApp(env.DB, {
    userId,
    bundleId,
    name: richName,
    country,
  });

  // Run an AUDIT-ONLY pass so the connected app immediately has real data
  // (screenshots, findings, rank baseline) — but NOT fabricated keyword targets
  // tokenized from the name (#77). A blind connect of "Clear Cost" must not
  // recommend "clear"/"cost"; real targets come on the user's first explicit run.
  const overrides: RunOverrides = { auditOnly: true };
  if (body.keywords) { overrides.keywords = body.keywords; delete overrides.auditOnly; }
  if (body.competitors) overrides.competitors = body.competitors;
  else {
    // #72: no explicit list → watch the app's CONFIRMED competitors (never
    // suggestions). Empty when none exist or the table hasn't migrated yet.
    const confirmed = await confirmedCompetitorKeys(env.DB, app.id);
    if (confirmed.length) overrides.competitors = confirmed;
  }
  if (body.baseCopy) overrides.baseCopy = body.baseCopy;

  const input = await buildAppInput(app, overrides, {});
  const result: AgentResult = await runAgent(fetchForEnv(env), input);
  const runId = await persistRun(env.DB, {
    appId: app.id,
    country: app.country,
    status: "awaiting_approval",
    result,
    trigger: { source: "connect", reasons: ["app connected — initial audit"] },
  });

  // The dashboard's connect form reads `id` (the app id) and then fires the
  // first on-demand run. We return the app id plus a little run context.
  return {
    id: app.id,
    runId,
    bundleId: app.bundle_id,
    name: app.name,
    country: app.country,
    liveName: result.audit.liveName,
    auditGrade: result.audit.screenshots?.grade ?? null,
  };
}

/** GET /apps — list with latest-run badge + a small rank summary per card. */
async function listApps(env: Env, userId: string): Promise<unknown> {
  const rows = await listAppsForUser(env.DB, userId);
  const apps = await Promise.all(
    rows.map(async (a) => {
      let latest_run: { id: string; status: string; created_at: string } | null = null;
      let rank_summary: ReturnType<typeof rankSummary> = null;
      let findings_summary: FindingsSummary | null = null;
      if (a.latest_run_id) {
        const run = await getRun(env.DB, a.latest_run_id);
        if (run) {
          latest_run = { id: run.id, status: run.status, created_at: run.created_at };
          const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
          rank_summary = rankSummary(trace.ranks);
          // Findings-only badge data (PRD 04). Present once the engine is wired
          // into the run path; absent on older traces (the card omits the badge).
          findings_summary = trace.findingsSummary ?? null;
        }
      }
      return {
        id: a.id,
        bundle_id: a.bundle_id,
        name: a.name,
        country: a.country,
        created_at: a.created_at,
        latest_run,
        rank_summary,
        findings_summary,
      };
    }),
  );
  return { apps };
}

/** POST /apps/:id/run — on-demand run (same path the cron uses). */
async function runApp(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const body = (await req
    .json()
    .catch(() => ({}))) as RunOverrides;

  const previous = await getLatestCompetitorMap(env.DB, appId);
  const overrides: RunOverrides = {};
  if (body.keywords) overrides.keywords = body.keywords;
  if (body.competitors) overrides.competitors = body.competitors;
  else {
    // #72: no explicit list → watch the app's CONFIRMED competitors (never
    // suggestions). Empty when none exist or the table hasn't migrated yet.
    const confirmed = await confirmedCompetitorKeys(env.DB, appId);
    if (confirmed.length) overrides.competitors = confirmed;
  }
  if (body.baseCopy) overrides.baseCopy = body.baseCopy;
  const runReasoner = reasonerForEnv(env.AI);
  if (runReasoner) overrides.reasoner = runReasoner;
  // A bare "run now" has no baseCopy, so the keyword reasoner would have no
  // description and would tokenize the name. Thread the prior run's stored
  // live description in as a reasoning-only hint (same as the cron sweep).
  if (!overrides.baseCopy?.description) {
    const priorTrace = (await latestRunTraceForApp(env.DB, appId))?.trace;
    const hint = descriptionFromTrace(priorTrace);
    if (hint) overrides.descriptionHint = hint;
  }

  const input = await buildAppInput(app, overrides, previous);
  const result = await runAgent(fetchForEnv(env), input);
  // PRD 03 / #95: PUBLIC review sentiment + topics + review-sourced keyword
  // candidates. Best-effort; computed BEFORE findings so the audit can surface
  // the reviews section. Never strands the run.
  await attachReviews(env, app, result);
  await attachChartRank(env, app, result);
  // No-key run: compute the thin (public-only) findings set + the `asc_unlock`
  // CTA. EVERY run carries findings, ASC or not (PRD 02). No snapshot ⇒ no
  // ascContext — only the ASC-read path has one.
  result.findings = auditFindings({
    audit: result.audit,
    ranks: result.ranks,
    appName: app.name,
    hasAscKey: false,
    ...(result.proposedCopy !== undefined ? { proposedCopy: result.proposedCopy } : {}),
    ...(result.reviews !== undefined ? { reviews: result.reviews } : {}),
    ...(result.audit.storefront !== undefined ? { storefront: result.audit.storefront } : {}),
    ...(result.chartRank !== undefined ? { chartRank: result.chartRank } : {}),
  });
  // #182: measured first-screenshot caption lens (Workers AI vision, flag-gated).
  await attachCaptionFindings(env, result);
  // #61: the per-surface "unlock to see + improve" locks. On a no-key run this is
  // the canonical blind-spot list (subtitle, keywords, screenshots, …); the UI
  // renders each as an honest inline 🔒. Static copy only — no ASC data crosses.
  result.locks = surfaceLocks({
    audit: result.audit,
    ranks: result.ranks,
    appName: app.name,
    hasAscKey: false,
  });
  // PRD 06: winnability opportunities — "where to push next." Computed from the
  // run's keyword scores + rank history; no raw ASC data (safe to serve).
  await attachOpportunities(env, app.id, result);
  // PRD 03: metadata coverage off the current copy (here typically just the live
  // name — subtitle/keywords aren't read without a key, so they stay empty). Still
  // a useful name-budget read; richer once an ASC run fills the other fields.
  result.coverage = coverageForRun(result.currentCopy, app.name);
  // storefront-intel PRD 03: measured localization coverage for this keyless run,
  // from the public page's language list. Language-level; the keyed path (which
  // has ASC's authoritative locale list) never reaches here.
  const languages = result.audit.storefront?.languages;
  if (languages && languages.length > 0) {
    const category = result.audit.storefront?.category;
    const { recommendations, coverage } = recommendLocalesFromLanguages({
      languages,
      ...(category !== undefined ? { category } : {}),
    });
    result.languageCoverage = coverage;
    if (recommendations.length > 0) result.localizationExpansion = recommendations;
  }
  const runId = await persistRun(env.DB, {
    appId: app.id,
    country: app.country,
    status: "awaiting_approval",
    result,
    trigger: { source: "manual", reasons: ["manual run requested"] },
  });

  // The dashboard reads `id` and navigates to #/runs/:id.
  return { id: runId, status: "awaiting_approval", digest: result.competitors.digest };
}

type RunAscBody = RunOverrides & { p8?: string; keyId?: string; issuerId?: string; locale?: string };

/**
 * POST /apps/:id/run-asc — a run that READS the live subtitle/keywords from App
 * Store Connect first, so the optimizer IMPROVES them instead of omitting them
 * (the #30 Mode-A path). The user's `.p8` + key/issuer id arrive in THIS request,
 * are used to mint a short-lived JWT and read the localization, and are NEVER
 * persisted — same ephemeral-credential posture as /asc/verify and /asc/push.
 * Without this route, a normal run stays honest-but-conservative (iTunes-only,
 * subtitle/keywords untouched).
 */
async function runAppWithAsc(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const body = (await req.json().catch(() => ({}))) as RunAscBody & { store?: boolean; useStored?: boolean };
  const locale = body.locale?.trim() || "en-US";

  // #67: a run may authenticate with a STORED credential (opt-in, envelope-
  // encrypted) instead of in-request creds. `useStored` (or simply omitting the
  // creds when one exists) decrypts the saved key for this single use — the
  // plaintext is a transient here, never returned.
  const cred = await ascCredForRequest(env, userId, appId, body);

  // Mint the ephemeral ASC token + read the current live copy.
  let token: string;
  try {
    token = await mintAscJwt({ p8: cred.p8, keyId: cred.keyId, issuerId: cred.issuerId });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }

  // #67 opt-in: persist the credential (envelope-encrypted) AFTER it minted a
  // token successfully — we never store a key that doesn't work. Best-effort;
  // a storage failure never fails the run the user asked for.
  if (body.store && body.p8 && credentialsEnabled(env)) {
    await saveCredential(env, {
      userId,
      appId,
      kind: "asc",
      keyId: cred.keyId,
      issuerId: cred.issuerId,
      plaintext: cred.p8,
    }).catch(() => undefined);
  }
  const { result, resultWithSnapshot } = await keyedAscPass(env, app, token, locale, {
    ...(body.keywords ? { keywords: body.keywords } : {}),
    ...(body.competitors ? { competitors: body.competitors } : {}),
    ...(body.baseCopy ? { baseCopy: body.baseCopy } : {}),
  });

  const runId = await persistRun(env.DB, {
    appId: app.id,
    country: app.country,
    status: "awaiting_approval",
    result: resultWithSnapshot,
    trigger: { source: "manual", reasons: ["manual run requested (App Store Connect read)"] },
  });
  return { id: runId, status: "awaiting_approval", digest: result.competitors.digest, ascRead: true };
}

/**
 * The keyed (Mode-A) agent pass: read the live ASC listing with `token`, run the
 * agent against the live copy as the floor, and ENRICH the result with the full
 * findings/locks/context/coverage/localization set. Shared by the manual
 * `/run-asc` route and the AUTONOMOUS keyed sweep (#67 Phase 2) so a scheduled
 * run produces the exact same rich, honest output a manual keyed run does.
 *
 * `result` is the client-facing result; `resultWithSnapshot` carries the raw ASC
 * snapshot SERVER-SIDE only (persistRun never copies it onto the client trace).
 * A read failure throws `AscWriteError` (callers translate to their own error).
 */
export async function keyedAscPass(
  env: Env,
  app: AppRow,
  token: string,
  locale: string,
  extra: Pick<RunOverrides, "keywords" | "competitors" | "baseCopy"> = {},
): Promise<{ result: AgentResult; resultWithSnapshot: AgentResult }> {
  let liveSubtitle: string | undefined;
  let liveKeywords: string | undefined;
  let liveName: string | undefined;
  let liveDescription: string | undefined;
  let ascSnapshot: AscSnapshot | undefined;
  const ascAppId = await findAscAppId(fetch, token, app.bundle_id);
  const live = await readAscLocalization(fetch, { token, appId: ascAppId, locale });
  liveSubtitle = live.subtitle;
  liveKeywords = live.keywords;
  liveName = live.name;
  liveDescription = live.description;
  try {
    ascSnapshot = await readAscSnapshot(fetch, {
      token,
      appId: ascAppId,
      locale,
      readCppShotSigs: isFlagOn(env.CPP_SHOT_DIFF_ENABLED),
    });
  } catch {
    ascSnapshot = undefined;
  }

  const previous = await getLatestCompetitorMap(env.DB, app.id);
  const overrides: RunOverrides = { ascMetadataRead: true };
  if (extra.keywords) overrides.keywords = extra.keywords;
  if (extra.competitors) overrides.competitors = extra.competitors;
  else {
    const confirmed = await confirmedCompetitorKeys(env.DB, app.id);
    if (confirmed.length) overrides.competitors = confirmed;
  }
  overrides.baseCopy = {
    ...(liveName !== undefined ? { name: liveName } : {}),
    subtitle: liveSubtitle ?? "",
    keywords: liveKeywords ?? "",
    ...(liveDescription !== undefined ? { description: liveDescription } : {}),
    ...(extra.baseCopy ?? {}),
  };
  const ascReasoner = reasonerForEnv(env.AI);
  if (ascReasoner) overrides.reasoner = ascReasoner;

  const input = await buildAppInput(app, overrides, previous);
  const result = await runAgent(fetchForEnv(env), input);
  const ascListing = ascScreenshotsToListing(ascSnapshot?.screenshots);
  if (ascListing) result.audit.screenshots = scoreScreenshots(input.app, ascListing);
  await attachReviews(env, app, result);
  await attachChartRank(env, app, result);
  result.findings = auditFindings({
    snapshot: ascSnapshot,
    audit: result.audit,
    ranks: result.ranks,
    appName: app.name,
    hasAscKey: true,
    ...(result.proposedCopy !== undefined ? { proposedCopy: result.proposedCopy } : {}),
    ...(result.reviews !== undefined ? { reviews: result.reviews } : {}),
    ...(result.audit.storefront !== undefined ? { storefront: result.audit.storefront } : {}),
    ...(result.chartRank !== undefined ? { chartRank: result.chartRank } : {}),
  });
  // #182: measured first-screenshot caption lens (Workers AI vision, flag-gated).
  await attachCaptionFindings(env, result);
  result.locks = surfaceLocks({
    snapshot: ascSnapshot,
    audit: result.audit,
    ranks: result.ranks,
    appName: app.name,
    hasAscKey: true,
  });
  const ascContext = buildAscContext(ascSnapshot);
  if (ascContext !== undefined) result.ascContext = ascContext;
  await attachOpportunities(env, app.id, result);
  result.coverage = coverageForRun(result.currentCopy, app.name);
  const liveLocaleRows = (ascSnapshot?.locales ?? []) as Array<{ locale?: string | undefined }>;
  const liveLocales = liveLocaleRows
    .map((l) => l.locale)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  if (liveLocales.length > 0) {
    const category = ascSnapshot?.appInfo?.primaryCategory?.name;
    const recs = recommendLocales({ liveLocales, ...(category !== undefined ? { category } : {}) });
    if (recs.length > 0) result.localizationExpansion = recs;
  }
  // #182 Phase 3: propose a concrete outcome-led PPO treatment when the app has
  // no test running (read-only brief; the write lane waits on the screenshot
  // pipeline). Null (keyless/degraded read, or a test already live) → no card.
  const ppoTreatment = buildPpoTreatmentPlan({
    experiments: ascSnapshot?.experiments,
    ratingAverage: result.audit.storefront?.ratings?.average,
    trackId: result.audit.trackId,
  });
  if (ppoTreatment) result.ppoTreatment = ppoTreatment;
  const resultWithSnapshot = ascSnapshot ? { ...result, ascSnapshot } : result;
  return { result, resultWithSnapshot };
}

// ── Google Play credentials (parallel of the App Store Connect .p8 path) ──────
//
// The user supplies their Play Developer API SERVICE-ACCOUNT JSON in the request
// body, exactly like the ASC `.p8` arrives in /asc/verify and /apps/:id/run-asc:
// it is used in-request to mint a short-lived token and is NEVER persisted (no
// D1, no secret) and never logged. Only audit results / a boolean leave here.

type PlayVerifyBody = { serviceAccount?: unknown; packageName?: string };
type PlayAuditBody = {
  serviceAccount?: unknown;
  packageName?: string;
  language?: string;
  targets?: string[];
  brand?: string;
  /** Storefront for the keyless category chart-rank supplement (defaults to us). */
  country?: string;
};

/**
 * Normalize the `serviceAccount` field (a JSON object OR a JSON string) into a
 * `GoogleServiceAccount`. Throws a 400 with a key-free message on anything
 * malformed — it never echoes the private key.
 */
function parseServiceAccount(raw: unknown): GoogleServiceAccount {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "serviceAccount is not valid JSON");
    }
  }
  if (!obj || typeof obj !== "object") {
    throw new HttpError(400, "serviceAccount is required (the Play Developer API service-account JSON)");
  }
  const sa = obj as { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    throw new HttpError(400, "serviceAccount must include client_email and private_key");
  }
  return {
    client_email: sa.client_email,
    private_key: sa.private_key,
    ...(typeof sa.token_uri === "string" ? { token_uri: sa.token_uri } : {}),
  };
}

/** The Worker global fetch as the method+body `FetchLike` the Play API needs. */
const workerFetchLike: FetchLike = (url, init) => fetch(url, init);

/**
 * POST /play/verify — opt-in Play service-account credential check (the parallel
 * of POST /runs/:id/asc/verify). The JSON arrives in this request, is used to
 * mint a token (and optionally probe access to `packageName` via a discarded
 * edit), and is NEVER persisted. Only `{ ok, reason? }` leaves this function.
 */
async function playVerifyRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  void env;
  void userId; // authed caller; the credential is in the body, not stored per-user.
  const body = await req.json<PlayVerifyBody>().catch(() => ({}) as PlayVerifyBody);
  const sa = parseServiceAccount(body.serviceAccount);
  const packageName = body.packageName?.trim();
  return verifyPlayServiceAccount(
    workerFetchLike,
    sa,
    packageName ? { packageName } : {},
  );
}

/**
 * POST /apps/:id/audit-play — read-only own-app Google Play audit via the
 * Developer API, using the service-account JSON supplied IN THIS REQUEST (never
 * persisted). Owner-scoped on the connected app; the Play package id is supplied
 * in the body (it may differ from the iOS bundle id). Read-only — the Developer
 * API path opens and discards an edit and NEVER commits, so it can't publish.
 */
/**
 * Read Android vitals for a package and turn them into findings. Owner-keyed via
 * the Play Developer Reporting API (a reporting-scoped token minted from the same
 * service account). Degrade-safe: the reader nulls each rate on any failure, so a
 * missing scope / drifted request shape yields no findings rather than an error.
 * ⚠️ The `:query` body shape is best-effort pending live verification — this path
 * is gated behind PLAY_VITALS_ENABLED for exactly that reason.
 */
async function readPlayVitalsFindings(
  sa: GoogleServiceAccount,
  packageName: string,
): Promise<import("../engine/index.js").Finding[]> {
  const { accessToken } = await mintGoogleAccessToken(workerFetchLike, sa, {
    scope: PLAYDEVELOPERREPORTING_SCOPE,
  });
  // Metric field(s) to request per set. Crash/ANR use their user-perceived
  // variant; the newer quality sets are read WITHOUT an explicit metrics list
  // (the reader tolerantly picks the measured field from candidates), so the
  // best-effort field names don't have to be exact here.
  const METRICS_BY_SET: Record<string, string[]> = {
    crashRateMetricSet: ["userPerceivedCrashRate"],
    anrRateMetricSet: ["userPerceivedAnrRate"],
  };
  const query = async (metricSet: string) => {
    const metrics = METRICS_BY_SET[metricSet];
    const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${encodeURIComponent(
      packageName,
    )}/${metricSet}:query`;
    const resp = await workerFetchLike(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timelineSpec: { aggregationPeriod: "DAILY" },
        ...(metrics ? { metrics } : {}),
      }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return JSON.parse(text);
  };
  // Crash/ANR (documented visibility levers) + the newer quality sets (measured
  // technical-quality context). Each read degrades to nothing on its own.
  const [vitals, quality] = await Promise.all([
    readPlayVitals(query),
    readPlayQualityRates(query).catch(() => ({})),
  ]);
  return [...playVitalsFindings(vitals), ...playQualityFindings(quality)];
}

/**
 * Keyless category chart-rank findings for the OWNER audit-play route. The
 * Developer API listing carries no store category, so we read it keyless off the
 * public listing (the package id is known), then measure the app's position in
 * that category chart via the keyless `batchexecute` source. Fully degrade-safe:
 * any failure (no category, Worker egress 429, drift) → no findings, never an
 * error — the metadata audit is unaffected. Mirrors the keyless MCP path.
 */
async function readPlayChartRankFindings(
  env: Env,
  appId: string,
  packageName: string,
  country: string | undefined,
): Promise<import("../engine/index.js").Finding[]> {
  const listing = await readPlayListing(
    playWebSource(fetchForEnv(env)),
    packageName,
    country ? { country } : {},
  );
  const categoryId = listing.category?.id;
  if (!categoryId) return [];
  const rank = await fetchPlayChartRank(playChartSource(fetchLikeForEnv(env)), {
    packageName,
    category: categoryId,
    ...(listing.category?.name ? { categoryName: listing.category.name } : {}),
    ...(country ? { country } : {}),
  });
  // Parity step 1: persist the MEASURED sample as a time series (no-op on an
  // UNKNOWN null read). Best-effort — a persistence hiccup must not fail the audit.
  await persistPlayChartRank(env.DB, { appId, packageName, rank }).catch(() => undefined);
  return playChartRankFinding(rank);
}

/**
 * Keyless Play SEARCH-rank findings for the owner audit (parity step 2). For each
 * target term, scrape Play search and measure the app's organic position, then
 * MERGE the findings AND persist each measured position to rank_snapshots (the
 * same keyword-rank store the iOS analysis modules read, so opportunity /
 * attribution / war-room light up for Play). Gated (PLAY_SEARCH_RANK_ENABLED) +
 * degrade-safe: Worker egress 429s the search page, so an unread term → UNKNOWN
 * (persisted as nothing, never a fabricated rank). Capped to a few terms.
 */
async function readPlaySearchRankFindings(
  env: Env,
  appId: string,
  packageName: string,
  terms: string[],
  country: string | undefined,
): Promise<import("../engine/index.js").Finding[]> {
  const source = playSearchSource(playWebSource(fetchForEnv(env)));
  const capped = terms.map((t) => t.trim()).filter(Boolean).slice(0, 5);
  const findings: import("../engine/index.js").Finding[] = [];
  const rows: import("../engine/index.js").Rank[] = [];
  for (const term of capped) {
    const rank = await fetchPlaySearchRank(source, {
      packageName,
      term,
      ...(country ? { country } : {}),
    }).catch(() => null);
    findings.push(...playSearchRankFinding(rank));
    // Persist as keyword rank: an UNKNOWN read is marked error (skipped by the
    // writer) so we never store a non-measurement; a measured position (or an
    // honest "not ranking" → null rank) is recorded.
    rows.push({
      keyword: term,
      rank: rank === null ? null : rank.ranked ? rank.position : null,
      foundName: "",
      total: rank?.outOf ?? 0,
      limit: 50,
      error: rank === null ? "unknown" : "",
    });
  }
  if (rows.length > 0) {
    await persistRankSnapshots(env.DB, {
      appId,
      ranks: rows,
      ...(country ? { country } : {}),
    }).catch(() => undefined);
  }
  return findings;
}

async function auditPlayRoute(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const body = (await req.json<PlayAuditBody & { store?: boolean; useStored?: boolean }>().catch(
    () => ({}) as PlayAuditBody,
  )) as PlayAuditBody & { store?: boolean; useStored?: boolean };
  const packageName = (body.packageName ?? "").trim();
  if (!packageName) {
    throw new HttpError(400, "packageName is required (your Play package id, e.g. com.foo.bar)");
  }

  // #67 Phase 2 (Play parity): a stored service account may authenticate the
  // audit instead of an in-request one. The saved JSON is a transient here,
  // never returned. store:true persists it (after it parses) for future use.
  let saRaw: unknown = body.serviceAccount;
  if ((body.useStored || body.serviceAccount == null) && credentialsEnabled(env)) {
    const stored = await useCredential(env, userId, appId, "play");
    if (!stored) throw new HttpError(404, "no saved Google Play service account for this app");
    saRaw = stored.plaintext;
  }
  const sa = parseServiceAccount(saRaw);
  if (body.store && body.serviceAccount != null && credentialsEnabled(env)) {
    const asText = typeof body.serviceAccount === "string" ? body.serviceAccount : JSON.stringify(body.serviceAccount);
    await saveCredential(env, {
      userId,
      appId,
      kind: "play",
      keyId: sa.client_email,
      issuerId: "",
      plaintext: asText,
    }).catch(() => undefined);
  }

  let transport;
  try {
    transport = await playApiTransportForServiceAccount(workerFetchLike, sa);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid service account");
  }
  const adapter = playDeveloperApiAdapter(transport, body.language ? { language: body.language } : {});
  const targets = Array.isArray(body.targets)
    ? body.targets.filter((t): t is string => typeof t === "string")
    : undefined;
  try {
    const audit = await auditPlayListing(adapter, packageName, {
      ...(body.language ? { lang: body.language } : {}),
      ...(targets ? { targets } : {}),
      ...(typeof body.brand === "string" ? { brand: body.brand } : {}),
    });
    // Degrade-safe supplements MERGED into the owner audit — each nulls to [] on
    // any failure so it never breaks the metadata audit:
    //   • Android vitals (gated) — the owner-keyed, Google-documented visibility
    //     lever, read via the Reporting API. Off by default (best-effort shape).
    //   • Category chart rank (keyless) — a MEASURED "#N in <category>" read off
    //     the public listing's category. Worker egress usually 429s the RPC, so
    //     it typically yields nothing in prod, but costs the audit nothing.
    const [vitalsFindings, chartFindings, searchFindings, dataSafetyFindings] = await Promise.all([
      isFlagOn(env.PLAY_VITALS_ENABLED)
        ? readPlayVitalsFindings(sa, packageName).catch(() => [])
        : Promise.resolve([]),
      readPlayChartRankFindings(env, appId, packageName, body.country).catch(() => []),
      isFlagOn(env.PLAY_SEARCH_RANK_ENABLED) && targets && targets.length > 0
        ? readPlaySearchRankFindings(env, appId, packageName, targets, body.country).catch(() => [])
        : Promise.resolve([]),
      // Keyless data-safety consistency (§02-C) — a positively-observed gap flag +
      // a transparency summary. Degrade-safe: a 429/parse failure yields nothing.
      readPlayDataSafety(fetchForEnv(env), packageName, body.country ? { country: body.country } : {})
        .then(playDataSafetyFindings)
        .catch(() => []),
    ]);
    const extra = [...vitalsFindings, ...chartFindings, ...searchFindings, ...dataSafetyFindings];
    if (extra.length > 0) {
      const findings = sortFindings([...audit.findings, ...extra]);
      return { ...audit, findings, summary: summarizeFindings(findings) };
    }
    return audit;
  } catch (e) {
    // PlayApiError messages are key-free (HTTP status only) — safe to surface as a
    // clean upstream error rather than a generic 500.
    throw new HttpError(502, e instanceof Error ? e.message : "Play audit failed");
  }
}

type PlayDataSafetyWriteBody = {
  packageName?: string;
  /** The owner's Play data-safety CSV — pushed VERBATIM; we never author it. */
  safetyLabels?: string;
  serviceAccount?: unknown;
  useStored?: boolean;
};

/**
 * POST /apps/:id/play-data-safety — push the owner's Data-safety declaration
 * (PRD 02-B). The FIRST Play fix-and-push, and it targets a LEGAL declaration, so
 * it is deliberately fenced:
 *   • GATED behind PLAY_DATA_SAFETY_WRITE_ENABLED (dark until enabled);
 *   • OWNER-scoped (requireOwnedApp + the caller's own service account);
 *   • the `safetyLabels` CSV is the HUMAN's — we validate shape and push it
 *     verbatim, never generate or rewrite the declaration.
 * The UI carries the explicit "push declaration" confirm; hitting this route IS
 * the approved action.
 */
async function playDataSafetyWriteRoute(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  if (!isFlagOn(env.PLAY_DATA_SAFETY_WRITE_ENABLED)) {
    throw new HttpError(403, "Play data-safety write is not enabled.");
  }
  const body = (await req.json<PlayDataSafetyWriteBody>().catch(() => ({}))) as PlayDataSafetyWriteBody;
  const packageName = (body.packageName ?? "").trim();
  if (!packageName) throw new HttpError(400, "packageName is required (your Play package id).");
  const csv = body.safetyLabels ?? "";
  const check = validateSafetyLabelsCsv(csv);
  if (!check.ok) throw new HttpError(400, check.error);

  // Owner service account: in-request or the app's saved one (same as audit-play).
  let saRaw: unknown = body.serviceAccount;
  if ((body.useStored || body.serviceAccount == null) && credentialsEnabled(env)) {
    const stored = await useCredential(env, userId, appId, "play");
    if (!stored) throw new HttpError(404, "no saved Google Play service account for this app");
    saRaw = stored.plaintext;
  }
  const sa = parseServiceAccount(saRaw);

  // Mint an androidpublisher-scoped token and build a body-carrying write
  // transport (the read transport is intentionally body-less). Owner-only.
  let accessToken: string;
  try {
    ({ accessToken } = await mintGoogleAccessToken(workerFetchLike, sa, { scope: ANDROIDPUBLISHER_SCOPE }));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid service account");
  }
  const transport: import("../engine/index.js").PlayWriteTransport = async ({ url, body: reqBody }) => {
    const resp = await workerFetchLike(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: reqBody,
    });
    return { status: resp.status, body: await resp.text() };
  };
  try {
    return await writeDataSafetyLabels(transport, packageName, csv);
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message : "Play data-safety write failed");
  }
}

/**
 * DELETE /apps/:id — disconnect an app the user owns. Cascades to its runs,
 * rank/competitor snapshots, and approvals/proposals (see deleteApp), freeing a
 * tier slot. Owner-scoped: deleting another user's app 404s before any write.
 */
async function disconnectApp(env: Env, userId: string, appId: string): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  await deleteApp(env.DB, app.id);
  return { deleted: true, id: app.id };
}

// ── Competitors (#72-C: auto-discover candidates, the human confirms) ─────────

/** Shape a competitor row for the client (drop the app_id echo). */
function competitorOut(r: { comp_key: string; name: string; source: string; status: string }) {
  return { key: r.comp_key, name: r.name, source: r.source, status: r.status };
}

/** GET /apps/:id/competitors — the watch list (confirmed + suggested). */
async function competitorsList(env: Env, userId: string, appId: string): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const rows = await listCompetitors(env.DB, appId);
  return { competitors: rows.map(competitorOut) };
}

/**
 * GET /apps/:id/portfolio — the seller's OTHER apps, read from the latest run's
 * storefront intel (storefront-intel PRD 05). Suggestions only; tracking stays
 * a user action (POST /apps). Absent shelf / no runs / old trace → known:false
 * with an honest note, never a 500.
 */
async function appPortfolio(env: Env, userId: string, appId: string): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const latest = await latestRunTraceForApp(env.DB, appId);
  if (!latest) {
    return { portfolio: { known: false, note: "Run the agent once so it can read the storefront." } };
  }
  const tracked = (await listAppsForUser(env.DB, userId)).map((a) => a.bundle_id);
  const result = detectPortfolio(
    latest.trace.audit.storefront?.moreByDeveloper,
    tracked,
    app.bundle_id,
  );
  if (!result.known) {
    return {
      portfolio: {
        known: false,
        note: "The latest run didn't read the seller's other apps from the storefront.",
      },
    };
  }
  return { portfolio: { known: true, suggestions: result.suggestions, asOf: latest.createdAt } };
}

/**
 * POST /apps/:id/competitors/discover — search iTunes by the app's TRACKED
 * keywords and store new candidates as status='suggested'. Suggestions are
 * never silently watched: only confirmed rows feed runs/the sweep. Honest
 * empty-state: an app with no tracked keywords yet gets a note, not invented
 * seeds.
 */
async function competitorsDiscover(env: Env, userId: string, appId: string): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const keywords = await distinctTrackedKeywords(env.DB, appId, 5);
  if (keywords.length === 0) {
    const rows = await listCompetitors(env.DB, appId);
    return {
      competitors: rows.map(competitorOut),
      discovered: 0,
      note: "No tracked keywords yet — run the agent once so discovery has real searches to work from.",
    };
  }
  const fetchFn = fetchForEnv(env);

  // Source 1: apps that surface for the app's tracked keyword searches (#72-C).
  const searchFound = await discoverCompetitors(fetchFn, {
    keywords,
    selfBundleId: app.bundle_id,
    selfName: app.name,
    country: app.country,
  });

  // Source 2: Apple's own "You Might Also Like" shelf (storefront-intel PRD 02).
  // Best-effort: an unreadable page degrades discovery to search-only, never
  // an error. Search rows win a key collision (they carry keyword evidence), so
  // resolve the storefront candidates and drop any key search already produced.
  let similarFound: Awaited<ReturnType<typeof resolveSimilarCompetitors>> = [];
  let storefrontRead = false;
  try {
    const lookupUrl = buildUrl(ITUNES_LOOKUP_URL, { bundleId: app.bundle_id, country: app.country });
    const trackViewUrl = asResponse(await fetchJson(fetchFn, lookupUrl)).results?.[0]?.trackViewUrl;
    const listing = trackViewUrl ? await fetchStorefrontListing(fetchFn, trackViewUrl) : null;
    if (listing) {
      storefrontRead = true;
      if (listing.similarApps) {
        const searchKeys = new Set(searchFound.map((c) => c.key));
        similarFound = (
          await resolveSimilarCompetitors(fetchFn, listing.similarApps, {
            selfBundleId: app.bundle_id,
            selfName: app.name,
            country: app.country,
          })
        ).filter((c) => !searchKeys.has(c.key));
      }
    }
  } catch {
    // Storefront discovery is additive — a failure leaves search-only intact.
  }

  const existing = new Set((await listCompetitors(env.DB, appId)).map((c) => c.comp_key));
  let discovered = 0;
  // NOTE: the schema `source` CHECK is still ('user','discovered'); Apple-similar
  // rows persist as 'discovered' until the CHECK-widening D1 migration lands
  // (PRD 02). The finer origin is carried on the response for the UI meanwhile.
  const persist = async (c: { key: string; name: string }) => {
    if (existing.has(c.key)) return;
    existing.add(c.key);
    await upsertCompetitor(env.DB, {
      appId,
      compKey: c.key,
      name: c.name,
      source: "discovered",
      status: "suggested",
    });
    discovered++;
  };
  for (const c of searchFound) await persist(c);
  for (const c of similarFound) await persist(c);

  const rows = await listCompetitors(env.DB, appId);
  return {
    competitors: rows.map(competitorOut),
    discovered,
    sources: {
      search: searchFound.length,
      appleSimilar: similarFound.length,
      ...(storefrontRead ? {} : { note: "Apple's similar-apps shelf was unreadable — discovered from keyword search only." }),
    },
  };
}

/**
 * POST /apps/:id/locale-keywords (#180 Phase 3) — on-demand locale-native keyword
 * ideas for a target market. Searches that storefront's App Store for the app's
 * tracked keywords (or caller-supplied seeds) and harvests the terms real apps in
 * that country use — MEASURED, never a translation of the en-US set. Public read
 * only (iTunes Search); no credential touched. Honest empty-state: an app with no
 * tracked keywords and no seeds gets a note, not invented seeds.
 */
async function localeKeywordsRoute(req: Request, env: Env, userId: string, appId: string): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const body = (await req.json().catch(() => ({}))) as { market?: string; seeds?: string[] };
  const market = (body.market ?? "").trim();
  if (!market) throw new HttpError(400, "market is required — an App Store storefront code like 'jp' or 'de'");

  let seeds = (body.seeds ?? []).map((s) => String(s).trim()).filter((s) => s.length > 0);
  if (seeds.length === 0) seeds = await distinctTrackedKeywords(env.DB, appId, 5);
  if (seeds.length === 0) {
    return {
      market,
      candidates: [],
      note: "No tracked keywords yet — run the agent once, or pass `seeds` to search that market.",
    };
  }

  const candidates = await readLocaleKeywords(fetchForEnv(env), {
    market,
    seeds,
    brandTokens: deriveBrandTokens(app.name),
    existingTerms: seeds, // don't re-surface the terms you already searched with
    limit: 25,
  });
  return { market, seeds, candidates: candidates.slice(0, 40) };
}

/**
 * POST /apps/:id/competitors — add a competitor by name (resolved via iTunes
 * search) or by App Store id. User-added ⇒ confirmed immediately.
 */
async function competitorsAdd(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const body = (await readJson(req)) as { name?: unknown; key?: unknown };
  const fetchFn = fetchForEnv(env);

  let key: string | null = null;
  if (typeof body.key === "string" && body.key.trim()) {
    key = body.key.trim();
  } else if (typeof body.name === "string" && body.name.trim()) {
    key = await resolveNameToId(fetchFn, body.name.trim(), { country: app.country });
    if (!key) throw new HttpError(404, `couldn't find an App Store app for "${body.name.trim()}"`);
  } else {
    throw new HttpError(400, "name or key required");
  }

  // Canonical name from the real listing — also validates an explicit key.
  const listing = await lookup(fetchFn, key, { by: "id", country: app.country });
  if (listing.error) throw new HttpError(404, `couldn't look up App Store id ${key}`);

  await upsertCompetitor(env.DB, {
    appId,
    compKey: key,
    name: listing.name,
    source: "user",
    status: "confirmed",
  });
  const rows = await listCompetitors(env.DB, appId);
  return { competitors: rows.map(competitorOut), added: competitorOut({ comp_key: key, name: listing.name, source: "user", status: "confirmed" }) };
}

/** POST /apps/:id/competitors/:key/confirm — promote a suggestion to watched. */
async function competitorsConfirm(
  env: Env,
  userId: string,
  appId: string,
  compKey: string,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const ok = await confirmCompetitor(env.DB, appId, compKey);
  if (!ok) throw new HttpError(404, "competitor not found");
  const rows = await listCompetitors(env.DB, appId);
  return { competitors: rows.map(competitorOut) };
}

/** DELETE /apps/:id/competitors/:key — stop watching / dismiss a suggestion. */
async function competitorsRemove(
  env: Env,
  userId: string,
  appId: string,
  compKey: string,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const ok = await deleteCompetitor(env.DB, appId, compKey);
  if (!ok) throw new HttpError(404, "competitor not found");
  const rows = await listCompetitors(env.DB, appId);
  return { competitors: rows.map(competitorOut) };
}

// ── Run thresholds (#53) ──────────────────────────────────────────────────────

/** GET /apps/:id/thresholds — the app's run-threshold config (fail-open defaults). */
async function thresholdsGet(env: Env, userId: string, appId: string): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  return { thresholds: await getThresholds(env.DB, appId) };
}

/**
 * POST /apps/:id/thresholds — partial update. User input fails LOUD (400 with
 * the reason) — a typo must never silently become a default.
 */
async function thresholdsPost(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const v = validateThresholdPatch(await readJson(req));
  if (!v.ok) throw new HttpError(400, v.error);
  return { thresholds: await setThresholds(env.DB, appId, v.patch) };
}

// ── Sweep schedule (#52) ──────────────────────────────────────────────────────

/** GET /apps/:id/schedule — the app's sweep schedule (fail-open default). */
async function scheduleGet(env: Env, userId: string, appId: string): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  return { schedule: await getSchedule(env.DB, appId) };
}

/** POST /apps/:id/schedule — set the FULL schedule. Loud 400s on bad input. */
async function schedulePost(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const v = validateSchedule(await readJson(req));
  if (!v.ok) throw new HttpError(400, v.error);
  await setSchedule(env.DB, appId, v.schedule);
  return { schedule: v.schedule };
}

// ── Localization (#78 direction 1, Phase 1): per-locale draft generation ─────

/**
 * POST /runs/:id/localize — generate an honest per-locale metadata DRAFT from
 * the run's APPROVED copy. Stateless: nothing stored, nothing written to any
 * store. Refusals are loud: unknown locale 400s, an unapproved run 403s, a
 * missing AI binding 503s ("translation needs the AI binding"), and any
 * provider failure 502s — never a fake deterministic translation.
 */
async function localizeRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required — we localize the copy you approved, never the draft");
  }

  const body = (await readJson(req)) as { locale?: unknown };
  const locale = typeof body.locale === "string" ? body.locale.trim() : "";
  const known = (localesData as { locales: Record<string, unknown> }).locales;
  if (!locale || !(locale in known)) {
    throw new HttpError(400, "locale must be a supported App Store locale code (e.g. de-DE)");
  }
  if (locale === "en-US") throw new HttpError(400, "en-US is the source locale — nothing to translate");

  const localizer = localizerForEnv(env.AI);
  if (!localizer) {
    throw new HttpError(503, "translation needs the AI binding (or a DeepL key) — not configured on this deployment");
  }

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  const source = trace.proposedCopy; // post-approval edits are merged into the trace
  if (!source?.name) throw new HttpError(400, "this run carries no proposed copy to localize");

  try {
    return await localizeCopy(localizer, {
      copy: source,
      targetLocale: locale,
      brandTokens: deriveBrandTokens(source.name),
    });
  } catch (e) {
    if (e instanceof LocalizeError) throw new HttpError(502, e.message);
    throw e;
  }
}

/**
 * POST /localize/screenshots (#78 item 3, v1-A) — localize a layered screenshot
 * source's captions per market. Stateless: nothing stored, nothing rendered here
 * (this returns the caption plans + honest fit analysis; a downstream renderer
 * rasterizes). RTL locales come back in `excluded` (stated, never rendered
 * broken); a missing AI binding 503s; a provider failure 502s — never a fake
 * translation. Auth-gated (a signed-in user), but not app-scoped: the source is
 * the caller's own design.
 */
async function localizeScreenshotsRoute(req: Request, env: Env): Promise<unknown> {
  const body = (await readJson(req)) as {
    source?: unknown;
    targetLocales?: unknown;
    brandTokens?: unknown;
  };

  const rawSlots = (body.source as { slots?: unknown })?.slots;
  if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
    throw new HttpError(400, "source.slots must be a non-empty array");
  }
  const slots: TextSlot[] = [];
  for (const s of rawSlots) {
    const r = s as Record<string, unknown>;
    const box = r.box as { width?: unknown; height?: unknown } | undefined;
    if (
      typeof r.id !== "string" || r.id.trim() === "" ||
      typeof r.text !== "string" ||
      typeof r.fontSize !== "number" || !(r.fontSize > 0) ||
      !box || typeof box.width !== "number" || typeof box.height !== "number" ||
      !(box.width > 0) || !(box.height > 0)
    ) {
      throw new HttpError(400, "each slot needs id, text, positive fontSize, and a positive box {width,height}");
    }
    slots.push({
      id: r.id,
      text: r.text,
      box: { width: box.width, height: box.height },
      fontSize: r.fontSize,
      ...(typeof r.minFontSize === "number" ? { minFontSize: r.minFontSize } : {}),
      ...(typeof r.maxLines === "number" ? { maxLines: r.maxLines } : {}),
      ...(typeof r.lineHeight === "number" ? { lineHeight: r.lineHeight } : {}),
    });
  }
  const source: LayeredSource = { slots };

  const targetLocales = Array.isArray(body.targetLocales)
    ? body.targetLocales.filter((l): l is string => typeof l === "string" && l.trim() !== "")
    : [];
  if (targetLocales.length === 0) throw new HttpError(400, "targetLocales must be a non-empty array of locale codes");
  const brandTokens = Array.isArray(body.brandTokens)
    ? body.brandTokens.filter((t): t is string => typeof t === "string")
    : [];

  const localizer = localizerForEnv(env.AI);
  if (!localizer) {
    throw new HttpError(503, "translation needs the AI binding (or a DeepL key) — not configured on this deployment");
  }

  try {
    return await localizeScreenshots(localizer, { source, targetLocales, brandTokens });
  } catch (e) {
    if (e instanceof LocalizeError) throw new HttpError(502, e.message);
    throw e;
  }
}

/**
 * POST /runs/:id/localize/approve (#78 Phase 2) — the explicit per-market
 * approval: store this locale's (possibly human-edited) draft on the run
 * trace, making it part of the handoff. The server is authoritative: the
 * submission is re-validated (limits, keyword rules, brand token) and bad
 * input fails LOUD. Only stored locales ever reach a fastlane bundle.
 */
async function localizeApproveRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required");
  }
  const body = (await readJson(req)) as { locale?: unknown; copy?: unknown };
  const locale = typeof body.locale === "string" ? body.locale.trim() : "";
  const known = (localesData as { locales: Record<string, unknown> }).locales;
  if (!locale || !(locale in known)) throw new HttpError(400, "locale must be a supported App Store locale code");
  if (locale === "en-US") throw new HttpError(400, "en-US is the source locale");

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  const v = validateLocalizedSubmission({ copy: body.copy, sourceName: trace.proposedCopy?.name ?? "" });
  if (!v.ok) throw new HttpError(400, v.error);

  await setLocalizedCopy(env.DB, runId, locale, v.copy);
  const fresh = await getRun(env.DB, runId);
  const freshTrace = JSON.parse(fresh!.reasoning_json) as ReasoningTrace;
  return { approved: Object.keys(freshTrace.localizedCopy ?? {}).sort() };
}

/** DELETE /runs/:id/localize/:locale — un-approve (drop from the handoff). */
async function localizeDeleteRoute(
  env: Env,
  userId: string,
  runId: string,
  locale: string,
): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId);
  const removed = await deleteLocalizedCopy(env.DB, runId, locale);
  if (!removed) throw new HttpError(404, "locale not approved on this run");
  const fresh = await getRun(env.DB, runId);
  const freshTrace = JSON.parse(fresh!.reasoning_json) as ReasoningTrace;
  return { approved: Object.keys(freshTrace.localizedCopy ?? {}).sort() };
}

// ── Stored credentials (#67 post-launch half) — opt-in, write-only custody ───

/** GET /account/credentials — metadata ONLY (never key material). */
async function credentialsListRoute(env: Env, userId: string): Promise<unknown> {
  return {
    enabled: credentialsEnabled(env),
    credentials: await listCredentialMeta(env, userId),
  };
}

/**
 * DELETE /account/credentials/:kind?app=:appId — remove a stored credential.
 * Does NOT revoke the key at Apple/Google (the response says so). Honest 404
 * when nothing was stored.
 */
async function credentialsDeleteRoute(
  env: Env,
  userId: string,
  kind: string,
  url: URL,
): Promise<unknown> {
  if (kind !== "asc" && kind !== "play" && kind !== "asa") {
    throw new HttpError(400, "kind must be asc, play, or asa");
  }
  const appId = url.searchParams.get("app");
  const removed = await deleteCredential(env, userId, appId, kind);
  if (!removed) throw new HttpError(404, "no stored credential to delete");
  return {
    deleted: true,
    note:
      kind === "asa"
        ? "Removed from ShipASO. This does NOT revoke the key at Apple — revoke it in Apple Search Ads to fully kill it."
        : "Removed from ShipASO. This does NOT revoke the key at Apple — revoke it in App Store Connect to fully kill it.",
  };
}

/**
 * POST /account/asa-credential — connect an Apple Search Ads key so we can read
 * Apple's OWN keyword search popularity for the user's own terms (#78-2, Path A).
 * Opt-in, account-level, envelope-encrypted (the same #67 vault; kind:"asa"),
 * write-only custody. We VERIFY the key against Apple (mint a token + probe
 * `/acls` for the orgId) BEFORE storing — an invalid/unreachable key is a 400
 * with an honest, key-free reason, never stored. Requires credential storage to
 * be enabled (a KEK is set) → 503 otherwise. Returns metadata only.
 *
 * NOTE: connecting works today; the popularity NUMBERS stay dark until
 * ASA_POPULARITY_ENABLED is set (owner action, after live verification). The
 * response says so, so the UI never implies data that isn't flowing yet.
 */
async function asaConnectRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  if (!credentialsEnabled(env)) {
    throw new HttpError(503, "credential storage is not enabled on this deployment");
  }
  const body = (await req.json().catch(() => ({}))) as Partial<AsaKeyBundle>;
  const bundle: AsaKeyBundle = {
    privateKey: (body.privateKey ?? "").toString(),
    clientId: (body.clientId ?? "").toString().trim(),
    teamId: (body.teamId ?? "").toString().trim(),
    keyId: (body.keyId ?? "").toString().trim(),
    orgId: (body.orgId ?? "").toString().trim(),
  };
  if (!bundle.privateKey || !bundle.clientId || !bundle.teamId || !bundle.keyId || !bundle.orgId) {
    throw new HttpError(400, "privateKey, clientId, teamId, keyId, and orgId are all required");
  }

  const verdict = await verifyAsaCredentials(fetchForEnv(env), bundle);
  if (!verdict.ok) {
    // verdict.reason is key-free by construction (AsaCredError messages).
    throw new HttpError(400, `Apple Search Ads did not accept this key: ${verdict.reason}`);
  }

  // Store the whole bundle as one envelope; key_id/issuer_id are the non-secret
  // identifiers shown in the management UI (keyId + orgId).
  const meta = await saveCredential(env, {
    userId,
    appId: null, // ASA is account-level (popularity is org-scoped, not per-app)
    kind: "asa",
    keyId: bundle.keyId,
    issuerId: bundle.orgId,
    plaintext: serializeAsaBundle(bundle),
  });
  return {
    credential: meta,
    popularityLive: asaPopularityEnabled(env),
    note: asaPopularityEnabled(env)
      ? "Connected. We'll show Apple's real search popularity for your terms."
      : "Connected and verified. Popularity insights turn on once ShipASO finishes verifying the Search Ads read on this deployment.",
  };
}

/** Whether ASA popularity may be SURFACED (connect/verify works without it). */
function asaPopularityEnabled(env: Env): boolean {
  const v = (env.ASA_POPULARITY_ENABLED ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** GET /apps/:id — detail with the full run history list. */
async function appDetail(env: Env, userId: string, appId: string): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const runs = await listRunsForApp(env.DB, appId);
  return {
    app: { id: app.id, bundle_id: app.bundle_id, name: app.name, country: app.country },
    runs,
  };
}

/**
 * GET /apps/:id/ranks — trend data for the sparkline. Picks the lead keyword
 * (best/most-recent organic position) when `?keyword=` is not supplied, then
 * returns `{ keyword, points:[{rank,total,checked_at}] }` for that one series.
 */
async function appRanks(
  env: Env,
  userId: string,
  appId: string,
  url: URL,
): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  let keyword = url.searchParams.get("keyword") ?? undefined;

  // No keyword requested → pick the app's lead keyword from the most recent run.
  if (!keyword) {
    const all = await getRankHistory(env.DB, appId, {});
    if (all.length) {
      // most recent checked_at, then best (lowest) rank among ranked terms
      const latestAt = all[all.length - 1]?.checked_at;
      const latest = all.filter((r) => r.checked_at === latestAt);
      const ranked = latest.filter((r) => r.rank != null);
      const pick = (ranked.length ? ranked : latest).reduce((a, b) => {
        const ar = a.rank ?? Number.POSITIVE_INFINITY;
        const br = b.rank ?? Number.POSITIVE_INFINITY;
        return ar <= br ? a : b;
      });
      keyword = pick.keyword;
    }
  }

  // #62: timeline annotations — the app's own APPROVED pushes + competitors'
  // VISIBLE listing diffs, from data we already persist (no new reads). The
  // client overlays them as correlational markers; empty arrays are honest
  // (nothing observed), never an error.
  const [pushes, compSnapshots] = await Promise.all([
    derivePushes(env, appId),
    listCompetitorSnapshots(env.DB, appId),
  ]);
  const annotations = buildRankAnnotations({
    pushes: pushes.map((p) => ({ runId: p.runId, pushedAt: p.pushedAt })),
    competitorSnapshots: compSnapshots,
  });

  if (!keyword) return { keyword: "", points: [], annotations };

  const history = await getRankHistory(env.DB, appId, { keyword });
  const points = history.map((s) => ({
    rank: s.rank,
    total: s.total,
    checked_at: s.checked_at,
  }));
  return { keyword, points, annotations };
}

/**
 * GET /apps/:id/deltas — per-keyword week-over-week rank movement for the
 * animated dashboard. Reads the full rank history and shapes it with the same
 * `rankDeltasView` the digest uses, so the email and the UI never disagree about
 * a delta. Returns `{ appName, entries:[{keyword,current,previous,delta,
 * direction}], anyMovement }`, ordered biggest-mover-first. Single-snapshot
 * keywords come back with `previous: null` so the UI falls back to today's
 * on-render animation. Unblocks the animated-delta dashboard, the share-a-win
 * card (#23), and the competitor war-room view (#25).
 */
async function appDeltas(env: Env, userId: string, appId: string): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);
  const history = await getRankHistory(env.DB, appId, {});
  // PRD 02: derive the app's approved pushes so rankDeltasView can overlay the
  // (correlational) attribution — "after you added 'stoic' (Jun 12)" — onto each
  // moved keyword. This is a pure join of already-captured data: shipped runs'
  // proposed copy + their approval timestamps + the rank history. No new ASC
  // read, no raw listing data — just the terms WE proposed (privacy boundary).
  const pushes = await derivePushes(env, appId);
  // #74: restrict rank movement to the CURRENTLY-targeted keywords (the latest
  // run's set), so keywords we've since dropped (e.g. pre-#57 'manager'/'mangia'
  // tombstoned in old snapshots) don't resurface in the most prominent surface on
  // the app page. Mirrors the #73 fix for the opportunities card.
  const targeted = await latestRunKeywords(env, appId);
  return rankDeltasView(history, {
    appName: app.name,
    pushes,
    ...(targeted.length ? { keywords: targeted } : {}),
  });
}

/**
 * The keyword set the app's MOST RECENT run targeted (its rank-checked keywords).
 * Used to scope rank-movement / trend views to what the app currently targets,
 * not every keyword ever checked (#74). Empty when there's no run yet.
 */
async function latestRunKeywords(env: Env, appId: string): Promise<string[]> {
  const runs = await listRunsForApp(env.DB, appId);
  const latest = runs[0];
  if (!latest) return [];
  const run = await getRun(env.DB, latest.id);
  if (!run) return [];
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  return (trace.ranks ?? []).map((r) => r.keyword);
}

/**
 * Build the `PushInput[]` the attribution engine joins against: one per SHIPPED
 * run, carrying its proposed keywords/subtitle (and the baseline they diffed
 * against) plus the approval timestamp. Reads the run trace's `proposedCopy`
 * (the terms we proposed) and `currentCopy` (the baseline) — never raw ASC data.
 * Runs without an approval row, or still awaiting the gate, are skipped: only an
 * approved push can (correlationally) precede a rank move.
 */
async function derivePushes(env: Env, appId: string): Promise<PushInput[]> {
  const runs = await listRunsForApp(env.DB, appId);
  const shipped = runs.filter((r) => r.status === "shipped" || r.status === "approved");
  const pushes: PushInput[] = [];
  for (const r of shipped) {
    const [run, approval] = await Promise.all([
      getRun(env.DB, r.id),
      getApproval(env.DB, r.id),
    ]);
    if (!run || !approval || approval.decision !== "approved") continue;
    const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
    pushes.push({
      runId: r.id,
      pushedAt: approval.decided_at,
      proposedKeywords: trace.proposedCopy?.keywords ?? "",
      proposedSubtitle: trace.proposedCopy?.subtitle ?? "",
      currentKeywords: trace.currentCopy?.keywords ?? "",
      currentSubtitle: trace.currentCopy?.subtitle ?? "",
    });
  }
  return pushes;
}

/** Cap the competitor selection so a war-room call can't fan out unboundedly. */
const MAX_WAR_ROOM_COMPETITORS = 4;

/**
 * GET /apps/:id/war-room?competitors=name1,name2 — the head-to-head rank war
 * room (PRD 05, absorbs #25's competitor selector). We read YOUR rank history
 * (real, from D1) for the trend + your current position, then for each SELECTED
 * competitor we resolve the name to an App Store id and LIVE-CHECK their organic
 * rank on exactly your tracked keywords (the same iTunes Search mechanism that
 * produced your ranks). A competitor we can't resolve, or a keyword we couldn't
 * place them on, comes back `null` — honest "we didn't check", never a guess.
 *
 * PRIVACY: only competitor NAME + rank numbers reach the client (buildWarRoom's
 * output) — never a raw listing. READ-ONLY: no DB writes, no outward pushes.
 */
async function warRoom(env: Env, userId: string, appId: string, url: URL): Promise<unknown> {
  const app = await requireOwnedApp(env, appId, userId);

  // Parse + dedupe the selected competitor names (capped).
  const selected = (url.searchParams.get("competitors") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const names = [...new Set(selected)].slice(0, MAX_WAR_ROOM_COMPETITORS);

  // Your real rank history → normalized RankSnapshot[] + the tracked keyword set.
  const history = await getRankHistory(env.DB, appId, {});
  const yourRanks: WarRoomRankSnapshot[] = history.map((r) => ({
    keyword: r.keyword,
    rank: r.rank,
    checked_at: r.checked_at,
  }));
  const keywords = [...new Set(history.map((r) => r.keyword))];
  const today = new Date().toISOString().slice(0, 10);

  // For each selected competitor: resolve → live-check their rank on OUR tracked
  // keywords. A resolution failure leaves `ranks` empty so every cell is null
  // (unknown), not a fabricated zero. We never check keywords we don't track.
  const fetchFn = fetchForEnv(env);
  const country = app.country || env.DEFAULT_COUNTRY || "US";
  const competitorRanks: Array<{ name: string; ranks: WarRoomRankSnapshot[] }> = [];
  for (const name of names) {
    let ranks: WarRoomRankSnapshot[] = [];
    if (keywords.length) {
      const compBundle = await resolveNameToBundle(fetchFn, name, { country });
      if (compBundle) {
        const checked = await ranksFor(fetchFn, compBundle, keywords, { country });
        ranks = checked
          .filter((r) => !r.error)
          .map((r) => ({ keyword: r.keyword, rank: r.rank, checked_at: today }));
      }
    }
    competitorRanks.push({ name, ranks });
  }

  const warRoomRows = buildWarRoom({ yourRanks, competitorRanks });
  return {
    appName: app.name,
    warRoom: warRoomRows,
    competitors: names,
    window: 7,
    checkedAt: `${today}T00:00:00Z`,
  };
}

/**
 * GET /apps/:id/share-card.svg?size=wide|square — a branded, self-contained SVG
 * of the app's top honest rank win (#23), for screenshotting/sharing. Owner-
 * scoped. Returns 404 when there's no real win to show (a climb or a strong new
 * entry) — we never dress up a hold or a slip. The dashboard rasterizes the SVG
 * to PNG client-side.
 */
async function shareCardRoute(
  env: Env,
  userId: string,
  appId: string,
  url: URL,
  origin: string | null,
): Promise<Response> {
  const app = await requireOwnedApp(env, appId, userId);
  const history = await getRankHistory(env.DB, appId, {});
  const view = rankDeltasView(history, { appName: app.name });
  const win = pickShareWin(view);
  if (!win) throw new HttpError(404, "no rank win to share yet");
  const size = url.searchParams.get("size") === "square" ? "square" : "wide";
  const svg = renderShareCardSvg(win, { size, appName: app.name });
  return new Response(svg, {
    status: 200,
    headers: {
      ...corsHeaders(origin, env),
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** GET /runs/:id — full run view (scoped to the owner). */
async function getRunRoute(env: Env, userId: string, runId: string): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId); // ownership check via app
  return runView(env, runId);
}

/**
 * Import the RLHF AES key from env, or return null (SAFE-DEGRADE). Returns null
 * when env.RLHF_ENCRYPTION_KEY is unset OR malformed (wrong length / bad base64),
 * so capture silently no-ops instead of throwing — a misconfigured key must never
 * break an approval. (The export route surfaces a missing/bad key as an honest
 * error instead.)
 */
async function rlhfKey(env: Env): Promise<CryptoKey | null> {
  const b64 = env.RLHF_ENCRYPTION_KEY;
  if (!b64) return null;
  try {
    return await importKeyFromBase64(b64);
  } catch (e) {
    console.error("RLHF_ENCRYPTION_KEY invalid — capture disabled:", e);
    return null;
  }
}

type ApproveBody = {
  decision?: string;
  /**
   * Editable proposals (#39 Part 1). When approving, the client may send the human
   * edit buffer — only the editable fields (name/subtitle/keywords/promo) are
   * honored; the server re-validates with the engine's `validateCopy` before
   * staging anything. The client mirror is advisory only.
   */
  editedCopy?: Partial<CopyFields>;
};

/**
 * POST /runs/:id/approve  and  POST /runs/:id/reject — the human gate.
 *
 * `action` comes from the URL segment ("approve"/"reject"); the JSON body's
 * `decision` is also honored when present (so `/approve` with `{decision}` keeps
 * working). approve → status 'approved' + reveals the generated push commands
 * (which we still never execute — nothing reaches App Store Connect); reject →
 * status 'rejected', nothing pushed.
 */
async function decideRun(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
  action: "approve" | "reject",
): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  const app = await requireOwnedApp(env, run.app_id, userId);

  if (run.status !== "awaiting_approval") {
    throw new HttpError(409, `run is not awaiting approval (status=${run.status})`);
  }
  const existing = await getApproval(env.DB, runId);
  if (existing) throw new HttpError(409, `run already ${existing.decision}`);

  // body is optional; the URL action is authoritative but a body decision wins
  // if explicitly provided.
  const body = await req.json<ApproveBody>().catch(() => ({}) as ApproveBody);
  const raw = body.decision?.trim().toLowerCase() ?? action;
  const decision: "approved" | "rejected" =
    raw === "approve" || raw === "approved"
      ? "approved"
      : raw === "reject" || raw === "rejected"
        ? "rejected"
        : (() => {
            throw new HttpError(400, "decision must be 'approve' or 'reject'");
          })();

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;

  // Editable proposals (#39 Part 1): when approving WITH a human edit buffer,
  // merge the editable fields over the agent's proposal and re-validate with the
  // engine's authoritative `validateCopy` BEFORE we record the approval. An
  // over-limit / keyword-rule-violating edit can NEVER be staged — we throw 400
  // and the gate row is never written (gate not crossed). Validation runs first so
  // an invalid edit leaves the run untouched.
  let finalized: { copy: CopyFields; pushCommands: PushCommand[] } | null = null;
  if (decision === "approved" && body.editedCopy && Object.keys(body.editedCopy).length > 0) {
    const { copy, validation } = finalizeEditedCopy(trace.proposedCopy, body.editedCopy);
    if (!validation.pass) {
      const failing = validation.checks.filter((c) => !c.ok);
      throw new HttpError(
        400,
        `edited copy fails validation: ${failing
          .map((c) => `${c.field} (${c.issues.join("; ")})`)
          .join(", ")}`,
      );
    }
    // re-derive the push-command handoff from the edited copy with the engine's
    // own builder (the one used at run time) — the validation block is carried
    // through so `buildPushCommands`'s ProposedCopy input is well-formed.
    const pushCommands = buildPushCommands(app.bundle_id, { ...copy, validation });
    finalized = { copy, pushCommands };
  }

  // RLHF capture (#39 Part 2): build the ANONYMOUS, ENCRYPTED preference rows and
  // append them to the SAME atomic batch as the gate decision, so the captured
  // signal can never disagree with the recorded approval. Gated two ways:
  //   • SAFE-DEGRADE — no env.RLHF_ENCRYPTION_KEY ⇒ key is null ⇒ zero rows, no
  //     throw, approval proceeds (like the AI reasoner degrades without env.AI).
  //   • OPT-OUT (on by default OFF; honored at WRITE time) — an opted-out user
  //     never gets a row written. Since rows are anonymous they can't be deleted
  //     later, so we simply never capture them.
  // Rejected decisions ARE captured (a rejection is negative preference signal).
  // The whole block is best-effort: any capture error must NEVER block approval.
  let captureStmts: D1PreparedStatement[] = [];
  try {
    const key = await rlhfKey(env);
    if (key && !(await getOptOut(env.DB, userId))) {
      const finalCopy = finalized ? finalized.copy : trace.proposedCopy;
      captureStmts = await captureProposalEdits(env.DB, key, {
        proposed: trace.proposedCopy,
        final: finalCopy,
        decision,
      });
    }
  } catch (e) {
    console.error("rlhf capture skipped (non-fatal):", e);
    captureStmts = [];
  }

  await recordApproval(env.DB, { runId, decision, extraStmts: captureStmts });

  if (decision === "rejected") {
    return { id: runId, status: "rejected", pushCommands: [] };
  }

  // Persist the finalized (edited) copy onto the trace + proposals so every
  // downstream handoff reads the edited values (approach (a)). With no edits this
  // is a no-op and the agent's original proposal stands.
  if (finalized) {
    await updateRunCopy(env.DB, {
      runId,
      copy: finalized.copy,
      pushCommands: finalized.pushCommands,
    });
  }

  // approved → status is now 'approved' (NOT 'shipped' — nothing has reached
  // App Store Connect yet); return the generated, NON-executed push command
  // handoff so the client can copy + run it on a credentialed box. The returned
  // copy/commands reflect any human edits staged above.
  const finalPush = finalized ? finalized.pushCommands : trace.pushCommands;
  const finalCopy = finalized ? finalized.copy : trace.proposedCopy;
  return {
    id: runId,
    status: "approved",
    note: "Approved. Hand the metadata to your build pipeline (credential-free), or apply it yourself — ShipASO never stores your store credentials.",
    proposedCopy: finalCopy,
    pushCommands: finalPush,
  };
}

/**
 * GET /runs/:id/push-commands — the post-approval handoff. Returns 403 until the
 * run is approved/shipped, so the generated commands are literally unreadable
 * before the human clears the gate.
 */
async function pushCommandsRoute(env: Env, userId: string, runId: string): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required");
  }
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  return { commands: trace.pushCommands };
}

/**
 * GET /runs/:id/fastlane.zip — the post-approval metadata handoff as a Fastlane
 * `metadata/` tree, zipped. The user commits this (or merges the PR that adds it)
 * and their CI runs `fastlane deliver`/`supply` with the credentials it already
 * holds. Gated identically to push-commands: 403 until the run is approved.
 */
async function fastlaneZipRoute(
  env: Env,
  userId: string,
  runId: string,
  origin: string | null,
): Promise<Response> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required");
  }
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  // #78 Phase 2: APPROVED locale drafts ride the bundle — and only those.
  const bundle = buildFastlaneBundle(trace.proposedCopy, {
    ...(trace.localizedCopy ? { locales: trace.localizedCopy } : {}),
  });
  const zip = zipStore(bundle.files);
  // a Uint8Array is a valid BodyInit; copy into a fresh one so the body is backed
  // by a plain ArrayBuffer (not a possibly-shared buffer view).
  const body = new Uint8Array(zip);
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(origin, env),
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="fastlane-metadata.zip"',
    },
  });
}

/**
 * POST /runs/:id/github/pr — open a PR with the Fastlane metadata tree (#8).
 *
 * Inert unless the GitHub App is configured (GITHUB_APP_ID + private key) AND the
 * user has connected a repo (github_installation_id + github_repo). Approved-run,
 * owner-scoped. ShipASO's App key is the only credential; we mint a short-lived
 * App JWT → installation token → create branch + commit the tree + open the PR.
 * Falls back (403 with a clear reason) to the zip handoff when not connected.
 */
async function githubPrRoute(env: Env, userId: string, runId: string): Promise<unknown> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new HttpError(403, "the GitHub PR integration isn't configured; use the Fastlane download");
  }
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  const app = await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required before opening a PR");
  }

  const user = await getUser(env.DB, userId);
  if (!user?.github_installation_id || !user?.github_repo) {
    throw new HttpError(409, "connect a GitHub repo first (install the ShipASO app), or use the Fastlane download");
  }

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  const bundle = buildFastlaneBundle(trace.proposedCopy);

  try {
    const jwt = await mintAppJwt({ appId: env.GITHUB_APP_ID, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY });
    const token = await installationToken(fetch, { jwt, installationId: user.github_installation_id });
    const result = await openMetadataPr(fetch, {
      token,
      repo: user.github_repo,
      runId,
      appName: app.name,
      files: bundle.files,
    });
    return result; // { ok: true, url, number, branch }
  } catch (e) {
    if (e instanceof GithubAppError) return { ok: false, reason: e.message };
    throw e;
  }
}

type GithubConnectBody = { installation_id?: string; repo?: string };

/**
 * POST /github/connect — link the user's GitHub App installation + target repo
 * (owner/name) for the metadata-PR path. The installation id is not sensitive.
 * Pass {installation_id: null} (or omit) + nothing to disconnect.
 */
async function githubConnectRoute(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await req.json<GithubConnectBody>().catch(() => ({}) as GithubConnectBody);
  const installationId = body.installation_id?.trim() || null;
  const repo = body.repo?.trim();
  if (installationId && repo && !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new HttpError(400, "repo must be in owner/name form");
  }
  await setGithubConnection(env.DB, { userId, installationId, repo: repo ?? null });
  return { connected: !!installationId, repo: repo ?? null };
}

/**
 * POST /agent/pause and POST /agent/resume (#51) — the per-user master switch for
 * the autonomous weekly sweep. Pausing only REDUCES what the cron does (it stops
 * preparing + emailing); it can never push, approve, or weaken the human gate.
 * Manual runs stay available while paused (a non-goal: pausing the robot must not
 * lock the human out of their own tool). Returns the canonical new state so the
 * client renders the banner from the server, not an optimistic guess.
 */
async function setAgentPausedRoute(
  env: Env,
  userId: string,
  paused: boolean,
): Promise<unknown> {
  await setAgentPaused(env.DB, { userId, paused });
  return { paused };
}

/** GET /github/status — does the user have a GitHub connection + the app configured? */
async function githubStatusRoute(env: Env, userId: string): Promise<unknown> {
  const user = await getUser(env.DB, userId);
  return {
    appConfigured: !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY),
    connected: !!(user?.github_installation_id && user?.github_repo),
    repo: user?.github_repo ?? null,
  };
}

type AscVerifyBody = { p8?: string; keyId?: string; issuerId?: string };

/**
 * POST /runs/:id/asc/verify — opt-in App Store Connect credential check.
 *
 * The user uploads their `.p8` + key id + issuer id; the Worker mints a
 * short-lived ES256 JWT and calls a READ endpoint (`GET /v1/apps`) to prove the
 * credential works. This is the thin slice of the "one-click upload" path — it
 * authenticates only, no writes yet.
 *
 * SECURITY: the `.p8` is used in-request and never persisted (no D1, no secret)
 * and never logged. Only a boolean result + Apple's app count leave this fn.
 */
async function ascVerifyRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  await requireOwnedApp(env, run.app_id, userId);

  const body = await req.json<AscVerifyBody>().catch(() => ({}) as AscVerifyBody);
  if (!body.p8 || !body.keyId || !body.issuerId) {
    throw new HttpError(400, "p8, keyId, and issuerId are required");
  }

  let token: string;
  try {
    token = await mintAscJwt({ p8: body.p8, keyId: body.keyId, issuerId: body.issuerId });
  } catch (e) {
    // AscCredError messages are key-free by construction.
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }

  // Probe a read endpoint to confirm the credential is accepted by Apple.
  const res = await fetch("https://api.appstoreconnect.apple.com/v1/apps?limit=1", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "Apple rejected the credential (401/403). Check the key id, issuer id, and that the key has the right role." };
  }
  if (!res.ok) {
    return { ok: false, reason: `App Store Connect returned ${res.status}.` };
  }
  const data = (await res.json().catch(() => ({}))) as { data?: unknown[]; meta?: { paging?: { total?: number } } };
  const total = data.meta?.paging?.total ?? (Array.isArray(data.data) ? data.data.length : 0);
  return { ok: true, appsVisible: total };
}

type AscPushBody = AscCredBody & { locale?: string; dryRun?: boolean };

/**
 * POST /runs/:id/asc/push — opt-in direct App Store Connect metadata WRITE (#11).
 *
 * Gated behind ASC_WRITE_ENABLED (unset → 403; the credential-free Fastlane
 * handoff is the default). Only an APPROVED run may push. Credentials arrive
 * in-request (`.p8` + key/issuer id) or, since #179, from the user's STORED
 * credential (#67) — so the UI's approve → push needs no re-paste. The Worker
 * mints a short-lived ES256 JWT, resolves the ASC app id from the bundle id,
 * finds the editable version's localization, and PATCHes the approved copy. The
 * `.p8` plaintext is a transient and NEVER persisted onto the run or logged;
 * only non-empty fields are pushed (a blank never wipes live metadata).
 */
async function ascPushRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  if (!isFlagOn(env.ASC_WRITE_ENABLED)) {
    throw new HttpError(403, "direct App Store Connect push is not enabled; use the Fastlane handoff");
  }
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  const app = await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required before pushing");
  }

  const body = await req.json<AscPushBody>().catch(() => ({}) as AscPushBody);
  // #179: the stored credential (#67) backs the UI's one-click push — no
  // re-pasting the .p8 after approval. In-request creds still win when sent.
  const cred = await ascCredForRequest(env, userId, run.app_id, body);
  const locale = body.locale?.trim() || "en-US";

  let token: string;
  try {
    token = await mintAscJwt({ p8: cred.p8, keyId: cred.keyId, issuerId: cred.issuerId });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  try {
    const ascAppId = await findAscAppId(fetch, token, app.bundle_id);
    const result = await applyAscMetadata(fetch, {
      token,
      appId: ascAppId,
      copy: trace.proposedCopy,
      locale,
      // Opt-in preview: runs every lookup, returns the exact PATCH body, writes
      // nothing. Lets a push be inspected before it touches a live listing.
      dryRun: body.dryRun === true,
    });
    return result; // { ok, versionId, localizationId, fieldsPushed, dryRun?, patchBody? }
  } catch (e) {
    if (e instanceof AscWriteError) return { ok: false, reason: e.message };
    throw e;
  }
}

/**
 * POST /runs/:id/asc/create-version (#34) — create a DRAFT App Store version
 * (PREPARE_FOR_SUBMISSION) on the user's Apple account so the approved
 * proposal has somewhere to land. Its OWN per-action gate: same flag +
 * approval + in-request credential requirements as the push, its own explicit
 * click in the UI — never called automatically, never a silent fallback.
 * ASC errors (e.g. a version-number conflict) surface honestly.
 */
async function ascCreateVersionRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  if (!isFlagOn(env.ASC_WRITE_ENABLED)) {
    throw new HttpError(403, "direct App Store Connect writes are not enabled; use the Fastlane handoff");
  }
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  const app = await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required before creating a draft version");
  }

  const body = (await req
    .json()
    .catch(() => ({}))) as AscCredBody & { versionString?: string };
  const cred = await ascCredForRequest(env, userId, app.id, body);
  const versionString = (body.versionString ?? "").trim();
  if (!isValidVersionString(versionString)) {
    throw new HttpError(400, "versionString must look like 1, 1.2, or 1.2.3");
  }

  let token: string;
  try {
    token = await mintAscJwt({ p8: cred.p8, keyId: cred.keyId, issuerId: cred.issuerId });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }

  try {
    const ascAppId = await findAscAppId(fetch, token, app.bundle_id);
    const created = await createAscVersion(fetch, { token, appId: ascAppId, versionString });
    return { ok: true, versionId: created.id, versionString: created.versionString, state: created.appStoreState };
  } catch (e) {
    if (e instanceof AscWriteError) return { ok: false, reason: e.message };
    throw e;
  }
}

/** Shared guard for the per-locale ASC writes (#78 Phase 3): flag + run +
 *  ownership + approval + creds (in-request or stored, #179) + the locale must
 *  be APPROVED on the run (pushing a never-approved draft is a 403, not a
 *  convenience). */
async function requireLocalizedAscContext(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<{ token: string; bundleId: string; locale: string; copy: CopyFields }> {
  if (!isFlagOn(env.ASC_WRITE_ENABLED)) {
    throw new HttpError(403, "direct App Store Connect writes are not enabled; use the Fastlane handoff");
  }
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "run not found");
  const app = await requireOwnedApp(env, run.app_id, userId);
  if (run.status !== "shipped" && run.status !== "approved") {
    throw new HttpError(403, "approval required");
  }
  const body = (await req
    .json()
    .catch(() => ({}))) as AscCredBody & { locale?: string };
  const cred = await ascCredForRequest(env, userId, run.app_id, body);
  const locale = (body.locale ?? "").trim();
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  const copy = locale ? trace.localizedCopy?.[locale] : undefined;
  if (!copy) {
    throw new HttpError(403, `"${locale || "?"}" is not an approved locale on this run — approve its draft first`);
  }
  let token: string;
  try {
    token = await mintAscJwt({ p8: cred.p8, keyId: cred.keyId, issuerId: cred.issuerId });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }
  return { token, bundleId: app.bundle_id, locale, copy };
}

/**
 * POST /runs/:id/asc/push-locale (#78 Phase 3) — push an APPROVED locale draft
 * into that locale's localization on the editable version. Missing locale on
 * the version → the honest "create it first" reason; creation is its own
 * route + click, never chained.
 */
async function ascPushLocaleRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  const ctx = await requireLocalizedAscContext(req, env, userId, runId);
  try {
    const ascAppId = await findAscAppId(fetch, ctx.token, ctx.bundleId);
    const result = await applyAscMetadata(fetch, {
      token: ctx.token,
      appId: ascAppId,
      copy: ctx.copy, // the LOCALIZED copy — never en-US
      locale: ctx.locale,
    });
    return result;
  } catch (e) {
    if (e instanceof AscWriteError) return { ok: false, reason: e.message };
    throw e;
  }
}

/**
 * POST /runs/:id/asc/create-localization (#78 Phase 3) — create the locale on
 * the editable version so a per-market push has somewhere to land. Its own
 * explicit per-action write (the #34 pattern).
 */
async function ascCreateLocalizationRoute(
  req: Request,
  env: Env,
  userId: string,
  runId: string,
): Promise<unknown> {
  const ctx = await requireLocalizedAscContext(req, env, userId, runId);
  try {
    const ascAppId = await findAscAppId(fetch, ctx.token, ctx.bundleId);
    const versionId = await getEditableVersionId(fetch, { token: ctx.token, appId: ascAppId });
    const created = await createAscLocalization(fetch, { token: ctx.token, versionId, locale: ctx.locale });
    return { ok: true, localizationId: created.id, locale: created.locale };
  } catch (e) {
    if (e instanceof AscWriteError) return { ok: false, reason: e.message };
    throw e;
  }
}

/** Truthy flag parse for opt-in env switches. */
function isFlagOn(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

/**
 * Resolve ASC creds for a route (#179): in-request creds win; the STORED
 * credential (#67, envelope-encrypted) is the fallback, decrypted for this one
 * use. Maps the resolver's typed error onto this file's HttpError.
 */
async function ascCredForRequest(
  env: Env,
  userId: string,
  appId: string,
  body: AscCredBody,
): Promise<AscCred> {
  try {
    return await resolveAscCredential({
      body,
      enabled: credentialsEnabled(env),
      loadStored: () => useCredential(env, userId, appId, "asc"),
    });
  } catch (e) {
    if (e instanceof AscCredentialError) throw new HttpError(e.status, e.message);
    throw e;
  }
}

// ── ASC Analytics Reports — Phase 1 (analytics-reports PRD, 01-request-lifecycle) ─
//
// Two app-scoped endpoints, both carrying the ASC credential the same way every
// keyed route does (in-request trio wins; else the saved key via resolveAscCredential):
//   POST /apps/:id/analytics/status  — READ-ONLY. Detect the Admin-role gap and
//     report whether an ongoing request already exists. Never writes, never gated
//     (mirrors the read-only ascVerifyRoute) — safe to call on page load.
//   POST /apps/:id/analytics/enable  — the CONSENT write. Ensures ONE ongoing
//     request exists (idempotent). Gated behind ANALYTICS_ENABLED because creating
//     the request is an outward write to the user's Apple account; it must be an
//     explicit UI click, never automatic on a keyed run (PRD open question 1).
//
// Both mint a short-lived JWT and resolve the app's ASC numeric id from its bundle
// id (Apple keys apps by Apple id). The `.p8` is request-scoped — never persisted
// or logged — and the honest state (admin_required / not_requested / pending /
// unavailable) comes straight from the engine; no metric is ever fabricated here.

/** Shared prelude: own the app, resolve creds, mint the token, resolve the ASC app id. */
async function analyticsToken(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<{ token: string; ascAppId: string }> {
  const app = await requireOwnedApp(env, appId, userId);
  const body = (await req.json().catch(() => ({}))) as AscCredBody;
  const cred = await ascCredForRequest(env, userId, appId, body);
  let token: string;
  try {
    token = await mintAscJwt({ p8: cred.p8, keyId: cred.keyId, issuerId: cred.issuerId });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }
  try {
    const ascAppId = await findAscAppId(fetch, token, app.bundle_id);
    return { token, ascAppId };
  } catch (e) {
    // A blind/invalid key (Apple 401/403 on the app lookup, or no such app) is a
    // credential problem, not a 500 — surface Apple's token-free reason as a 400.
    if (e instanceof AscWriteError) throw new HttpError(400, e.message);
    throw e;
  }
}

async function ascAnalyticsStatusRoute(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  const { token, ascAppId } = await analyticsToken(req, env, userId, appId);
  return getAnalyticsStatus(fetch, { token, appId: ascAppId });
}

async function ascAnalyticsEnableRoute(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  if (!isFlagOn(env.ANALYTICS_ENABLED)) {
    throw new HttpError(403, "analytics reporting is not enabled for this deployment");
  }
  const { token, ascAppId } = await analyticsToken(req, env, userId, appId);
  return enableAnalyticsReports(fetch, { token, appId: ascAppId });
}

/**
 * POST /apps/:id/analytics/ingest (analytics-reports Phase 2) — pull the ready
 * Engagement report and persist the measured series to D1. Read + our-own-DB
 * write only (no outward write to Apple), so it's ungated like `status`; it just
 * needs the ongoing request Phase 1's `enable` created.
 *
 * Honest passthrough: if the key isn't Admin / no request exists / Apple is still
 * generating, we return that state verbatim (`admin_required` / `not_requested` /
 * `pending`) — never a fabricated series. On success it reports COUNTS only
 * (instances, rows persisted, distinct days) — the measured numbers themselves
 * are a Phase 3 surface, never invented here. Safe-degrade: an ingest failure
 * leaves any prior persisted data intact.
 */
async function ascAnalyticsIngestRoute(
  req: Request,
  env: Env,
  userId: string,
  appId: string,
): Promise<unknown> {
  const { token, ascAppId } = await analyticsToken(req, env, userId, appId);

  const status = await getAnalyticsStatus(fetch, { token, appId: ascAppId });
  if (status.state !== "pending") return status; // needs Admin / not requested / unavailable

  const result = await ingestEngagement(fetch, gunzipText, { token, requestId: status.requestId });
  if (!result.ok) {
    return result.reason === "not_ready"
      ? { state: "pending", message: PENDING_MESSAGE } // Apple still generating — check back
      : { state: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  const rowsPersisted = await upsertEngagementRows(env.DB, appId, result.rows);
  const days = new Set(result.rows.map((r) => r.date)).size;
  return { state: "ingested", instances: result.instances, rowsPersisted, days };
}

/**
 * GET /apps/:id/analytics/engagement (analytics-reports Phase 3) — the MEASURED
 * conversion surface. Reads the persisted Engagement series (our own D1, no ASC
 * call, no credential) and joins it to the app's APPROVED pushes to report the
 * latest measured conversion and how it moved around each ship.
 *
 * Honesty: conversion is Apple's measured downloads/PPV — null when unmeasurable,
 * never a fabricated 0. Movements are correlational and measured-or-absent (both
 * windows must be measurable). `no_data` until Phase 2 has ingested something —
 * never a zero series.
 */
async function analyticsEngagementRoute(env: Env, userId: string, appId: string): Promise<unknown> {
  await requireOwnedApp(env, appId, userId);
  const series = await getEngagementSeries(env.DB, appId);
  if (series.length === 0) {
    return { state: "no_data", message: "No analytics ingested yet — enable analytics and ingest first." };
  }
  const pushes = (await derivePushes(env, appId)).map((p) => ({ runId: p.runId, pushedAt: p.pushedAt }));
  return {
    state: "measured",
    latestConversion: latestConversion(series),
    movements: conversionMovements(series, pushes),
    days: new Set(series.map((r) => r.date)).size,
  };
}

// ── billing ────────────────────────────────────────────────────────────────────

/** The Stripe secret key — STRIPE_SECRET_KEY, with the legacy STRIPE_TEST_KEY as
 *  a fallback during the rename migration (#9). */
function stripeSecretKey(env: Env): string | undefined {
  return env.STRIPE_SECRET_KEY ?? env.STRIPE_TEST_KEY;
}

/** Pull the Stripe price-env slice off the worker Env. */
function priceEnv(env: Env): StripePriceEnv {
  const prices: StripePriceEnv = {};
  if (env.STRIPE_PRICE_INDIE !== undefined) prices.STRIPE_PRICE_INDIE = env.STRIPE_PRICE_INDIE;
  if (env.STRIPE_PRICE_STARTUP !== undefined)
    prices.STRIPE_PRICE_STARTUP = env.STRIPE_PRICE_STARTUP;
  if (env.STRIPE_PRICE_SCALE !== undefined) prices.STRIPE_PRICE_SCALE = env.STRIPE_PRICE_SCALE;
  return prices;
}

type CheckoutBody = { tier?: string };

/**
 * POST /billing/checkout {tier} — create a Stripe Checkout Session for a paid
 * tier and hand back its hosted URL. The client redirects the browser there.
 */
async function billingCheckout(
  req: Request,
  env: Env,
  user: { id: string; email: string },
): Promise<unknown> {
  const secretKey = stripeSecretKey(env);
  if (!secretKey) throw new HttpError(503, "billing is not configured");
  const body = await readJson<CheckoutBody>(req);
  const tier = body.tier?.trim();
  if (tier !== "indie" && tier !== "startup" && tier !== "scale") {
    throw new HttpError(400, "tier must be one of: indie, startup, scale");
  }
  const base = authBaseUrl(req, env);
  try {
    const session = await createCheckoutSession(fetch, {
      secretKey,
      tier,
      prices: priceEnv(env),
      customerEmail: user.email,
      successUrl: `${base}/?checkout=success`,
      cancelUrl: `${base}/?checkout=cancel`,
      clientReferenceId: user.id,
    });
    return { url: session.url };
  } catch (e) {
    // a missing price id is a config error, not the user's fault.
    throw new HttpError(503, `could not start checkout: ${String(e)}`);
  }
}

/** Narrow shape of the Stripe events we act on (only the fields we read). */
type StripeEvent = {
  type?: string;
  data?: {
    object?: {
      /** the object's own id (e.g. the subscription id on a subscription event). */
      id?: string;
      client_reference_id?: string;
      customer?: string;
      customer_email?: string;
      subscription?: string;
      status?: string;
      current_period_end?: number;
      mode?: string;
      items?: { data?: Array<{ price?: { id?: string } }> };
    };
  };
};

/** unix-seconds → ISO string (Stripe sends current_period_end as a number). */
function isoFromUnix(secs: number | undefined): string | null {
  if (typeof secs !== "number" || !Number.isFinite(secs)) return null;
  return new Date(secs * 1000).toISOString();
}

/**
 * POST /billing/webhook — verify the Stripe-Signature over the RAW body, then
 * apply the subscription state to the user's tier. Handles:
 *   checkout.session.completed       → set tier from the line-item price (+ ids)
 *   customer.subscription.updated    → sync status / period / tier
 *   customer.subscription.deleted    → downgrade to free
 * Returns 200 fast; unknown events are acknowledged (200) and ignored.
 */
async function billingWebhook(req: Request, env: Env, origin: string | null): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook not configured" }, 503, origin, env);

  const raw = await req.text();
  const ok = await verifyStripeSignature(secret, req.headers.get("Stripe-Signature"), raw);
  if (!ok) return json({ error: "invalid signature" }, 400, origin, env);

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return json({ error: "invalid body" }, 400, origin, env);
  }

  const obj = event.data?.object ?? {};
  const prices = priceEnv(env);

  if (event.type === "checkout.session.completed") {
    const userId = obj.client_reference_id;
    // The bare checkout.session does not include line items, so we can't read the
    // price here. Every paid tier (indie/startup/scale) is a recurring subscription,
    // so the tier is set authoritatively from customer.subscription.updated, which
    // fires right after with the price; here we just persist the Stripe ids + status.
    if (userId) {
      await setTier(env.DB, {
        userId,
        status: "active",
        ...(obj.customer ? { stripeCustomerId: obj.customer } : {}),
        ...(obj.subscription ? { stripeSubscriptionId: obj.subscription } : {}),
      });
    }
  } else if (event.type === "customer.subscription.updated") {
    const customer = obj.customer;
    const priceId = obj.items?.data?.[0]?.price?.id;
    const tier = priceId ? tierForPriceId(priceId, prices) : null;
    if (customer) {
      const u = await getUserByStripeCustomer(env.DB, customer);
      if (u) {
        await setTier(env.DB, {
          userId: u.id,
          ...(tier ? { tier } : {}),
          ...(obj.status ? { status: obj.status } : {}),
          ...(obj.id ? { stripeSubscriptionId: obj.id } : {}),
          currentPeriodEnd: isoFromUnix(obj.current_period_end),
        });
      }
    }
  } else if (event.type === "customer.subscription.deleted") {
    const customer = obj.customer;
    if (customer) {
      const u = await getUserByStripeCustomer(env.DB, customer);
      if (u) {
        await setTier(env.DB, {
          userId: u.id,
          tier: "free",
          status: "canceled",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
        });
      }
    }
  } else if (
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.payment_succeeded"
  ) {
    // Dunning: a failed payment flags the account past_due (so the gates can
    // react), a recovery clears it. The pure dunningOutcome decides; we only
    // EMAIL on the actual transition — Stripe re-fires payment_failed on every
    // smart-retry, so emailing each time would spam "update your card".
    const customer = obj.customer;
    if (customer) {
      const u = await getUserByStripeCustomer(env.DB, customer);
      if (u) {
        const prev = u.status;
        const decision = dunningOutcome(event.type, prev);
        if (decision.newStatus && decision.newStatus !== prev) {
          await setTier(env.DB, { userId: u.id, status: decision.newStatus });
        }
        const transitioned = decision.newStatus !== undefined && decision.newStatus !== prev;
        if (decision.sendEmail && transitioned && u.email) {
          const dashboardUrl = env.DASHBOARD_ORIGIN ?? "https://app.shipaso.com";
          const mail = dunningEmail(decision.sendEmail, { dashboardUrl });
          await emailSenderForEnv(env)
            .send({ to: u.email, ...mail })
            .catch((e) => console.error(`[store-ops] dunning email failed: ${String(e)}`));
        }
      }
    }
  }

  return json({ received: true }, 200, origin, env);
}

// ── router ─────────────────────────────────────────────────────────────────────

/** Match `/runs/:id/approve` style paths into [segments]. */
function segments(pathname: string): string[] {
  return pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

export async function handleApi(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }

  const url = new URL(req.url);
  const seg = segments(url.pathname);
  const method = req.method;

  // health / root
  if (seg.length === 0) {
    return json({ ok: true, service: "store-ops", env: env.APP_ENV }, 200, origin, env);
  }

  // ── PUBLIC routes (no requireUser): auth + Stripe webhook ────────────────────
  try {
    if (seg[0] === "auth") {
      if (seg[1] === "request" && seg.length === 2 && method === "POST") {
        return json(await authRequest(req, env), 200, origin, env);
      }
      if (seg[1] === "callback" && seg.length === 2 && method === "GET") {
        return authCallback(req, env, origin);
      }
      if (seg[1] === "exchange" && seg.length === 2 && method === "POST") {
        return authExchange(req, env);
      }
      if (seg[1] === "logout" && seg.length === 2 && method === "POST") {
        return authLogout(origin, env);
      }
      if (seg[1] === "me" && seg.length === 2 && method === "GET") {
        return authMe(req, env, origin);
      }
    }
    // Digest unsubscribe (comms-prefs Phase 2) — public; the token IS the auth.
    if (seg[0] === "email" && seg[1] === "unsubscribe" && seg.length === 2) {
      if (method === "GET") return unsubscribeGetRoute(req, env);
      if (method === "POST") return unsubscribePostRoute(req, env);
    }
    // Broadcast-list unsubscribe (separate audience from digest) — public; the token IS the auth.
    if (seg[0] === "list" && seg[1] === "unsubscribe" && seg.length === 2) {
      if (method === "GET") return listUnsubGetRoute(req, env);
      if (method === "POST") return listUnsubPostRoute(req, env);
    }
    // Owner-only broadcast tool — gated by the x-broadcast-token header, not requireUser.
    if (seg[0] === "broadcast" && seg[1] === "subscribers" && seg.length === 2 && method === "GET") {
      return await broadcastSubscribersRoute(req, env, origin);
    }
    if (seg[0] === "broadcast" && seg[1] === "test" && seg.length === 2 && method === "POST") {
      return await broadcastTestRoute(req, env, origin);
    }
    if (seg[0] === "broadcast" && seg[1] === "send" && seg.length === 2 && method === "POST") {
      return await broadcastSendRoute(req, env, origin, ctx);
    }
    // Stripe calls this server-to-server with NO cookie — auth is the signature.
    if (
      seg[0] === "billing" &&
      seg[1] === "webhook" &&
      seg.length === 2 &&
      method === "POST"
    ) {
      return billingWebhook(req, env, origin);
    }
    // Public launch-list capture from the marketing landing (HTML form or JSON).
    if (seg[0] === "subscribe" && seg.length === 1 && method === "POST") {
      return subscribe(req, env, origin);
    }
    // Public anonymized proof stat for the landing.
    if (seg[0] === "proof" && seg.length === 1 && method === "GET") {
      return proofStats(env, origin);
    }
    // Public try-before-signup: resolve a query → candidates (read-only).
    if (seg[0] === "resolve" && seg.length === 1 && method === "POST") {
      return json(await resolveQuery(req, env), 200, origin, env);
    }
    // Public try-before-signup: a real audit + rank preview, no DB write, no auth.
    if (seg[0] === "preview" && seg.length === 1 && method === "POST") {
      return json(await previewApp(req, env), 200, origin, env);
    }
    // Owner-only RLHF export (#39 Part 2). NOT session-gated — it has its own
    // secret-token gate (x-rlhf-export === env.RLHF_EXPORT_TOKEN) and degrades
    // CLOSED (403) when the token is unset, so it lives outside requireUser.
    if (seg[0] === "admin" && seg[1] === "preference-data" && seg.length === 2 && method === "GET") {
      return preferenceDataExport(req, env, origin);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, origin, env);
    // Log the real error server-side; return a generic message so unexpected
    // exception text is never echoed to the client.
    console.error("unhandled error (public routes):", e);
    return json({ error: "internal error" }, 500, origin, env);
  }

  try {
    const user = await requireUser(req, env);

    // /mcp — the ShipASO MCP server (#93). Read-only/draft tools over Streamable
    // HTTP for agent IDEs (Claude Code / Cursor). Gated by requireUser above
    // (cookie OR Bearer session token), so an unauthed call never reaches a tool.
    // The transport owns its own JSON-RPC response (status, content-type), so we
    // return it verbatim rather than wrapping it in json().
    if (seg[0] === "mcp" && seg.length === 1) {
      return handleMcp(req, { env, user });
    }

    // /billing/checkout — authenticated (the buyer is the signed-in user)
    if (seg[0] === "billing" && seg[1] === "checkout" && seg.length === 2 && method === "POST") {
      return json(await billingCheckout(req, env, user), 200, origin, env);
    }

    // (/resolve is now a PUBLIC route — see the public block above.)

    // /health — production-readiness audit (authed: it names which secrets are
    // unset, so it's not public). Returns 200 when ready, 503 when an error check
    // fails, so an uptime probe can alert on a misconfigured deploy.
    if (seg[0] === "health" && seg.length === 1 && method === "GET") {
      const report = auditReadiness(env);
      return json(report, report.ready ? 200 : 503, origin, env);
    }

    // /portfolio — the Scale roll-up across all of the user's apps
    if (seg[0] === "portfolio" && seg.length === 1 && method === "GET") {
      return json(await portfolioView(env, user.id), 200, origin, env);
    }

    // /account/rlhf-optout — flip this user's RLHF capture opt-out (#39 Part 2)
    if (
      seg[0] === "account" &&
      seg[1] === "rlhf-optout" &&
      seg.length === 2 &&
      method === "POST"
    ) {
      return json(await rlhfOptOutRoute(req, env, user.id), 200, origin, env);
    }

    // /account/rank-cadence — set this user's rank snapshot cadence (daily|weekly) (#94)
    if (
      seg[0] === "account" &&
      seg[1] === "rank-cadence" &&
      seg.length === 2 &&
      method === "POST"
    ) {
      return json(await rankCadenceRoute(req, env, user.id), 200, origin, env);
    }

    // /account/push-token — register this device's Expo push token (mobile, Phase 5)
    if (
      seg[0] === "account" &&
      seg[1] === "push-token" &&
      seg.length === 2 &&
      method === "POST"
    ) {
      return json(await pushTokenRoute(req, env, user.id), 200, origin, env);
    }
    // DELETE /account/push-token — unregister this user's device (sign-out path)
    if (
      seg[0] === "account" &&
      seg[1] === "push-token" &&
      seg.length === 2 &&
      method === "DELETE"
    ) {
      return json(await pushTokenDeleteRoute(req, env, user.id), 200, origin, env);
    }
    // /account/api-keys — scoped agent/MCP API keys (#93). GET lists metadata,
    // POST mints a key (raw value returned ONCE), DELETE /:id revokes.
    if (seg[0] === "account" && seg[1] === "api-keys") {
      if (seg.length === 2 && method === "GET") {
        return json({ keys: await listApiKeys(env.DB, user.id) }, 200, origin, env);
      }
      if (seg.length === 2 && method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { label?: unknown };
        const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
        return json(await createApiKey(env.DB, user.id, label), 201, origin, env);
      }
      if (seg.length === 3 && method === "DELETE") {
        const ok = await revokeApiKey(env.DB, user.id, seg[2]!);
        if (!ok) throw new HttpError(404, "no such API key");
        return json({ revoked: true }, 200, origin, env);
      }
    }

    // /account/credentials — stored-credential management (#67; write-only)
    if (seg[0] === "account" && seg[1] === "credentials") {
      if (seg.length === 2 && method === "GET") {
        return json(await credentialsListRoute(env, user.id), 200, origin, env);
      }
      if (seg.length === 3 && seg[2] && method === "DELETE") {
        return json(await credentialsDeleteRoute(env, user.id, seg[2], url), 200, origin, env);
      }
    }
    // POST /account/asa-credential — connect + verify an Apple Search Ads key (#78-2)
    if (seg[0] === "account" && seg[1] === "asa-credential" && seg.length === 2 && method === "POST") {
      return json(await asaConnectRoute(req, env, user.id), 200, origin, env);
    }
    // POST /localize/screenshots — localize a layered screenshot source (#78 item 3, v1-A)
    if (seg[0] === "localize" && seg[1] === "screenshots" && seg.length === 2 && method === "POST") {
      return json(await localizeScreenshotsRoute(req, env), 200, origin, env);
    }

    // /account/notifications — communication prefs (comms-prefs Phase 1)
    if (seg[0] === "account" && seg[1] === "notifications" && seg.length === 2) {
      if (method === "GET") {
        return json(await notificationsGetRoute(env, user.id), 200, origin, env);
      }
      if (method === "POST") {
        return json(await notificationsPostRoute(req, env, user.id), 200, origin, env);
      }
    }

    // /runs/approve-all — bulk-approve every pending run (matched BEFORE /runs/:id)
    if (seg[0] === "runs" && seg[1] === "approve-all" && seg.length === 2 && method === "POST") {
      return json(await approveAll(env, user.id), 200, origin, env);
    }

    // /github — connect a repo (+ installation id) / status for the metadata-PR path
    if (seg[0] === "github" && seg[1] === "connect" && seg.length === 2 && method === "POST") {
      return json(await githubConnectRoute(req, env, user.id), 200, origin);
    }
    if (seg[0] === "github" && seg[1] === "status" && seg.length === 2 && method === "GET") {
      return json(await githubStatusRoute(env, user.id), 200, origin);
    }

    // /rejection-assistant — paste an App Review rejection → cited guideline +
    // verbatim rule + fix-vs-appeal recommendation + reply scaffolds (#178 Phase 4).
    // Pure text analysis (no app/DB/credential); authed as a logged-in tool.
    if (seg[0] === "rejection-assistant" && seg.length === 1 && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { text?: string };
      return json(analyzeRejection(String(body.text ?? "")), 200, origin);
    }

    // /agent/pause | /agent/resume — per-user master switch for the weekly sweep (#51).
    if (seg[0] === "agent" && seg[1] === "pause" && seg.length === 2 && method === "POST") {
      return json(await setAgentPausedRoute(env, user.id, true), 200, origin);
    }
    if (seg[0] === "agent" && seg[1] === "resume" && seg.length === 2 && method === "POST") {
      return json(await setAgentPausedRoute(env, user.id, false), 200, origin);
    }

    // /apps ...
    if (seg[0] === "apps") {
      if (seg.length === 1) {
        if (method === "POST") {
          const result = await connectApp(req, env, user.id);
          // A pick-list (ambiguous query) is a 200, not a 201-created.
          const status =
            result && typeof result === "object" && "needsChoice" in result ? 200 : 201;
          return json(result, status, origin);
        }
        if (method === "GET") return json(await listApps(env, user.id), 200, origin);
      }
      if (seg.length === 2 && seg[1]) {
        const appId = seg[1];
        if (method === "GET") return json(await appDetail(env, user.id, appId), 200, origin);
        if (method === "DELETE") return json(await disconnectApp(env, user.id, appId), 200, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "run" && method === "POST") {
        return json(await runApp(req, env, user.id, seg[1]), 201, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "run-asc" && method === "POST") {
        return json(await runAppWithAsc(req, env, user.id, seg[1]), 201, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "audit-play" && method === "POST") {
        return json(await auditPlayRoute(req, env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "play-data-safety" && method === "POST") {
        return json(await playDataSafetyWriteRoute(req, env, user.id, seg[1]), 200, origin);
      }
      // ASC Analytics Reports Phase 1: read-only status probe + the consent-gated
      // enable (create the ongoing request). Both carry the ASC credential.
      if (seg.length === 4 && seg[1] && seg[2] === "analytics" && seg[3] === "status" && method === "POST") {
        return json(await ascAnalyticsStatusRoute(req, env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 4 && seg[1] && seg[2] === "analytics" && seg[3] === "enable" && method === "POST") {
        return json(await ascAnalyticsEnableRoute(req, env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 4 && seg[1] && seg[2] === "analytics" && seg[3] === "ingest" && method === "POST") {
        return json(await ascAnalyticsIngestRoute(req, env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 4 && seg[1] && seg[2] === "analytics" && seg[3] === "engagement" && method === "GET") {
        return json(await analyticsEngagementRoute(env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "ranks" && method === "GET") {
        return json(await appRanks(env, user.id, seg[1], url), 200, origin);
      }
      // schedule (#52): read / set the sweep schedule
      if (seg.length === 3 && seg[1] && seg[2] === "schedule") {
        if (method === "GET") return json(await scheduleGet(env, user.id, seg[1]), 200, origin);
        if (method === "POST") return json(await schedulePost(req, env, user.id, seg[1]), 200, origin);
      }
      // thresholds (#53): read / partial-update the run-threshold config
      if (seg.length === 3 && seg[1] && seg[2] === "thresholds") {
        if (method === "GET") return json(await thresholdsGet(env, user.id, seg[1]), 200, origin);
        if (method === "POST") return json(await thresholdsPost(req, env, user.id, seg[1]), 200, origin);
      }
      // competitors (#72): list / add / discover / confirm / remove
      if (seg.length === 3 && seg[1] && seg[2] === "competitors") {
        if (method === "GET") return json(await competitorsList(env, user.id, seg[1]), 200, origin);
        if (method === "POST") return json(await competitorsAdd(req, env, user.id, seg[1]), 201, origin);
      }
      if (seg.length === 4 && seg[1] && seg[2] === "competitors" && seg[3] === "discover" && method === "POST") {
        return json(await competitorsDiscover(env, user.id, seg[1]), 200, origin);
      }
      // locale-native keyword ideas for a target market (#180 Phase 3)
      if (seg.length === 3 && seg[1] && seg[2] === "locale-keywords" && method === "POST") {
        return json(await localeKeywordsRoute(req, env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 5 && seg[1] && seg[2] === "competitors" && seg[3] && seg[4] === "confirm" && method === "POST") {
        return json(await competitorsConfirm(env, user.id, seg[1], seg[3]), 200, origin);
      }
      if (seg.length === 4 && seg[1] && seg[2] === "competitors" && seg[3] && method === "DELETE") {
        return json(await competitorsRemove(env, user.id, seg[1], seg[3]), 200, origin);
      }
      // portfolio (storefront-intel PRD 05): the seller's other apps, suggested.
      if (seg.length === 3 && seg[1] && seg[2] === "portfolio" && method === "GET") {
        return json(await appPortfolio(env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "deltas" && method === "GET") {
        return json(await appDeltas(env, user.id, seg[1]), 200, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "war-room" && method === "GET") {
        return json(await warRoom(env, user.id, seg[1], url), 200, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "share-card.svg" && method === "GET") {
        return await shareCardRoute(env, user.id, seg[1], url, origin);
      }
    }

    // /play ... (Google Play credential check — service account in the body)
    if (seg[0] === "play") {
      if (seg.length === 2 && seg[1] === "verify" && method === "POST") {
        return json(await playVerifyRoute(req, env, user.id), 200, origin);
      }
    }

    // /runs ...
    if (seg[0] === "runs" && seg.length >= 2 && seg[1]) {
      const runId = seg[1];
      if (seg.length === 2 && method === "GET") {
        return json(await getRunRoute(env, user.id, runId), 200, origin);
      }
      if (seg.length === 3 && method === "POST" && (seg[2] === "approve" || seg[2] === "reject")) {
        return json(await decideRun(req, env, user.id, runId, seg[2]), 200, origin);
      }
      if (seg.length === 3 && seg[2] === "localize" && method === "POST") {
        return json(await localizeRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "localize" && seg[3] === "approve" && method === "POST") {
        return json(await localizeApproveRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "localize" && seg[3] && method === "DELETE") {
        return json(await localizeDeleteRoute(env, user.id, runId, seg[3]), 200, origin);
      }
      if (seg.length === 3 && seg[2] === "push-commands" && method === "GET") {
        return json(await pushCommandsRoute(env, user.id, runId), 200, origin);
      }
      if (seg.length === 3 && seg[2] === "fastlane.zip" && method === "GET") {
        return await fastlaneZipRoute(env, user.id, runId, origin);
      }
      if (seg.length === 4 && seg[2] === "asc" && seg[3] === "verify" && method === "POST") {
        return json(await ascVerifyRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "asc" && seg[3] === "push" && method === "POST") {
        return json(await ascPushRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "asc" && seg[3] === "create-version" && method === "POST") {
        return json(await ascCreateVersionRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "asc" && seg[3] === "push-locale" && method === "POST") {
        return json(await ascPushLocaleRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "asc" && seg[3] === "create-localization" && method === "POST") {
        return json(await ascCreateLocalizationRoute(req, env, user.id, runId), 200, origin);
      }
      if (seg.length === 4 && seg[2] === "github" && seg[3] === "pr" && method === "POST") {
        return json(await githubPrRoute(env, user.id, runId), 200, origin);
      }
    }

    return json({ error: "not found", path: url.pathname }, 404, origin);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, origin);
    // Log the real error server-side; return a generic message so unexpected
    // exception text is never echoed to the client.
    console.error("unhandled error (authed routes):", e);
    return json({ error: "internal error" }, 500, origin);
  }
}

export type { ProposedCopy };
