/**
 * Endpoint wrappers over the transport-agnostic client — the SAME calls both
 * surfaces make (lifted from mobile/src/api/endpoints.ts; spike subset). The
 * Worker API (api.shipaso.com) is unchanged by the migration.
 */
import type { ApiClient } from "./client.js";
import type {
  AppDetail,
  AppListItem,
  Candidate,
  ConnectResult,
  DeltasResponse,
  EmailDigest,
  Me,
  NotificationPrefs,
  RankCadence,
  RanksSeries,
  Run,
  StoredCredential,
  WarRoomView,
} from "./types.js";

const enc = encodeURIComponent;

export const getApps = (c: ApiClient) => c.get<{ apps: AppListItem[] }>("/apps");

export const resolveApps = (c: ApiClient, query: string, offset = 0) =>
  c.post<{ candidates: Candidate[] }>("/resolve", { query, offset });
export const connectApp = (c: ApiClient, body: { bundle_id?: string; query?: string; name?: string }) =>
  c.post<ConnectResult>("/apps", body);

export const getApp = (c: ApiClient, id: string) => c.get<AppDetail>(`/apps/${enc(id)}`);

export const getRanks = (c: ApiClient, id: string, keyword?: string) =>
  c.get<RanksSeries>(`/apps/${enc(id)}/ranks${keyword ? `?keyword=${enc(keyword)}` : ""}`);

export const getDeltas = (c: ApiClient, id: string) =>
  c.get<DeltasResponse>(`/apps/${enc(id)}/deltas`);

export const warRoom = (c: ApiClient, id: string, competitors?: string[]) =>
  c.get<WarRoomView>(
    `/apps/${enc(id)}/war-room${competitors?.length ? `?competitors=${enc(competitors.join(","))}` : ""}`,
  );

export const runApp = (c: ApiClient, id: string) =>
  c.post<Run>(`/apps/${enc(id)}/run`);

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
export const deleteCredential = (c: ApiClient, kind: "asc" | "play", appId?: string) =>
  c.request<{ deleted: boolean; note: string }>(
    `/account/credentials/${kind}${appId ? `?app=${enc(appId)}` : ""}`,
    { method: "DELETE" },
  );
