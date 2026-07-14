/**
 * Rank-series prep for the native chart (react-native-graph, Skia). Mirrors the
 * shared spine's `@shipaso/honesty` `toRankSeries` (kept local because Metro
 * doesn't resolve the sibling package yet — PRD 01's production wiring; the
 * behavioral test pins this to the same rules so they can't drift).
 *
 * Honesty:
 *   • a null rank is UNMEASURED — dropped from the drawn line (react-native-graph
 *     has no gap support), never plotted as a fabricated value; the count is
 *     surfaced so the caption stays honest.
 *   • rank is INVERTED (value = -rank) so #1 sits at the TOP.
 *   • <2 measured points ⇒ empty (no trend to draw).
 */

export type RankSeriesPoint = { rank: number | null; checked_at: string };

export type RankSeries = {
  t: number[];
  rank: (number | null)[];
  loRank: number;
  hiRank: number;
  empty: boolean;
};

export function toRankSeries(points: readonly RankSeriesPoint[]): RankSeries {
  if (!points || points.length < 2) return { t: [], rank: [], loRank: 1, hiRank: 10, empty: true };
  const t = points.map((p) => Math.floor(Date.parse(p.checked_at) / 1000));
  const rank = points.map((p) => (p.rank == null ? null : p.rank));
  const measured = rank.filter((r): r is number => r != null);
  const minR = measured.length ? Math.min(...measured) : 1;
  const maxR = measured.length ? Math.max(...measured) : 10;
  return { t, rank, loRank: Math.max(1, minR - 3), hiRank: maxR + 3, empty: false };
}

/**
 * Stable React key for a "What changed" timeline annotation.
 *
 * The timeline renders `annotations.slice(-8)` — a moving window — so the array
 * index is NOT an identity: a 9th annotation shifts every row's index and React
 * reconciles rows against the wrong data (a competitor diff wearing your push's
 * marker). `runId` is the true id when the annotation came from one of our runs;
 * a competitor diff has none, so fall back to its content, which is stable across
 * the re-window. `at` alone won't do — same-day annotations collide.
 */
export function annotationKey(an: { at: string; kind: string; label: string; runId?: string }): string {
  return an.runId ?? `${an.at}:${an.kind}:${an.label}`;
}

/** react-native-graph point: value on y (we invert rank), date on x. */
export type GraphPoint = { value: number; date: Date };
export type GraphSeries = { points: GraphPoint[]; gaps: number; empty: boolean };

/** Map a rank series to react-native-graph points (inverted; nulls dropped). */
export function toGraphPoints(points: readonly RankSeriesPoint[]): GraphSeries {
  const s = toRankSeries(points);
  if (s.empty) return { points: [], gaps: 0, empty: true };
  const gp: GraphPoint[] = [];
  let gaps = 0;
  s.rank.forEach((r, i) => {
    if (r == null) {
      gaps++;
      return;
    }
    gp.push({ value: -r, date: new Date(s.t[i]! * 1000) });
  });
  return { points: gp, gaps, empty: gp.length < 2 };
}
