/**
 * SPIKE SUBSET of the API types. Production (PRD 01) lifts the full
 * `mobile/src/types/api.ts` here verbatim and makes THIS the canonical location
 * both the app(s) and — for request/response parity — the Worker import. Kept
 * small here to prove the client shape typechecks end to end.
 */

export type RunStatus =
  | "detected" | "researching" | "awaiting_approval"
  | "approved" | "rejected" | "shipped";

export type RankSummary = { lead_keyword: string; lead_rank: number | null };
export type FindingsSummary = { label: string; critical: number };

export type AppListItem = {
  id: string;
  name: string;
  bundle_id: string;
  latest_run: { status: RunStatus; created_at: string } | null;
  rank_summary: RankSummary | null;
  findings_summary: FindingsSummary | null;
};

/** Honest rank point: null rank = unmeasured, never 0. */
export type RankPoint = { rank: number | null; total: number | null; checked_at: string };
export type RankAnnotation = { at: string; kind: "push" | "competitor"; label: string };
export type RanksSeries = { points: RankPoint[]; annotations?: RankAnnotation[] };

export type DeltaEntry = {
  keyword: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
  direction: "up" | "down" | "same" | "new" | "unmeasured";
};
export type DeltasResponse = { entries: DeltaEntry[] };

export type WarRoomResponse = { warRoom: unknown[]; competitors: string[] };
export type Run = { id: string; app_id: string; status: RunStatus; created_at: string };
