/**
 * ShipASO MCP tool registry (#93) — the single source of truth mapping each MCP
 * tool to the EXISTING, tested engine functions. No new ASO logic lives here;
 * this is a transport/adapter layer.
 *
 * SAFETY INVARIANT (test-enforced in tools.spec.ts): every tool is read-or-draft.
 * The `readOnly: true` LITERAL on each def is a compile-time guarantee, and the
 * spec asserts it at runtime — there is intentionally NO way to register a tool
 * that writes, persists, or pushes. The irreversible store-push step stays a
 * human-gated UI action (and #34 is never auto-built). `propose_copy` returns a
 * DRAFT only: it never persists a proposal or emits a push command.
 */
import { z } from "zod";
import {
  buildWarRoom,
  playChartSource,
  ranksFor,
  rankOpportunities,
  resolveNameToBundle,
  type RankSnapshot,
  type WarRoomRankSnapshot,
} from "../engine/index.js";
import { auditFindings, summarizeFindings } from "../engine/auditFindings.js";
import { buildPreview } from "../engine/preview.js";
import { fetchForEnv, fetchLikeForEnv } from "../fetchAdapter.js";
import { reasonerForEnv } from "../api/aiReasoner.js";
import { getApp, getRankHistory, getRun, listAllApps, listRunsForApp } from "../d1.js";
import type { ReasoningTrace } from "../d1.js";
import { extractWins, aggregateProof } from "../proof.js";
import type { Env } from "../index.js";
import {
  resolveOne,
  runReadOnlyAgent,
  runReadOnlyPlayAudit,
  runReadOnlyPlayAuditConnected,
  type ResolvedApp,
} from "./appRun.js";
import type { FetchLike, GoogleServiceAccount } from "../engine/index.js";

const MAX_WAR_ROOM_COMPETITORS = 4;

/** The per-request context every tool handler receives (the authed caller). */
export type ToolContext = {
  env: Env;
  user: { id: string; email: string };
};

/**
 * A registered MCP tool. `readOnly: true` is a LITERAL (not `boolean`) so the type
 * system itself forbids a mutating tool from entering the registry; the spec
 * double-checks at runtime. `inputSchema` is a Zod raw shape (the SDK turns it
 * into the JSON Schema clients see).
 */
export type McpToolDef = {
  name: string;
  description: string;
  readOnly: true;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

// ── shared input fragments ──────────────────────────────────────────────────────

/** A target-app selector shared by the resolve-driven tools. */
const appSelector = {
  query: z.string().optional().describe("App name, App Store URL, numeric id, or bundle id"),
  bundleId: z.string().optional().describe("Exact bundle id (skips resolution)"),
  country: z.string().length(2).optional().describe("ISO country storefront, e.g. US"),
};

/**
 * A Google Play target selector. Play has NO public name search, so the selector
 * takes a package id or a play.google.com URL — never a free-text app name.
 */
const playAppSelector = {
  query: z
    .string()
    .optional()
    .describe("Google Play package id (com.foo.bar) or a play.google.com app URL"),
  packageName: z.string().optional().describe("Exact Play package id (skips resolution)"),
  country: z.string().length(2).optional().describe("ISO country storefront, e.g. US"),
  targets: z
    .array(z.string())
    .optional()
    .describe("Target search terms to measure long-description coverage for"),
  brand: z
    .string()
    .optional()
    .describe("App brand name, so brand-burn in the short description is flagged"),
};

function country(env: Env, args: Record<string, unknown>): string {
  const c = typeof args.country === "string" ? args.country.trim() : "";
  return c || env.DEFAULT_COUNTRY || "US";
}

/**
 * Resolve the caller's app selector to ONE app, then run the read-only public
 * agent over it. Ambiguous / not-found resolutions throw an honest, actionable
 * error (the agent re-calls with a `bundleId`) rather than silently running the
 * wrong app. `competitors` is threaded through for competitor_watch.
 */
async function resolveAndRun(
  args: Record<string, unknown>,
  ctx: ToolContext,
  opts: { competitors?: string[] } = {},
): Promise<{ app: ResolvedApp; result: Awaited<ReturnType<typeof runReadOnlyAgent>> }> {
  const fetchFn = fetchForEnv(ctx.env);
  const out = await resolveOne(fetchFn, {
    query: typeof args.query === "string" ? args.query : undefined,
    bundleId: typeof args.bundleId === "string" ? args.bundleId : undefined,
    country: country(ctx.env, args),
  });
  if (out.kind === "not-found") {
    throw new Error(`No app found for "${out.query}". Try a bundle id or a more specific name.`);
  }
  if (out.kind === "candidates") {
    const list = out.candidates
      .slice(0, 5)
      .map((c) => `${c.name} (bundleId: ${c.bundleId})`)
      .join("; ");
    throw new Error(`"${out.query}" is ambiguous — re-call with one bundleId. Candidates: ${list}`);
  }
  const reasoner = reasonerForEnv(ctx.env.AI);
  const result = await runReadOnlyAgent(fetchFn, {
    app: out.app,
    ...(reasoner ? { reasoner } : {}),
    ...(opts.competitors ? { competitors: opts.competitors } : {}),
  });
  return { app: out.app, result };
}

/** Load an app and assert it belongs to the caller (owner-scoped; 404-equivalent). */
async function requireOwnedApp(ctx: ToolContext, appId: string) {
  const app = await getApp(ctx.env.DB, appId);
  if (!app || app.user_id !== ctx.user.id) throw new Error("app not found");
  return app;
}

// ── the registry ────────────────────────────────────────────────────────────────

export const TOOLS: McpToolDef[] = [
  {
    name: "preview_app",
    description:
      "Read-only ASO snapshot of any App Store app (grade, lead rank, top-10 count, " +
      "sample). No account or store push — the optimized copy + push commands stay " +
      "behind the human-approved loop.",
    readOnly: true,
    inputSchema: appSelector,
    async handler(args, ctx) {
      const { result } = await resolveAndRun(args, ctx);
      return buildPreview(result);
    },
  },
  {
    name: "audit_app",
    description:
      "Read-only listing audit: prioritized findings (severity + impact) plus a " +
      "summary, derived from the live public listing. Read-only — never edits or pushes.",
    readOnly: true,
    inputSchema: appSelector,
    async handler(args, ctx) {
      const { app, result } = await resolveAndRun(args, ctx);
      // No ASC key on the public MCP path → the thin (public-only) findings set,
      // exactly as the no-key run path computes them (api runApp).
      const findings = auditFindings({
        audit: result.audit,
        ranks: result.ranks,
        appName: app.name,
        hasAscKey: false,
        ...(result.audit.storefront !== undefined ? { storefront: result.audit.storefront } : {}),
      });
      return { audit: result.audit, findings, summary: summarizeFindings(findings) };
    },
  },
  {
    name: "audit_play_app",
    description:
      "Read-only GOOGLE PLAY listing audit: screenshot grade, the 30/80/4000 " +
      "title/short/long-description budget, target-term coverage in the long " +
      "description (Play's keyword surface), a keyword-stuffing guard, prioritized " +
      "findings + summary, and capability locks for surfaces a public read can't see. " +
      "Takes a Play package id (com.foo.bar) or a play.google.com URL — NOT a " +
      "free-text name (Play has no public name search). Play has NO keyword field. " +
      "Reads public Play data only; never edits or pushes.",
    readOnly: true,
    inputSchema: playAppSelector,
    async handler(args, ctx) {
      const fetchFn = fetchForEnv(ctx.env);
      const targets = Array.isArray(args.targets)
        ? (args.targets as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined;
      const out = await runReadOnlyPlayAudit(fetchFn, {
        query: typeof args.query === "string" ? args.query : undefined,
        packageName: typeof args.packageName === "string" ? args.packageName : undefined,
        country: country(ctx.env, args),
        ...(targets ? { targets } : {}),
        brand: typeof args.brand === "string" ? args.brand : undefined,
        // Keyless category chart rank rides along (degrade-safe): the POST-capable
        // env transport backs the Play `batchexecute` chart read.
        chartSource: playChartSource(fetchLikeForEnv(ctx.env)),
      });
      if (out.kind === "not-found") {
        throw new Error(
          `No Google Play app found for "${out.query}". Provide a package id ` +
            "(com.foo.bar) or a play.google.com URL — Play has no public name search.",
        );
      }
      const a = out.audit;
      return {
        listing: a.listing,
        screenshots: a.screenshots,
        coverage: a.coverage,
        keywords: a.keywords,
        findings: a.findings,
        summary: a.summary,
        locks: a.locks,
      };
    },
  },
  {
    name: "audit_play_app_owner",
    description:
      "Read-only audit of YOUR OWN Google Play app via the official Play Developer " +
      "API — full fidelity including the short description (which the public page " +
      "can't show), with NO capability locks. Requires a configured Play service " +
      "account (GOOGLE_PLAY_SERVICE_ACCOUNT). Reads only — it opens and DISCARDS a " +
      "Play 'edit' and NEVER commits, so it can't publish. Owner-only; for a " +
      "competitor use audit_play_app.",
    readOnly: true,
    inputSchema: {
      packageName: z.string().describe("Your app's Play package id, e.g. com.foo.bar"),
      language: z.string().optional().describe("BCP-47 listing language, e.g. en-US"),
      targets: z
        .array(z.string())
        .optional()
        .describe("Target search terms to measure long-description coverage for"),
      brand: z.string().optional().describe("App brand name, so short-description brand-burn is flagged"),
    },
    async handler(args, ctx) {
      const saJson = (ctx.env as { GOOGLE_PLAY_SERVICE_ACCOUNT?: string }).GOOGLE_PLAY_SERVICE_ACCOUNT;
      if (!saJson) {
        throw new Error(
          "Google Play is not connected — set the GOOGLE_PLAY_SERVICE_ACCOUNT secret " +
            "(a Play Developer API service-account JSON) to audit your own Play app.",
        );
      }
      let serviceAccount: GoogleServiceAccount;
      try {
        serviceAccount = JSON.parse(saJson) as GoogleServiceAccount;
      } catch {
        throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT is not valid JSON.");
      }
      const packageName = String(args.packageName ?? "").trim();
      if (!packageName) throw new Error("packageName is required.");
      const targets = Array.isArray(args.targets)
        ? (args.targets as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined;
      // The Developer API needs a method+body fetch; the Worker's global fetch
      // satisfies FetchLike (googleapis.com is reachable directly).
      const fetchLike: FetchLike = (url, init) => fetch(url, init);
      const audit = await runReadOnlyPlayAuditConnected(fetchLike, serviceAccount, {
        packageName,
        language: typeof args.language === "string" ? args.language : undefined,
        ...(targets ? { targets } : {}),
        brand: typeof args.brand === "string" ? args.brand : undefined,
      });
      return {
        listing: audit.listing,
        screenshots: audit.screenshots,
        coverage: audit.coverage,
        keywords: audit.keywords,
        findings: audit.findings,
        summary: audit.summary,
        locks: audit.locks,
      };
    },
  },
  {
    name: "keyword_gaps",
    description:
      "Read-only keyword opportunities: terms tracked competitors VISIBLY use that " +
      "this app doesn't target and doesn't rank top-50 for, sorted by winnability. " +
      "Inferred from competitor name/subtitle only — never their ranking algorithm.",
    readOnly: true,
    inputSchema: appSelector,
    async handler(args, ctx) {
      const { result } = await resolveAndRun(args, ctx);
      return { keywordGaps: result.keywordGaps ?? [] };
    },
  },
  {
    name: "rank_check",
    description:
      "Read-only organic rank check across the app's target keywords, plus " +
      "winnability-ranked opportunities computed from those measured positions. " +
      "Positions are live-measured, never fabricated.",
    readOnly: true,
    inputSchema: appSelector,
    async handler(args, ctx) {
      const { result } = await resolveAndRun(args, ctx);
      const checkedAt = new Date().toISOString();
      const snaps: RankSnapshot[] = result.ranks.map((r) => ({
        keyword: r.keyword,
        rank: r.rank,
        total: r.total,
        checked_at: checkedAt,
      }));
      return { ranks: result.ranks, opportunities: rankOpportunities({ ranks: snaps }) };
    },
  },
  {
    name: "screenshot_coverage",
    description:
      "Read-only screenshot scoring for the app's live store gallery (count, score, " +
      "grade, levers to improve). Read-only — never uploads or pushes assets.",
    readOnly: true,
    inputSchema: appSelector,
    async handler(args, ctx) {
      const { result } = await resolveAndRun(args, ctx);
      return { screenshots: result.audit.screenshots };
    },
  },
  {
    name: "competitor_watch",
    description:
      "Read-only competitor diff: resolves the named competitors and reports their " +
      "current listings, what changed vs. the last seen state, and a digest line. " +
      "Read-only metadata comparison; no ranking-algorithm data is invented.",
    readOnly: true,
    inputSchema: {
      ...appSelector,
      competitors: z
        .array(z.string())
        .min(1)
        .describe("Competitor app names or bundle ids to compare against"),
    },
    async handler(args, ctx) {
      const competitors = Array.isArray(args.competitors)
        ? (args.competitors as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      const { result } = await resolveAndRun(args, ctx, { competitors });
      return result.competitors;
    },
  },
  {
    name: "war_room",
    description:
      "Read-only head-to-head rank war room for one of YOUR connected apps: your " +
      "tracked-keyword rank history vs. live competitor positions on those same " +
      "keywords. Reads stored data + live competitor ranks; writes nothing.",
    readOnly: true,
    inputSchema: {
      appId: z.string().describe("Id of a connected app you own"),
      competitors: z
        .array(z.string())
        .optional()
        .describe("Competitor names to compare (max 4)"),
    },
    async handler(args, ctx) {
      const appId = String(args.appId ?? "");
      const app = await requireOwnedApp(ctx, appId);
      const selected = Array.isArray(args.competitors)
        ? (args.competitors as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      const names = [...new Set(selected.map((s) => s.trim()).filter(Boolean))].slice(
        0,
        MAX_WAR_ROOM_COMPETITORS,
      );

      const history = await getRankHistory(ctx.env.DB, appId, {});
      const yourRanks: WarRoomRankSnapshot[] = history.map((r) => ({
        keyword: r.keyword,
        rank: r.rank,
        checked_at: r.checked_at,
      }));
      const keywords = [...new Set(history.map((r) => r.keyword))];
      const today = new Date().toISOString().slice(0, 10);

      const fetchFn = fetchForEnv(ctx.env);
      const ctry = app.country || ctx.env.DEFAULT_COUNTRY || "US";
      const competitorRanks: Array<{ name: string; ranks: WarRoomRankSnapshot[] }> = [];
      for (const name of names) {
        let ranks: WarRoomRankSnapshot[] = [];
        if (keywords.length) {
          const compBundle = await resolveNameToBundle(fetchFn, name, { country: ctry });
          if (compBundle) {
            const checked = await ranksFor(fetchFn, compBundle, keywords, { country: ctry });
            ranks = checked
              .filter((r) => !r.error)
              .map((r) => ({ keyword: r.keyword, rank: r.rank, checked_at: today }));
          }
        }
        competitorRanks.push({ name, ranks });
      }
      return {
        appName: app.name,
        warRoom: buildWarRoom({ yourRanks, competitorRanks }),
        competitors: names,
      };
    },
  },
  {
    name: "localization_gaps",
    description:
      "Read-only localization expansion recommendations (ROI-sorted locales to add) " +
      "for one of YOUR connected apps, from its most recent App Store Connect run. " +
      "A static, bundled heuristic over the locales already read — no live install " +
      "data is fabricated. Empty until you've run an ASC-connected pass.",
    readOnly: true,
    inputSchema: {
      appId: z.string().describe("Id of a connected app you own"),
    },
    async handler(args, ctx) {
      const appId = String(args.appId ?? "");
      await requireOwnedApp(ctx, appId);
      const runs = await listRunsForApp(ctx.env.DB, appId);
      for (const r of runs) {
        const run = await getRun(ctx.env.DB, r.id);
        if (!run) continue;
        const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
        if (trace.localizationExpansion && trace.localizationExpansion.length) {
          return { recommendations: trace.localizationExpansion };
        }
      }
      return {
        recommendations: [],
        note: "No localization data yet — run an App Store Connect (keyed) pass to compute it.",
      };
    },
  },
  {
    name: "proof",
    description:
      "Read-only, anonymized aggregate proof across all tracked apps (real rank-win " +
      "numbers — no app names, no user data). This is the 'prove the rank moved' " +
      "surface that closes the prepare → approve → push → prove loop.",
    readOnly: true,
    inputSchema: {},
    async handler(_args, ctx) {
      const apps = await listAllApps(ctx.env.DB);
      const winsByApp = await Promise.all(
        apps.map(async (a) => extractWins(await getRankHistory(ctx.env.DB, a.id))),
      );
      return aggregateProof(winsByApp);
    },
  },
  {
    name: "propose_copy",
    description:
      "Returns a DRAFT optimized listing (name/subtitle/keywords/description) with " +
      "validation for any app. THIS IS A DRAFT ONLY: it does NOT persist a proposal " +
      "and does NOT push to the App Store. Publishing stays a human-approved action " +
      "in ShipASO — an agent can draft and read; only a human approves and pushes.",
    readOnly: true,
    inputSchema: appSelector,
    async handler(args, ctx) {
      const { result } = await resolveAndRun(args, ctx);
      return {
        draft: result.proposedCopy,
        currentCopy: result.currentCopy,
        note: "Draft only — not persisted and not pushed. Approval + push is human-gated in ShipASO.",
      };
    },
  },
];

/** Lookup a tool by name (used by the server dispatch + tests). */
export function toolByName(name: string): McpToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
