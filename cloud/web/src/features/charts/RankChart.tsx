/**
 * RankChart — the modern web rank-trend chart (PRD 08) with a hover/touch
 * **scrubber** (parity with the native react-native-graph chart). Canvas via
 * **uPlot** over the shared, honest `toRankSeries` transform. Theme-aware: colors
 * resolve from the design-token CSS vars, so it re-tints in light/dark.
 *
 * Honesty: the y-axis is inverted (rank #1 at top); a null rank is a GAP
 * (`spanGaps:false`), never a fabricated line; <2 points draws nothing. The
 * scrubber readout shows "#rank · date" under the cursor, and an unmeasured
 * point reads "—", never 0.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { toRankSeries, type RankSeries, type RankSeriesPoint } from "@shipaso/honesty";

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export type Readout = { rank: number | null; t: number };

/** Pure: the readout at a cursor index (null when off-chart). */
export function readoutAt(series: RankSeries, idx: number | null | undefined): Readout | null {
  if (idx == null || idx < 0 || idx >= series.t.length) return null;
  return { rank: series.rank[idx] ?? null, t: series.t[idx]! };
}

/** Pure: the default readout (latest MEASURED point, else the latest). */
export function defaultReadout(series: RankSeries): Readout | null {
  if (series.empty || series.t.length === 0) return null;
  for (let i = series.rank.length - 1; i >= 0; i--) {
    if (series.rank[i] != null) return { rank: series.rank[i]!, t: series.t[i]! };
  }
  return { rank: null, t: series.t[series.t.length - 1]! };
}

/** Pure: "#8 · 2026-07-02", or "— · date" for an unmeasured point. */
export function formatReadout(r: Readout | null): string {
  if (!r) return "";
  const date = new Date(r.t * 1000).toISOString().slice(0, 10);
  return `${r.rank == null ? "—" : "#" + r.rank} · ${date}`;
}

export function RankChart({ points, height = 160 }: { points: readonly RankSeriesPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const series = useMemo(() => toRankSeries(points), [points]);
  const [hover, setHover] = useState<Readout | null>(null);
  const key = series.t.join(",") + "|" + series.rank.join(",");

  useEffect(() => {
    const host = ref.current;
    if (!host || series.empty) return;
    const signal = cssVar("--signal", "#34d399");
    const grid = cssVar("--line-soft", "#1a2130");
    const faint = cssVar("--faint", "#828ca3");
    const width = host.clientWidth || 600;

    const opts: uPlot.Options = {
      width,
      height,
      scales: { x: { time: true }, y: { dir: -1, range: [series.loRank, series.hiRank] } },
      axes: [
        { stroke: faint, grid: { stroke: grid, width: 1 } },
        { stroke: faint, grid: { stroke: grid, width: 1 } },
      ],
      series: [
        {},
        { stroke: signal, width: 2, fill: signal + "22", spanGaps: false, points: { show: true, size: 6 } },
      ],
      legend: { show: false },
      cursor: { show: true, x: true, y: false, points: { show: true } },
      hooks: {
        setCursor: [
          (u: uPlot) => setHover(readoutAt(series, u.cursor.idx)),
        ],
      },
    };
    const data: uPlot.AlignedData = [series.t, series.rank as (number | null)[]];
    const plot = new uPlot(opts, data, host);
    return () => plot.destroy();
    // re-init when the data or size changes
  }, [key, height, series.empty, series.loRank, series.hiRank, series]);

  if (series.empty) return null;
  const readout = hover ?? defaultReadout(series);
  return (
    <div>
      <div className="chart-readout" data-testid="chart-readout">{formatReadout(readout)}</div>
      <div ref={ref} className="rank-chart" data-testid="rank-chart" />
    </div>
  );
}
