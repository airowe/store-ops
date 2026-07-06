// Types for @shipaso/honesty (pure JS impl in *.mjs; typed for TS consumers).

export function formatRank(rank: number | null | undefined): string;
export function formatCount(n: number | null | undefined): string;
export function formatScore(score: number | null | undefined): string;
export function timeAgo(iso: string, now: number): string;
export function humanizeStatus(status: string): string;

export type DeltaDirection = "up" | "down" | "same" | "new" | "unmeasured";
export function classifyDelta(entry: {
  previous: number | null | undefined;
  current: number | null | undefined;
}): { direction: DeltaDirection; delta: number | null };

export const UNRANKED_PLOT: 200;
export type SparkPoint = { rank: number | null };
export type SparkGeometry = {
  line: string;
  area: string;
  gridY: number[];
  dots: { x: number; y: number; label: string; anchor: "start" | "end" }[];
  empty: boolean;
};
export function buildSparkGeometry(
  points: readonly SparkPoint[],
  opts: { width: number; height: number; pad: number },
): SparkGeometry;

export type RankSeriesPoint = { rank: number | null; checked_at: string };
export type RankSeries = {
  t: number[];
  rank: (number | null)[];
  loRank: number;
  hiRank: number;
  empty: boolean;
};
export function toRankSeries(points: readonly RankSeriesPoint[]): RankSeries;
