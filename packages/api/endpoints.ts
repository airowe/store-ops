/**
 * Endpoint wrappers over the transport-agnostic client — the SAME calls both
 * surfaces make (lifted from mobile/src/api/endpoints.ts; spike subset). The
 * Worker API (api.shipaso.com) is unchanged by the migration.
 */
import type { ApiClient } from "./client.js";
import type { AppListItem, DeltasResponse, RanksSeries, Run, WarRoomResponse } from "./types.js";

const enc = encodeURIComponent;

export const getApps = (c: ApiClient) => c.get<AppListItem[]>("/apps");

export const getApp = (c: ApiClient, id: string) =>
  c.get<{ app: AppListItem; runs: Run[] }>(`/apps/${enc(id)}`);

export const getRanks = (c: ApiClient, id: string, keyword?: string) =>
  c.get<RanksSeries>(`/apps/${enc(id)}/ranks${keyword ? `?keyword=${enc(keyword)}` : ""}`);

export const getDeltas = (c: ApiClient, id: string) =>
  c.get<DeltasResponse>(`/apps/${enc(id)}/deltas`);

export const warRoom = (c: ApiClient, id: string, competitors: string[]) =>
  c.get<WarRoomResponse>(`/apps/${enc(id)}/war-room?competitors=${enc(competitors.join(","))}`);

export const runApp = (c: ApiClient, id: string) =>
  c.post<Run>(`/apps/${enc(id)}/run`);
