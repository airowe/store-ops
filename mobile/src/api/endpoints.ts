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
  CheckoutResult,
  Competitor,
  DeltasView,
  Me,
  NotificationPrefs,
  PlayAudit,
  PlayVerifyResult,
  PortfolioSummary,
  ProofAggregate,
  PushCommand,
  RankCadence,
  RanksSeries,
  ResolveResult,
  RunDetail,
  SweepSchedule,
  ThresholdConfig,
  WarRoomView,
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
  body: { p8?: string; keyId?: string; issuerId?: string; locale?: string; store?: boolean; useStored?: boolean },
) => c.post<RunCreated>(`/apps/${enc(appId)}/run-asc`, body);

// ── stored credentials (#67 Phase 2) — opt-in, write-only management ─────────
export type StoredCredential = {
  id: string; appId: string | null; kind: "asc" | "play";
  keyId: string; issuerId: string; createdAt: string; lastUsedAt: string | null; kekVersion: number;
};
export const getCredentials = (c: ApiClient) =>
  c.get<{ enabled: boolean; credentials: StoredCredential[] }>("/account/credentials");
export const deleteCredential = (c: ApiClient, kind: "asc" | "play", appId?: string) =>
  c.request<{ deleted: boolean; note: string }>(
    `/account/credentials/${kind}${appId ? `?app=${enc(appId)}` : ""}`, { method: "DELETE" });

export const verifyPlay = (c: ApiClient, serviceAccount: string, packageName?: string) =>
  c.post<PlayVerifyResult>("/play/verify", { serviceAccount, ...(packageName ? { packageName } : {}) });

export const auditPlay = (
  c: ApiClient,
  appId: string,
  body: { serviceAccount: string; packageName: string; language?: string; targets?: string[]; brand?: string },
) => c.post<PlayAudit>(`/apps/${encodeURIComponent(appId)}/audit-play`, body);

// ── Phase 4: extras ────────────────────────────────────────────────────────────
export const warRoom = (c: ApiClient, appId: string, competitors?: string[]) =>
  c.get<WarRoomView>(`/apps/${enc(appId)}/war-room${competitors?.length ? `?competitors=${enc(competitors.join(","))}` : ""}`);

/** The share-card SVG URL (fetched as text → rendered via react-native-svg). */
export const shareCardUrl = (base: string, appId: string, size: "wide" | "square" = "wide") =>
  `${base.replace(/\/+$/, "")}/apps/${enc(appId)}/share-card.svg?size=${size}`;

export const portfolio = (c: ApiClient) => c.get<PortfolioSummary>("/portfolio");
export const proof = (c: ApiClient) => c.get<ProofAggregate>("/proof");
export const billingCheckout = (c: ApiClient, tier: string) =>
  c.post<CheckoutResult>("/billing/checkout", { tier });

// ── settings (comms-prefs Phase 4) ─────────────────────────────────────────────
// No GET helper: settings reads the current prefs off the `me` payload and
// reconciles from each write's response, so a separate read would be a second
// source of truth for the same values.
export const setNotifications = (c: ApiClient, patch: Partial<NotificationPrefs>) =>
  c.post<NotificationPrefs>("/account/notifications", patch);

export const setRankCadence = (c: ApiClient, cadence: RankCadence) =>
  c.post<{ rank_cadence: RankCadence }>("/account/rank-cadence", { cadence });

/**
 * Unregister this device's push token (the sign-out path). Uses the generic
 * request() with method DELETE — the client deliberately has no `delete` helper
 * (every test fake is {get, post, request}). Server answers { removed } and is
 * idempotent, so sign-out can call this best-effort.
 */
// ── Competitors (#72): the watch list — only confirmed rows are watched ──────
export const getCompetitors = (c: ApiClient, appId: string) =>
  c.get<{ competitors: Competitor[] }>(`/apps/${enc(appId)}/competitors`);
export const discoverCompetitors = (c: ApiClient, appId: string) =>
  c.post<{ competitors: Competitor[]; discovered: number; note?: string }>(
    `/apps/${enc(appId)}/competitors/discover`, {});
export const addCompetitor = (c: ApiClient, appId: string, name: string) =>
  c.post<{ competitors: Competitor[] }>(`/apps/${enc(appId)}/competitors`, { name });
export const confirmCompetitor = (c: ApiClient, appId: string, key: string) =>
  c.post<{ competitors: Competitor[] }>(`/apps/${enc(appId)}/competitors/${enc(key)}/confirm`, {});
export const removeCompetitor = (c: ApiClient, appId: string, key: string) =>
  c.request<{ competitors: Competitor[] }>(`/apps/${enc(appId)}/competitors/${enc(key)}`, { method: "DELETE" });

// ── Agent triggers (#53) + sweep schedule (#52) — per-app config ─────────────
export const getThresholds = (c: ApiClient, appId: string) =>
  c.get<{ thresholds: ThresholdConfig }>(`/apps/${enc(appId)}/thresholds`);
export const setThresholds = (c: ApiClient, appId: string, patch: Partial<ThresholdConfig>) =>
  c.post<{ thresholds: ThresholdConfig }>(`/apps/${enc(appId)}/thresholds`, patch);
export const getSchedule = (c: ApiClient, appId: string) =>
  c.get<{ schedule: SweepSchedule }>(`/apps/${enc(appId)}/schedule`);
export const setSchedule = (c: ApiClient, appId: string, s: SweepSchedule) =>
  c.post<{ schedule: SweepSchedule }>(`/apps/${enc(appId)}/schedule`, s);

export const deletePushToken = (c: ApiClient, token: string) =>
  c.request<{ removed: boolean }>("/account/push-token", { method: "DELETE", body: { token } });
