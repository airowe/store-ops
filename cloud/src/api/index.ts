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
 * verified). Tier gates: free/launch = manual only + 1 app; autopilot/fleet =
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
 *   POST /auth/logout       clear the session cookie.
 *   GET  /auth/me           { authed, via:"session"|"demo", email? } — the
 *                           dashboard's boot check (login screen vs app).
 *   POST /billing/checkout  {tier} → create a Stripe Checkout Session, return
 *                           {url}. tier ∈ launch|autopilot|fleet.
 *   POST /billing/webhook   Stripe events → update the user's tier/status. The
 *                           Stripe-Signature header is verified (raw body HMAC).
 *   POST /subscribe         public launch-list capture (HTML form → 303 back, or
 *                           JSON → 200). Idempotent on email; no auth.
 *   GET  /proof             public anonymized aggregate proof (rank-win numbers
 *                           for the landing). No app/user data. Cached 1h.
 *   GET  /health            authed production-readiness audit (200 ready / 503
 *                           when an error-severity check fails). Not public.
 *   GET  /portfolio         Fleet-tier roll-up: every app's grade / lead rank /
 *                           pending-approval + summary counts (402 below Fleet).
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
  type ProposedCopy,
  type PushInput,
  type WarRoomRankSnapshot,
  buildWarRoom,
  lookup,
  rankOpportunities,
  ranksFor,
  resolveAppQuery,
  resolveNameToBundle,
  runAgent,
} from "../engine/index.js";
import type { ReasoningTrace, AppRow, FindingsSummary } from "../d1.js";
import { buildPreview } from "../engine/preview.js";
import {
  countAppsForUser,
  createApp,
  deleteApp,
  getApp,
  getUser,
  getApproval,
  getLatestCompetitorMap,
  getRankHistory,
  getRun,
  getTier,
  getUserByStripeCustomer,
  listAllApps,
  listAppsForUser,
  listRunsForApp,
  persistRun,
  recordApproval,
  recordSubscriber,
  setGithubConnection,
  setTier,
  upsertUser,
} from "../d1.js";
import {
  mintMagicToken,
  mintSessionToken,
  parseCookie,
  resolveSessionSecret,
  serializeLogoutCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
  verifyMagicToken,
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
import { buildAppInput, type RunOverrides } from "./runConfig.js";
import { reasonerForEnv } from "./aiReasoner.js";
import { fetchForEnv } from "../fetchAdapter.js";
import { buildFastlaneBundle } from "../engine/fastlane.js";
import { zipStore } from "../engine/zip.js";
import { mintAscJwt } from "../engine/ascJwt.js";
import { findAscAppId, applyAscMetadata, readAscLocalization, AscWriteError } from "../engine/ascWrite.js";
import { readAscSnapshot, ascScreenshotsToListing, type AscSnapshot } from "../engine/ascRead.js";
import { score as scoreScreenshots } from "../engine/screenshotScore.js";
import { auditFindings, summarizeFindings } from "../engine/auditFindings.js";
import { buildAscContext } from "../engine/ascContext.js";
import { metadataCoverage } from "../engine/metadataCoverage.js";
import { recommendLocales } from "../engine/localizationExpansion.js";
import { mintAppJwt, installationToken, GithubAppError } from "../engine/githubApp.js";
import { openMetadataPr } from "../engine/githubPr.js";
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
    "access-control-allow-headers": "content-type,x-user-email,stripe-signature",
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
  };
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
  const ranks = [
    ...prior.map((r) => ({ keyword: r.keyword, rank: r.rank, total: r.total, checked_at: r.checked_at })),
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
 *   2. the X-User-Email header — ONLY in APP_ENV==="demo" (keeps the live demo +
 *      existing tests working), else
 *   3. 401.
 * In both valid paths the email get-or-creates the `users` row.
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

  // (2) demo-only header fallback
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
async function authRequest(req: Request, env: Env): Promise<unknown> {
  const body = await readJson<{ email?: string }>(req);
  const email = body.email?.trim().toLowerCase();
  if (email && email.includes("@")) {
    const token = await mintMagicToken(sessionSecret(env), email, {
      ttlSeconds: MAGIC_LINK_TTL_SECONDS,
    });
    const base = new URL(req.url).origin; // callback is served by THIS worker
    const link = `${base}/auth/callback?token=${encodeURIComponent(token)}`;
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
    headers: { ...corsHeaders(origin, env), "set-cookie": cookie, location: authBaseUrl(req, env) },
  });
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
  const jar = parseCookie(req.headers.get("Cookie"));
  const token = jar[SESSION_COOKIE];
  if (token) {
    const res = await verifySessionToken(sessionSecret(env), token);
    if (res.ok) return json({ authed: true, via: "session", email: res.email }, 200, origin, env);
  }
  if (env.APP_ENV === "demo") {
    const email = req.headers.get("x-user-email")?.trim().toLowerCase();
    if (email && email.includes("@")) {
      return json({ authed: true, via: "demo", email }, 200, origin, env);
    }
  }
  return json({ authed: false }, 200, origin, env);
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
 * GET /portfolio — the Fleet "one glance" roll-up: every app with its grade,
 * lead rank, and pending-approval flag, plus the summary counts. Fleet-tier
 * gated (it's the agency/multi-app view). Pure shaping is summarizePortfolio;
 * here we assemble the cards from each app's latest run.
 */
async function portfolioView(env: Env, userId: string): Promise<unknown> {
  const tier = await getTier(env.DB, userId);
  if (tier !== "fleet") {
    throw new HttpError(402, "the portfolio view is a Fleet feature — upgrade to Fleet Autopilot");
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
 * user's apps (a Fleet ergonomic). planBulkApprove decides approvability
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

  // Run the agent once so the connected app immediately has live data + a
  // proposal waiting at the gate.
  const overrides: RunOverrides = {};
  if (body.keywords) overrides.keywords = body.keywords;
  if (body.competitors) overrides.competitors = body.competitors;
  if (body.baseCopy) overrides.baseCopy = body.baseCopy;
  const connectReasoner = reasonerForEnv(env.AI);
  if (connectReasoner) overrides.reasoner = connectReasoner;

  const input = await buildAppInput(app, overrides, {});
  const result: AgentResult = await runAgent(fetchForEnv(env), input);
  const runId = await persistRun(env.DB, {
    appId: app.id,
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
  if (body.baseCopy) overrides.baseCopy = body.baseCopy;
  const runReasoner = reasonerForEnv(env.AI);
  if (runReasoner) overrides.reasoner = runReasoner;

  const input = await buildAppInput(app, overrides, previous);
  const result = await runAgent(fetchForEnv(env), input);
  // No-key run: compute the thin (public-only) findings set + the `asc_unlock`
  // CTA. EVERY run carries findings, ASC or not (PRD 02). No snapshot ⇒ no
  // ascContext — only the ASC-read path has one.
  result.findings = auditFindings({
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
  const runId = await persistRun(env.DB, {
    appId: app.id,
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
  const body = (await req.json().catch(() => ({}))) as RunAscBody;
  if (!body.p8 || !body.keyId || !body.issuerId) {
    throw new HttpError(400, "p8, keyId, and issuerId are required");
  }
  const locale = body.locale?.trim() || "en-US";

  // Mint the ephemeral ASC token + read the current live copy.
  let token: string;
  try {
    token = await mintAscJwt({ p8: body.p8, keyId: body.keyId, issuerId: body.issuerId });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "invalid credentials");
  }
  let liveSubtitle: string | undefined;
  let liveKeywords: string | undefined;
  let liveName: string | undefined;
  let ascSnapshot: AscSnapshot | undefined;
  try {
    const ascAppId = await findAscAppId(fetch, token, app.bundle_id);
    const live = await readAscLocalization(fetch, { token, appId: ascAppId, locale });
    liveSubtitle = live.subtitle;
    liveKeywords = live.keywords;
    liveName = live.name;
    // The full pre-launch read: screenshots, previews, appInfo, version state,
    // pricing/IAPs, age rating, custom pages, all locales. Best-effort — a read
    // failure here records a per-surface error but never strands the run.
    try {
      ascSnapshot = await readAscSnapshot(fetch, { token, appId: ascAppId, locale });
    } catch {
      ascSnapshot = undefined;
    }
  } catch (e) {
    // A read failure shouldn't strand the user — fall back to an honest iTunes-only
    // run (subtitle/keywords omitted) and surface the reason.
    if (e instanceof AscWriteError) throw new HttpError(400, `App Store Connect read failed: ${e.message}`);
    throw e;
  }

  const previous = await getLatestCompetitorMap(env.DB, appId);
  const overrides: RunOverrides = { ascMetadataRead: true };
  if (body.keywords) overrides.keywords = body.keywords;
  if (body.competitors) overrides.competitors = body.competitors;
  // baseCopy carries the LIVE values read from ASC (the optimizer's floor).
  // We reached here via a SUCCESSFUL ASC localization read, so subtitle/keywords
  // were READ — an `undefined` from the read means the field is EMPTY on the
  // listing, NOT unknown. Coalesce read-but-empty to "" so it propagates as
  // seen-but-empty ("empty"), never collapsing into the false "unseen" state
  // (the honesty bug: an app with no subtitle showed "unseen" instead of "empty",
  // and an empty keyword field was backfilled with derived guesses shown as live).
  overrides.baseCopy = {
    ...(liveName !== undefined ? { name: liveName } : {}),
    subtitle: liveSubtitle ?? "",
    keywords: liveKeywords ?? "",
    ...(body.baseCopy ?? {}),
  };
  const ascReasoner = reasonerForEnv(env.AI);
  if (ascReasoner) overrides.reasoner = ascReasoner;

  const input = await buildAppInput(app, overrides, previous);
  const result = await runAgent(fetchForEnv(env), input);
  // #44: if we read REAL screenshots from ASC, re-score the audit with them
  // (dataReliable:true) so the grade is genuine — not the public-iTunes "unknown".
  const ascListing = ascScreenshotsToListing(ascSnapshot?.screenshots);
  if (ascListing) {
    result.audit.screenshots = scoreScreenshots(input.app, ascListing);
  }
  // Mode-A run: compute the FULL findings set from the already-read snapshot
  // (no new ASC calls) + the screenshot re-score above, plus the slim PII-safe
  // ascContext. The raw snapshot stays server-side; ONLY findings + ascContext
  // reach the client (PRD 02 privacy boundary).
  result.findings = auditFindings({
    snapshot: ascSnapshot,
    audit: result.audit,
    ranks: result.ranks,
    appName: app.name,
    hasAscKey: true,
  });
  const ascContext = buildAscContext(ascSnapshot);
  if (ascContext !== undefined) result.ascContext = ascContext;
  // PRD 06: winnability opportunities — "where to push next." Same pure compute as
  // the no-key path; serves curated copy + drivers only (no raw ASC data).
  await attachOpportunities(env, app.id, result);
  // PRD 03: metadata coverage from the LIVE copy we read from ASC (name + subtitle
  // + keyword field) — the richest input, so duplicate/brand_repeat/filler waste is
  // fully populated. Curated counts + copy only; no raw ASC crosses the boundary.
  result.coverage = coverageForRun(result.currentCopy, app.name);
  // PRD 04 — localization expansion. From the locales we just read + the category,
  // recommend the highest-ROI markets to expand into (a STATIC, bundled heuristic —
  // no live install data, no new ASC call). Derived only from locale codes + the
  // category NAME, so it's PII-safe and reaches the client (findings-only boundary
  // intact). Only when we actually read the locale set.
  const liveLocaleRows = (ascSnapshot?.locales ?? []) as Array<{ locale?: string | undefined }>;
  const liveLocales = liveLocaleRows
    .map((l) => l.locale)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  if (liveLocales.length > 0) {
    const category = ascSnapshot?.appInfo?.primaryCategory?.name;
    const recs = recommendLocales({
      liveLocales,
      ...(category !== undefined ? { category } : {}),
    });
    if (recs.length > 0) result.localizationExpansion = recs;
  }
  // Attach the full ASC snapshot to the result so the run carries the rich data
  // SERVER-SIDE only — persistRun deliberately does NOT copy it onto the trace,
  // so it never reaches the client (the snapshot stays for future server use).
  const resultWithSnapshot = ascSnapshot ? { ...result, ascSnapshot } : result;
  const runId = await persistRun(env.DB, {
    appId: app.id,
    status: "awaiting_approval",
    result: resultWithSnapshot,
    trigger: { source: "manual", reasons: ["manual run requested (App Store Connect read)"] },
  });
  return { id: runId, status: "awaiting_approval", digest: result.competitors.digest, ascRead: true };
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

  if (!keyword) return { keyword: "", points: [] };

  const history = await getRankHistory(env.DB, appId, { keyword });
  const points = history.map((s) => ({
    rank: s.rank,
    total: s.total,
    checked_at: s.checked_at,
  }));
  return { keyword, points };
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
  return rankDeltasView(history, { appName: app.name, pushes });
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

type ApproveBody = { decision?: string };

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
  await requireOwnedApp(env, run.app_id, userId);

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

  await recordApproval(env.DB, { runId, decision });

  if (decision === "rejected") {
    return { id: runId, status: "rejected", pushCommands: [] };
  }

  // approved → status is now 'approved' (NOT 'shipped' — nothing has reached
  // App Store Connect yet); return the generated, NON-executed push command
  // handoff so the client can copy + run it on a credentialed box.
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  return {
    id: runId,
    status: "approved",
    note: "Approved. Hand the metadata to your build pipeline (credential-free), or apply it yourself — ShipASO never stores your store credentials.",
    pushCommands: trace.pushCommands,
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
  const bundle = buildFastlaneBundle(trace.proposedCopy);
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

type AscPushBody = AscVerifyBody & { locale?: string };

/**
 * POST /runs/:id/asc/push — opt-in direct App Store Connect metadata WRITE (#11).
 *
 * Gated behind ASC_WRITE_ENABLED (unset → 403; the credential-free Fastlane
 * handoff is the default). Only an APPROVED run may push. The user uploads their
 * `.p8` + key/issuer id; the Worker mints a short-lived ES256 JWT, resolves the
 * ASC app id from the bundle id, finds the editable version's localization, and
 * PATCHes the approved copy. The `.p8` is used in-request and NEVER persisted or
 * logged; only non-empty fields are pushed (a blank never wipes live metadata).
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
  if (!body.p8 || !body.keyId || !body.issuerId) {
    throw new HttpError(400, "p8, keyId, and issuerId are required");
  }
  const locale = body.locale?.trim() || "en-US";

  let token: string;
  try {
    token = await mintAscJwt({ p8: body.p8, keyId: body.keyId, issuerId: body.issuerId });
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
    });
    return result; // { ok: true, versionId, localizationId, fieldsPushed }
  } catch (e) {
    if (e instanceof AscWriteError) return { ok: false, reason: e.message };
    throw e;
  }
}

/** Truthy flag parse for opt-in env switches. */
function isFlagOn(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
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
  if (env.STRIPE_PRICE_LAUNCH !== undefined) prices.STRIPE_PRICE_LAUNCH = env.STRIPE_PRICE_LAUNCH;
  if (env.STRIPE_PRICE_AUTOPILOT !== undefined)
    prices.STRIPE_PRICE_AUTOPILOT = env.STRIPE_PRICE_AUTOPILOT;
  if (env.STRIPE_PRICE_FLEET !== undefined) prices.STRIPE_PRICE_FLEET = env.STRIPE_PRICE_FLEET;
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
  if (tier !== "launch" && tier !== "autopilot" && tier !== "fleet") {
    throw new HttpError(400, "tier must be one of: launch, autopilot, fleet");
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
    // price here. For the one-time LAUNCH purchase (mode=payment) we set the tier
    // now (it has no subscription to sync later). Subscription tiers
    // (autopilot/fleet) are set authoritatively from customer.subscription.updated,
    // which fires right after with the price; here we just persist the Stripe ids.
    const tier = obj.mode === "payment" ? "launch" : null;
    if (userId) {
      await setTier(env.DB, {
        userId,
        ...(tier ? { tier } : {}),
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

export async function handleApi(req: Request, env: Env): Promise<Response> {
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
      if (seg[1] === "logout" && seg.length === 2 && method === "POST") {
        return authLogout(origin, env);
      }
      if (seg[1] === "me" && seg.length === 2 && method === "GET") {
        return authMe(req, env, origin);
      }
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
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, origin, env);
    // Log the real error server-side; return a generic message so unexpected
    // exception text is never echoed to the client.
    console.error("unhandled error (public routes):", e);
    return json({ error: "internal error" }, 500, origin, env);
  }

  try {
    const user = await requireUser(req, env);

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

    // /portfolio — the Fleet roll-up across all of the user's apps
    if (seg[0] === "portfolio" && seg.length === 1 && method === "GET") {
      return json(await portfolioView(env, user.id), 200, origin, env);
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
      if (seg.length === 3 && seg[1] && seg[2] === "ranks" && method === "GET") {
        return json(await appRanks(env, user.id, seg[1], url), 200, origin);
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

    // /runs ...
    if (seg[0] === "runs" && seg.length >= 2 && seg[1]) {
      const runId = seg[1];
      if (seg.length === 2 && method === "GET") {
        return json(await getRunRoute(env, user.id, runId), 200, origin);
      }
      if (seg.length === 3 && method === "POST" && (seg[2] === "approve" || seg[2] === "reject")) {
        return json(await decideRun(req, env, user.id, runId, seg[2]), 200, origin);
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
