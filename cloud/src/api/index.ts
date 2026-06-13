/**
 * store-ops REST API — a plain Cloudflare Workers fetch handler (no framework,
 * zero extra deps). Routed from `src/index.ts`. Talks to D1 via `../d1.js` and
 * runs the ASO loop via the engine's `runAgent`.
 *
 * AUTH (STUBBED, documented): every request identifies the user by the
 * `X-User-Email` header — a magic-link stand-in for the demo. The header value
 * get-or-creates a `users` row (see `upsertUser`). No password, no session
 * crypto in the demo path; `SESSION_SECRET` is reserved for signing real tokens
 * later. All app/run access is scoped to that user — you can't read another
 * user's app or run.
 *
 * CORS: permissive for the Pages dashboard origin (configurable via the
 * `Origin` echo). Preflight handled.
 *
 * ROUTES:
 *   POST /apps              connect an app {bundle_id, name?, country?} → resolves
 *                           the live listing, creates the app row, runs the agent
 *                           once, stores run+proposals+snapshots (awaiting_approval)
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
  type ProposedCopy,
  lookup,
  runAgent,
} from "../engine/index.js";
import type { ReasoningTrace } from "../d1.js";
import {
  createApp,
  getApp,
  getApproval,
  getLatestCompetitorMap,
  getRankHistory,
  getRun,
  listAppsForUser,
  listRunsForApp,
  persistRun,
  recordApproval,
  upsertUser,
} from "../d1.js";
import { buildAppInput, type RunOverrides } from "./runConfig.js";
import { workerFetch } from "../fetchAdapter.js";
import type { Env } from "../index.js";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const JSON_HEADERS = { "content-type": "application/json" } as const;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-user-email",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin) },
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

// ── auth (stubbed) ─────────────────────────────────────────────────────────────

/** Identify the user from X-User-Email (magic-link stand-in). Get-or-create. */
async function requireUser(req: Request, env: Env): Promise<{ id: string; email: string }> {
  const email = req.headers.get("x-user-email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new HttpError(401, "missing X-User-Email header (stubbed auth)");
  }
  const user = await upsertUser(env.DB, email);
  return { id: user.id, email: user.email };
}

/** Load an app and assert it belongs to this user. */
async function requireOwnedApp(env: Env, appId: string, userId: string) {
  const app = await getApp(env.DB, appId);
  if (!app || app.user_id !== userId) throw new HttpError(404, "app not found");
  return app;
}

// ── route handlers ─────────────────────────────────────────────────────────────

type ConnectBody = { bundle_id?: string; name?: string; country?: string } & RunOverrides;

/** POST /apps — connect + initial run. */
async function connectApp(req: Request, env: Env, userId: string): Promise<unknown> {
  const body = await readJson<ConnectBody>(req);
  const bundleId = body.bundle_id?.trim();
  if (!bundleId) throw new HttpError(400, "bundle_id is required");
  const country = body.country?.trim() || env.DEFAULT_COUNTRY || "US";

  // Look up the live listing up front so we store the RICH name (e.g. "Heathen -
  // Secular Meditation" + its genres) — this is what the keyword seeder reads, so
  // a bare connect still yields a real keyword set, not just the brand word.
  const live = await lookup(workerFetch, bundleId, { by: "bundleId", country });
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
  const result: AgentResult = await runAgent(workerFetch, input);
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
  const result = await runAgent(workerFetch, input);
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

// ── router ─────────────────────────────────────────────────────────────────────

/** Match `/runs/:id/approve` style paths into [segments]. */
function segments(pathname: string): string[] {
  return pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(req.url);
  const seg = segments(url.pathname);
  const method = req.method;

  // health / root
  if (seg.length === 0) {
    return json({ ok: true, service: "store-ops", env: env.APP_ENV }, 200, origin);
  }

  try {
    const user = await requireUser(req, env);

    // /apps ...
    if (seg[0] === "apps") {
      if (seg.length === 1) {
        if (method === "POST") return json(await connectApp(req, env, user.id), 201, origin);
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
    }

    return json({ error: "not found", path: url.pathname }, 404, origin);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, origin);
    return json({ error: "internal error", detail: String(e) }, 500, origin);
  }
}

export type { ProposedCopy };
