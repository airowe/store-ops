/**
 * Typed endpoint wrappers — one function per API route the app uses, each
 * returning a DTO from `types/api`. Thin by design: the client handles auth,
 * errors, and JSON; this layer just names the routes and their shapes so screens
 * never hand-build URLs. Mirrors the web's `app.js` calls against the same API.
 */
import type { ApiClient } from "./client.js";
import type {
  AppDetail,
  AppList,
  AuthExchangeResult,
  AuthRequestResult,
  DeltasView,
  Me,
  PlayAudit,
  PlayVerifyResult,
  PushCommand,
  RanksSeries,
  ResolveResult,
  RunDetail,
} from "../types/api.js";

// ── auth ──────────────────────────────────────────────────────────────────────
export const me = (c: ApiClient) => c.get<Me>("/auth/me");
export const authRequest = (c: ApiClient, email: string) =>
  c.post<AuthRequestResult>("/auth/request", { email });
export const authExchange = (c: ApiClient, token: string) =>
  c.post<AuthExchangeResult>("/auth/exchange", { token });

// ── dashboard: resolve / connect / list ────────────────────────────────────────
export const resolve = (c: ApiClient, query: string, offset = 0) =>
  c.post<ResolveResult>("/resolve", { query, offset });

/** Connect an app. May return a needs-choice payload when the query is ambiguous. */
export type ConnectResult =
  | { id: string; runId?: string; bundleId: string; name: string; country: string; auditGrade: string | null }
  | { needsChoice: true; candidates: ResolveResult["candidates"] };
export const connectApp = (c: ApiClient, body: { bundle_id?: string; query?: string; country?: string }) =>
  c.post<ConnectResult>("/apps", body);

export const listApps = (c: ApiClient) => c.get<AppList>("/apps");

// ── app + run detail (the money screen) ─────────────────────────────────────────
const enc = encodeURIComponent;
export const getApp = (c: ApiClient, id: string) => c.get<AppDetail>(`/apps/${enc(id)}`);
export const getRanks = (c: ApiClient, id: string, keyword?: string) =>
  c.get<RanksSeries>(`/apps/${enc(id)}/ranks${keyword ? `?keyword=${enc(keyword)}` : ""}`);
export const getDeltas = (c: ApiClient, id: string) => c.get<DeltasView>(`/apps/${enc(id)}/deltas`);
export const getRun = (c: ApiClient, id: string) => c.get<RunDetail>(`/runs/${enc(id)}`);

/** Approve/reject a run (the human gate). Returns the updated run view. */
export const decideRun = (c: ApiClient, id: string, decision: "approve" | "reject") =>
  c.post<RunDetail>(`/runs/${enc(id)}/${decision}`, { decision });

/** Post-approval handoff: the (non-executed) push commands. */
export const pushCommands = (c: ApiClient, id: string) =>
  c.get<{ pushCommands: PushCommand[] }>(`/runs/${enc(id)}/push-commands`);

/** The fastlane metadata zip URL (opened/shared, not parsed). */
export const fastlaneZipUrl = (base: string, id: string) =>
  `${base.replace(/\/+$/, "")}/runs/${enc(id)}/fastlane.zip`;

// ── logged-out preview (try-before-signup) ─────────────────────────────────────
export const preview = (c: ApiClient, query: string) =>
  c.post<unknown>("/preview", { query });

// ── credentials (Phase 3) ──────────────────────────────────────────────────────

/** A newly-created run (from a credentialed pass). */
export type RunCreated = { id: string; status: string; ascRead?: boolean };

/**
 * ASC read-and-improve run. The `.p8` + key/issuer ids are used ONCE in this
 * request and never stored (server-side: in-request only; client-side: passed
 * straight through, never persisted). Returns the new run to route to.
 */
export const runAsc = (
  c: ApiClient,
  appId: string,
  body: { p8: string; keyId: string; issuerId: string; locale?: string },
) => c.post<RunCreated>(`/apps/${enc(appId)}/run-asc`, body);

export const verifyPlay = (c: ApiClient, serviceAccount: string, packageName?: string) =>
  c.post<PlayVerifyResult>("/play/verify", { serviceAccount, ...(packageName ? { packageName } : {}) });

export const auditPlay = (
  c: ApiClient,
  appId: string,
  body: { serviceAccount: string; packageName: string; language?: string; targets?: string[]; brand?: string },
) => c.post<PlayAudit>(`/apps/${encodeURIComponent(appId)}/audit-play`, body);
