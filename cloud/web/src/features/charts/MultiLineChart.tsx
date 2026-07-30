/**
 * MultiLineChart — the dashboard's portfolio rank trend: one line per app over a
 * shared time axis. Hand-built theme-aware SVG (rank #1 at top, lower is better).
 * Honest: only series with ≥2 measured points are drawn, and a null rank breaks
 * the line into a gap rather than inventing a point. Colors come from a small
 * token cycle so the legend and lines stay in sync in light and dark.
 */

export type Series = { label: string; color: string; points: readonly (number | null)[] };

/** The token colors a portfolio line cycles through, in order. */
export const SERIES_COLORS = ["var(--signal)", "var(--brand)", "var(--warn)"] as const;

/** Pure: keep only series with at least two measured points (a real trend). */
export function drawableSeries(series: readonly Series[]): Series[] {
  return series.filter((s) => s.points.filter((r) => typeof r === "number").length >= 2);
}

export function MultiLineChart({
  series,
  width = 480,
  height = 150,
}: {
  series: readonly Series[];
  width?: number;
  height?: number;
}) {
  const drawable = drawableSeries(series);
  if (drawable.length === 0) return null;

  const cols = Math.max(...drawable.map((s) => s.points.length));
  const all = drawable.flatMap((s) => s.points).filter((r): r is number => typeof r === "number");
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = 8;
  const x = (i: number, n: number) => pad + (i / Math.max(1, n - 1)) * (width - pad * 2);
  // inverted: best rank (min) at the top
  const y = (r: number) => pad + ((r - min) / (max - min || 1)) * (height - pad * 2);

  return (
    <svg
      className="multiline"
      data-testid="portfolio-chart"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={0}
          x2={width}
          y1={pad + f * (height - pad * 2)}
          y2={pad + f * (height - pad * 2)}
          stroke="var(--line-soft)"
          strokeWidth={1}
        />
      ))}
      {drawable.map((s) => {
        // break into measured segments (gaps at nulls) so we never draw a fake line
        const segs: string[] = [];
        let cur: string[] = [];
        s.points.forEach((r, i) => {
          if (typeof r === "number") {
            cur.push(`${x(i, cols).toFixed(1)},${y(r).toFixed(1)}`);
          } else if (cur.length) {
            segs.push(cur.join(" "));
            cur = [];
          }
        });
        if (cur.length) segs.push(cur.join(" "));
        return segs.map((pts, si) => (
          <polyline
            key={s.label + si}
            points={pts}
            fill="none"
            stroke={s.color}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ));
      })}
    </svg>
  );
}
