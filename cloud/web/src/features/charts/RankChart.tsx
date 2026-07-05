/**
 * RankChart — the modern web rank-trend chart (PRD 08). Canvas via **uPlot**
 * (tiny, fast) over the shared, honest `toRankSeries` transform. Theme-aware:
 * colors resolve from the design-token CSS vars, so it re-tints in light/dark.
 *
 * Honesty: the y-axis is inverted (rank #1 at top); a null rank is a GAP
 * (`spanGaps:false`), never a fabricated line; <2 points draws nothing.
 * The native surface renders the same `toRankSeries` via Victory-XL (follow-up;
 * see the PR notes) — the transform is shared so both stay honest.
 */
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { toRankSeries, type RankSeriesPoint } from "@shipaso/honesty";

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function RankChart({ points, height = 160 }: { points: readonly RankSeriesPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const series = toRankSeries(points);
  const key = series.t.join(",") + "|" + series.rank.join(",");

  useEffect(() => {
    const host = ref.current;
    if (!host || series.empty) return;
    const signal = cssVar("--signal", "#34d399");
    const grid = cssVar("--line-soft", "#1a2130");
    const faint = cssVar("--faint", "#626c83");
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
        { stroke: signal, width: 2, fill: signal + "22", spanGaps: false, points: { show: false } },
      ],
      legend: { show: false },
    };
    const data: uPlot.AlignedData = [series.t, series.rank as (number | null)[]];
    const plot = new uPlot(opts, data, host);
    return () => plot.destroy();
    // re-init when the data or size changes
  }, [key, height, series.empty, series.loRank, series.hiRank]);

  if (series.empty) return null;
  return <div ref={ref} className="rank-chart" data-testid="rank-chart" />;
}
