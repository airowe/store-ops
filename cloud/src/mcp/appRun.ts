/**
 * Shared read-only "resolve → run agent" helper for the MCP tools (#93).
 *
 * The MCP read tools (audit_app, keyword_gaps, rank_check, …) all need the same
 * thing the PUBLIC /preview route already does: take whatever the caller typed
 * (an app name, a store URL, a numeric id, or a bundle id), resolve it to ONE
 * connectable app off the live store, and run the agent over it — with NO DB
 * write and NO store push. This module factors that pipeline out so every tool
 * (and the existing preview route, if it ever adopts it) shares one tested path.
 *
 * Like the rest of the engine, the network call is an INJECTED `FetchFn`, so the
 * whole helper unit-tests without a runtime (see appRun.spec.ts).
 */
import {
  type AgentResult,
  type AppCandidate,
  type FetchFn,
  type PlayAudit,
  auditPlayListing,
  classifyQuery,
  lookup,
  playAdapter,
  playWebSource,
  resolveAppQuery,
  runAgent,
} from "../engine/index.js";
import type { AppRow } from "../d1.js";
import { buildAppInput, type RunOverrides } from "../api/runConfig.js";

/** A single app resolved from a free-form query or a bare bundle id. */
export type ResolvedApp = { bundleId: string; name: string; country: string };

/**
 * The outcome of resolving a caller's query. `resolved` carries the one app we'll
 * run against; `candidates` means the query was ambiguous (the caller must pick a
 * bundle id and call again); `not-found` means nothing matched. This mirrors the
 * /preview + /resolve contract so an agent gets the same honest "which one?"
 * instead of us silently running the wrong app.
 */
export type ResolveOutcome =
  | { kind: "resolved"; app: ResolvedApp }
  | { kind: "candidates"; query: string; candidates: AppCandidate[] }
  | { kind: "not-found"; query: string };

/**
 * Resolve a free-form `query` OR an exact `bundleId` to a single connectable app,
 * WITHOUT connecting or writing anything. When given a bare bundle id we still hit
 * the live listing so the run seeds from the rich name + genres (same reason
 * connectApp/previewApp do), not a tokenized bundle id.
 */
export async function resolveOne(
  fetchFn: FetchFn,
  input: { query?: string | undefined; bundleId?: string | undefined; country: string },
): Promise<ResolveOutcome> {
  const country = input.country;
  const bundleId = input.bundleId?.trim();
  if (bundleId) {
    const live = await lookup(fetchFn, bundleId, { by: "bundleId", country });
    const name = [live.name, live.genres].filter(Boolean).join(" ").trim() || bundleId;
    return { kind: "resolved", app: { bundleId, name, country } };
  }

  const query = input.query?.trim();
  if (!query) throw new Error("query or bundleId is required");
  const res = await resolveAppQuery(fetchFn, query, { country });
  if (res.kind === "not-found") return { kind: "not-found", query };
  if (res.kind === "candidates") {
    return { kind: "candidates", query, candidates: res.candidates };
  }
  const top = res.candidates[0];
  if (!top?.bundleId) return { kind: "not-found", query };
  const name = [top.name, (top.genres ?? []).join(" ")].filter(Boolean).join(" ").trim() || top.bundleId;
  return { kind: "resolved", app: { bundleId: top.bundleId, name, country } };
}

/**
 * Run the READ-ONLY public agent over a resolved app and return the full
 * AgentResult (audit / ranks / competitors / reasoning / proposedCopy DRAFT /
 * keywordGaps). This is exactly the engine pass previewApp drives: a throwaway
 * app row (never persisted), `buildAppInput`, then `runAgent`. No DB, no push.
 *
 * `reasoner` is optional (the Workers-AI keyword reasoner). When absent the run
 * degrades to the deterministic classifier — a missing binding never breaks it.
 */
export async function runReadOnlyAgent(
  fetchFn: FetchFn,
  opts: { app: ResolvedApp; reasoner?: RunOverrides["reasoner"] | undefined },
): Promise<AgentResult> {
  // A throwaway row just to drive the engine — never written to D1.
  const appRow = {
    id: "mcp",
    user_id: "mcp",
    bundle_id: opts.app.bundleId,
    name: opts.app.name,
    country: opts.app.country,
    created_at: "",
  } satisfies AppRow;
  const overrides: RunOverrides = {};
  if (opts.reasoner) overrides.reasoner = opts.reasoner;
  const input = await buildAppInput(appRow, overrides, {});
  return runAgent(fetchFn, input);
}

/** Resolved Play audit, or an honest not-found (Play has no public name search). */
export type PlayAuditOutcome =
  | { kind: "resolved"; audit: PlayAudit }
  | { kind: "not-found"; query: string };

/**
 * Read-only Google Play audit — the Android sibling of `runReadOnlyAgent`.
 *
 * Resolves a Play PACKAGE id or a `play.google.com/...?id=` URL (a free-text name
 * returns `not-found`, never a fabricated match — Play has no public name search),
 * reads the public listing via our own provider, and runs the full Play audit
 * (`auditPlayListing`). No DB, no push. The network call is the injected `FetchFn`,
 * so it unit-tests without a runtime.
 */
export async function runReadOnlyPlayAudit(
  fetchFn: FetchFn,
  input: {
    query?: string | undefined;
    packageName?: string | undefined;
    country?: string | undefined;
    targets?: string[] | undefined;
    brand?: string | undefined;
  },
): Promise<PlayAuditOutcome> {
  const adapter = playAdapter(playWebSource(fetchFn));
  let pkg = input.packageName?.trim();
  if (!pkg) {
    const query = input.query?.trim();
    if (!query) throw new Error("query or packageName is required");
    // A dotted package id or a Play URL classifies as "bundle-id"; a numeric App
    // Store id or a plain name is not a resolvable Play package here.
    const q = classifyQuery(query);
    if (q.kind !== "bundle-id") return { kind: "not-found", query };
    pkg = q.id;
  }
  const audit = await auditPlayListing(adapter, pkg, {
    ...(input.country ? { country: input.country } : {}),
    ...(input.targets ? { targets: input.targets } : {}),
    ...(input.brand ? { brand: input.brand } : {}),
  });
  return { kind: "resolved", audit };
}
