/**
 * Typed endpoint wrappers — one function per API route the app uses, each
 * returning a DTO from `types/api`. Thin by design: the client handles auth,
 * errors, and JSON; this layer just names the routes and their shapes so screens
 * never hand-build URLs. Mirrors the web's `app.js` calls against the same API.
 */
import type { ApiClient } from "./client.js";
import type {
  AppList,
  AuthExchangeResult,
  AuthRequestResult,
  Me,
  PlayAudit,
  PlayVerifyResult,
  ResolveResult,
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

// ── logged-out preview (try-before-signup) ─────────────────────────────────────
export const preview = (c: ApiClient, query: string) =>
  c.post<unknown>("/preview", { query });

// ── credentials (Phase 3) ──────────────────────────────────────────────────────
export const verifyPlay = (c: ApiClient, serviceAccount: string, packageName?: string) =>
  c.post<PlayVerifyResult>("/play/verify", { serviceAccount, ...(packageName ? { packageName } : {}) });

export const auditPlay = (
  c: ApiClient,
  appId: string,
  body: { serviceAccount: string; packageName: string; language?: string; targets?: string[]; brand?: string },
) => c.post<PlayAudit>(`/apps/${encodeURIComponent(appId)}/audit-play`, body);
