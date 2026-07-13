/**
 * Endpoint wrappers over the transport-agnostic client — the SAME calls both
 * surfaces make (lifted from mobile/src/api/endpoints.ts; spike subset). The
 * Worker API (api.shipaso.com) is unchanged by the migration.
 */
import type { ApiClient } from "./client.js";
import type {
  AnalyticsIngestResult,
  AnalyticsState,
  ApiKeyCreated,
  ApiKeyMeta,
  AppDetail,
  AppListItem,
  AsaConnectResult,
  CopyFields,
  LocalizeResult,
  LocalizedDraft,
  ApproveAllResult,
  AscCreateVersionResult,
  AscPushResult,
  Candidate,
  CompetitorsResponse,
  LocaleKeywordsResult,
  RejectionAnalysis,
  ConnectResult,
  DeltasResponse,
  EngagementSurface,
  GithubConnectResult,
  GithubPrResult,
  GithubStatus,
  Me,
  PlayAudit,
  NotificationPrefs,
  RankCadence,
  PreviewResult,
  ProofAggregate,
  RanksSeries,
  Run,
  RunAscResult,
  RunDecision,
  RunDetail,
  StoredCredential,
  WarRoomView,
} from "./types.js";

const enc = encodeURIComponent;

export const getApps = (c: ApiClient) => c.get<{ apps: AppListItem[] }>("/apps");

export const resolveApps = (c: ApiClient, query: string, offset = 0) =>
  c.post<{ candidates: Candidate[] }>("/resolve", { query, offset });

// ── public surfaces (funnel) ────────────────────────────────────────────────
export const authRequest = (c: ApiClient, email: string) =>
  c.post<{ sent: true }>("/auth/request", { email });
export const getProof = (c: ApiClient) => c.get<ProofAggregate>("/proof");
export const preview = (c: ApiClient, body: { query?: string; bundle_id?: string; offset?: number }) =>
  c.post<PreviewResult>("/preview", body);
export const connectApp = (c: ApiClient, body: { bundle_id?: string; query?: string; name?: string }) =>
  c.post<ConnectResult>("/apps", body);

export const getApp = (c: ApiClient, id: string) => c.get<AppDetail>(`/apps/${enc(id)}`);

/** Read-only Google Play listing audit (in-request or saved service account). */
export const auditPlay = (
  c: ApiClient,
  id: string,
  body: { packageName: string; serviceAccount?: string; useStored?: boolean; store?: boolean },
) => c.post<PlayAudit>(`/apps/${enc(id)}/audit-play`, body);

// ── analytics reports (measured conversion) ──────────────────────────────────
/** Ensure the ongoing Engagement request exists (needs an Admin key). Consent write. */
export const enableAnalytics = (c: ApiClient, id: string, body: AscCredentialBody = {}) =>
  c.post<AnalyticsState>(`/apps/${enc(id)}/analytics/enable`, body);
/** Pull + persist the ready Engagement report (read + own-DB write; no outward write). */
export const ingestAnalytics = (c: ApiClient, id: string, body: AscCredentialBody = {}) =>
  c.post<AnalyticsIngestResult>(`/apps/${enc(id)}/analytics/ingest`, body);
/** The measured conversion surface (analytics-reports Phase 3) — our own D1, no key. */
export const getEngagement = (c: ApiClient, id: string) =>
  c.get<EngagementSurface>(`/apps/${enc(id)}/analytics/engagement`);

export const getRanks = (c: ApiClient, id: string, keyword?: string) =>
  c.get<RanksSeries>(`/apps/${enc(id)}/ranks${keyword ? `?keyword=${enc(keyword)}` : ""}`);

export const getDeltas = (c: ApiClient, id: string) =>
  c.get<DeltasResponse>(`/apps/${enc(id)}/deltas`);

// ── competitors (#72) — discover / add / confirm / remove ────────────────────
export const getCompetitors = (c: ApiClient, id: string) =>
  c.get<CompetitorsResponse>(`/apps/${enc(id)}/competitors`);
export const addCompetitor = (c: ApiClient, id: string, body: { name?: string; key?: string }) =>
  c.post<CompetitorsResponse>(`/apps/${enc(id)}/competitors`, body);
export const discoverCompetitors = (c: ApiClient, id: string) =>
  c.post<CompetitorsResponse>(`/apps/${enc(id)}/competitors/discover`);

/** Measured, market-native keyword ideas for a target storefront (#180 Phase 3). */
export const getLocaleKeywords = (
  c: ApiClient,
  id: string,
  body: { market: string; seeds?: string[] },
) => c.post<LocaleKeywordsResult>(`/apps/${enc(id)}/locale-keywords`, body);
export const confirmCompetitor = (c: ApiClient, id: string, key: string) =>
  c.post<CompetitorsResponse>(`/apps/${enc(id)}/competitors/${enc(key)}/confirm`);
export const removeCompetitor = (c: ApiClient, id: string, key: string) =>
  c.request<CompetitorsResponse>(`/apps/${enc(id)}/competitors/${enc(key)}`, { method: "DELETE" });

/** Analyze a pasted App Review rejection (#178 Phase 4) — guideline + drafts. */
export const analyzeRejection = (c: ApiClient, text: string) =>
  c.post<RejectionAnalysis>("/rejection-assistant", { text });

export const warRoom = (c: ApiClient, id: string, competitors?: string[]) =>
  c.get<WarRoomView>(
    `/apps/${enc(id)}/war-room${competitors?.length ? `?competitors=${enc(competitors.join(","))}` : ""}`,
  );

export const runApp = (c: ApiClient, id: string) =>
  c.post<Run>(`/apps/${enc(id)}/run`);

// ── run detail (the money screen) ───────────────────────────────────────────
export const getRun = (c: ApiClient, id: string) => c.get<RunDetail>(`/runs/${enc(id)}`);
/**
 * The human gate. Returns a SLIM RunDecision (status + revealed pushCommands +
 * finalized proposedCopy), NOT a full RunDetail — merge it onto the cached run.
 * pushCommands are revealed on approve.
 */
export const decideRun = (c: ApiClient, id: string, decision: "approve" | "reject") =>
  c.post<RunDecision>(`/runs/${enc(id)}/${decision}`, { decision });

// ── App Store Connect (keyed) — #67 stored creds / #179 one-click push ──────
/** In-request creds win; omit p8 (or set useStored) to use the saved key. */
export type AscCredentialBody = {
  p8?: string;
  keyId?: string;
  issuerId?: string;
  useStored?: boolean;
};
/** Keyed (Mode-A) run. `store: true` opts in to saving the key (encrypted). */
export const runAppWithAsc = (
  c: ApiClient,
  id: string,
  body: AscCredentialBody & { store?: boolean; locale?: string } = {},
) => c.post<RunAscResult>(`/apps/${enc(id)}/run-asc`, body);
/** Push the APPROVED copy to ASC. Explicit click only — nothing is automatic. */
export const ascPush = (
  c: ApiClient,
  runId: string,
  body: AscCredentialBody & { locale?: string } = {},
) => c.post<AscPushResult>(`/runs/${enc(runId)}/asc/push`, body);
/** Create a DRAFT App Store version (#34) so an approved push has somewhere to land. */
export const ascCreateVersion = (
  c: ApiClient,
  runId: string,
  body: AscCredentialBody & { versionString: string },
) => c.post<AscCreateVersionResult>(`/runs/${enc(runId)}/asc/create-version`, body);

// ── autonomy + bulk actions ──────────────────────────────────────────────────
/** Pause / resume the weekly autonomous sweep (#51) — per-user master switch. */
export const pauseAgent = (c: ApiClient) => c.post<{ paused: boolean }>("/agent/pause");
export const resumeAgent = (c: ApiClient) => c.post<{ paused: boolean }>("/agent/resume");
/** Approve every run currently at the gate across the user's apps. */
export const approveAllRuns = (c: ApiClient) => c.post<ApproveAllResult>("/runs/approve-all");

// ── GitHub metadata-PR path (#8) ─────────────────────────────────────────────
export const getGithubStatus = (c: ApiClient) => c.get<GithubStatus>("/github/status");
/** Link (installation_id + repo "owner/name") or unlink (omit both) the repo. */
export const connectGithub = (c: ApiClient, body: { installation_id?: string; repo?: string } = {}) =>
  c.post<GithubConnectResult>("/github/connect", body);
/** Open a metadata PR for an APPROVED run — the credential-free push-to-repo path. */
export const githubPr = (c: ApiClient, runId: string) =>
  c.post<GithubPrResult>(`/runs/${enc(runId)}/github/pr`);

// ── per-locale localization (#78) — generate / approve / remove ──────────────
export const localizeGenerate = (c: ApiClient, runId: string, locale: string) =>
  c.post<LocalizedDraft>(`/runs/${enc(runId)}/localize`, { locale });
export const localizeApprove = (c: ApiClient, runId: string, locale: string, copy: CopyFields) =>
  c.post<LocalizeResult>(`/runs/${enc(runId)}/localize/approve`, { locale, copy });
export const localizeRemove = (c: ApiClient, runId: string, locale: string) =>
  c.request<LocalizeResult>(`/runs/${enc(runId)}/localize/${enc(locale)}`, { method: "DELETE" });

// ── auth + settings ─────────────────────────────────────────────────────────
export const me = (c: ApiClient) => c.get<Me>("/auth/me");
export const logout = (c: ApiClient) => c.post<{ ok?: boolean }>("/auth/logout");

export const getNotifications = (c: ApiClient) => c.get<NotificationPrefs>("/account/notifications");
export const setNotifications = (c: ApiClient, patch: Partial<NotificationPrefs>) =>
  c.post<NotificationPrefs>("/account/notifications", patch);
export const setRankCadence = (c: ApiClient, cadence: RankCadence) =>
  c.post<{ rank_cadence: RankCadence }>("/account/rank-cadence", { cadence });

export const getCredentials = (c: ApiClient) =>
  c.get<{ enabled: boolean; credentials: StoredCredential[] }>("/account/credentials");

// ── scoped agent/MCP API keys ────────────────────────────────────────────────
/** This account's API keys — metadata only (never the raw key). */
export const listApiKeys = (c: ApiClient) => c.get<{ keys: ApiKeyMeta[] }>("/account/api-keys");
/** Mint a scoped key. The raw `key` is in the response ONCE — copy it then. */
export const createApiKey = (c: ApiClient, label: string) =>
  c.post<ApiKeyCreated>("/account/api-keys", { label });
/** Revoke a key by id (kills agent access; does not touch the session). */
export const revokeApiKey = (c: ApiClient, id: string) =>
  c.request<{ revoked: boolean }>(`/account/api-keys/${enc(id)}`, { method: "DELETE" });
/** Connect + verify an Apple Search Ads key (unlocks real keyword popularity). */
export const connectAsa = (
  c: ApiClient,
  body: { privateKey: string; clientId: string; teamId: string; keyId: string; orgId: string },
) => c.post<AsaConnectResult>("/account/asa-credential", body);
export const deleteCredential = (c: ApiClient, kind: "asc" | "play" | "asa", appId?: string) =>
  c.request<{ deleted: boolean; note: string }>(
    `/account/credentials/${kind}${appId ? `?app=${enc(appId)}` : ""}`,
    { method: "DELETE" },
  );
