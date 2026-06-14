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
 *                           approve → status 'shipped' + returns push COMMANDS
 *                           (we hand off commands, we never execute them)
 */
import {
  type AgentResult,
  type AppCandidate,
  type ProposedCopy,
  lookup,
  resolveAppQuery,
  runAgent,
} from "../engine/index.js";
import type { ReasoningTrace } from "../d1.js";
import {
  countAppsForUser,
  createApp,
  getApp,
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
import { fetchForEnv } from "../fetchAdapter.js";
import { buildFastlaneBundle } from "../engine/fastlane.js";
import { zipStore } from "../engine/zip.js";
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
    "access-control-allow-methods": "GET,POST,OPTIONS",
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
 * run has been approved (status 'shipped'/'approved'). Before that they are
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
    result: {
      audit: trace.audit,
      ranks: trace.ranks,
      competitors: trace.competitors,
      reasoning: trace.reasoning,
      proposedCopy: trace.proposedCopy,
      // approval gate: commands withheld until the human approves.
      pushCommands: approved ? trace.pushCommands : [],
    },
  };
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
  const body = await readJson<{ query?: string; country?: string }>(req);
  const query = body.query?.trim();
  if (!query) throw new HttpError(400, "query is required");
  const country = body.country?.trim() || env.DEFAULT_COUNTRY || "US";
  const res = await resolveAppQuery(fetchForEnv(env), query, { country });
  return {
    kind: res.kind, // "resolved" | "candidates" | "not-found"
    query: res.query,
    candidates: res.candidates.map(candidateView),
  };
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

  const input = buildAppInput(app, overrides, {});
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
      if (a.latest_run_id) {
        const run = await getRun(env.DB, a.latest_run_id);
        if (run) {
          latest_run = { id: run.id, status: run.status, created_at: run.created_at };
          const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
          rank_summary = rankSummary(trace.ranks);
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

  const input = buildAppInput(app, overrides, previous);
  const result = await runAgent(fetchForEnv(env), input);
  const runId = await persistRun(env.DB, {
    appId: app.id,
    status: "awaiting_approval",
    result,
    trigger: { source: "manual", reasons: ["manual run requested"] },
  });

  // The dashboard reads `id` and navigates to #/runs/:id.
  return { id: runId, status: "awaiting_approval", digest: result.competitors.digest };
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
 * working). approve → status 'shipped' + reveals the generated push commands
 * (which we still never execute); reject → status 'rejected', nothing pushed.
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

  // approved → status is now 'shipped'; return the generated, NON-executed
  // push command handoff so the client can copy + run it on a credentialed box.
  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  return {
    id: runId,
    status: "shipped",
    note: "Approved. Run these commands yourself — we never hold your store credentials.",
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

// ── billing ────────────────────────────────────────────────────────────────────

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
  if (!env.STRIPE_TEST_KEY) throw new HttpError(503, "billing is not configured");
  const body = await readJson<CheckoutBody>(req);
  const tier = body.tier?.trim();
  if (tier !== "launch" && tier !== "autopilot" && tier !== "fleet") {
    throw new HttpError(400, "tier must be one of: launch, autopilot, fleet");
  }
  const base = authBaseUrl(req, env);
  try {
    const session = await createCheckoutSession(fetch, {
      secretKey: env.STRIPE_TEST_KEY,
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
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, origin, env);
    return json({ error: "internal error", detail: String(e) }, 500, origin, env);
  }

  try {
    const user = await requireUser(req, env);

    // /billing/checkout — authenticated (the buyer is the signed-in user)
    if (seg[0] === "billing" && seg[1] === "checkout" && seg.length === 2 && method === "POST") {
      return json(await billingCheckout(req, env, user), 200, origin, env);
    }

    // /resolve — query → candidates (no connect, no run)
    if (seg[0] === "resolve" && seg.length === 1 && method === "POST") {
      return json(await resolveQuery(req, env), 200, origin);
    }

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
      }
      if (seg.length === 3 && seg[1] && seg[2] === "run" && method === "POST") {
        return json(await runApp(req, env, user.id, seg[1]), 201, origin);
      }
      if (seg.length === 3 && seg[1] && seg[2] === "ranks" && method === "GET") {
        return json(await appRanks(env, user.id, seg[1], url), 200, origin);
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
    }

    return json({ error: "not found", path: url.pathname }, 404, origin);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, origin);
    return json({ error: "internal error", detail: String(e) }, 500, origin);
  }
}

export type { ProposedCopy };
