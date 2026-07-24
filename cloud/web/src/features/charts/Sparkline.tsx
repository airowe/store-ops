/**
 * Sparkline — a tiny inline rank trend for the dashboard hero card. Hand-built
 * SVG over the shared, honest `buildSparkGeometry` (the same geometry the mobile
 * spark uses): rank #1 at top, a null rank is a GAP not a fabricated point, and
 * <2 measured points draws nothing. Theme-aware — the stroke resolves from the
 * --signal token so it re-tints in light/dark like RankChart.
 */
import { buildSparkGeometry, type SparkPoint } from "@shipaso/honesty";

export function Sparkline({
  points,
  width = 120,
  height = 34,
}: {
  points: readonly SparkPoint[];
  width?: number;
  height?: number;
}) {
  const geo = buildSparkGeometry(points, { width, height, pad: 4 });
  // Honest: nothing to draw without at least two measured points.
  if (geo.empty) return null;
  const last = geo.dots[geo.dots.length - 1];

  return (
    <svg
      className="sparkline"
      data-testid="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={geo.area} fill="var(--signal)" opacity={0.14} />
      <path
        d={geo.line}
        fill="none"
        stroke="var(--signal)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? <circle cx={last.x} cy={last.y} r={2.6} fill="var(--signal)" /> : null}
    </svg>
  );
}
