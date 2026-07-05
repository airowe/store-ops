/**
 * Sparkline — the mobile half of the web's rank-trend chart
 * (`cloud/public/app.js sparkline()`), so both surfaces draw the same modern
 * shape: a signal-green trajectory over a soft gradient area with a quiet grid
 * floor and honest endpoint labels.
 *
 * Honesty rules, matched to the web:
 *   • a null rank plots at the floor and labels "#200+" (never a fake 0);
 *   • the rank axis is INVERTED — #1 sits at the top;
 *   • a single point (or none) renders nothing chart-like — there's no trend to
 *     draw, so callers should gate on `points.length >= 2`.
 *
 * `buildSparkGeometry` is pure + unit-tested; the component only maps it to SVG.
 */
import React, { useId } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { usePalette } from "../theme/index.js";

export type SparkPoint = { rank: number | null; checked_at?: string };

/** Rank used to plot an unranked snapshot (kept in sync with the web's `200`). */
export const UNRANKED_PLOT = 200;

export type SparkGeometry = {
  line: string;
  area: string;
  gridY: number[];
  dots: { x: number; y: number; label: string; anchor: "start" | "end" }[];
  empty: boolean;
};

/** Pure: turn a rank series into SVG path data for a `width × height` box. */
export function buildSparkGeometry(
  points: readonly SparkPoint[],
  opts: { width: number; height: number; pad: number },
): SparkGeometry {
  const { width: W, height: H, pad } = opts;
  if (points.length < 2) {
    return { line: "", area: "", gridY: [], dots: [], empty: true };
  }
  const plot = (r: number | null) => (r == null ? UNRANKED_PLOT : r);
  const ranks = points.map((p) => plot(p.rank));
  const minR = Math.min(...ranks);
  const maxR = Math.max(...ranks);
  const lo = Math.max(1, minR - 3);
  const hi = maxR + 3;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  // inverted: rank `lo` (best) at the top, `hi` at the bottom.
  const y = (r: number) => pad + ((r - lo) / (hi - lo || 1)) * (H - pad * 2);

  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(plot(p.rank)).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;

  const gridY = [1, 2, 3].map((g) => +(pad + (g / 4) * (H - pad * 2)).toFixed(1));

  const dots = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i === 0 || i === points.length - 1)
    .map(({ p, i }) => ({
      x: x(i),
      y: y(plot(p.rank)),
      label: p.rank == null ? "#200+" : `#${p.rank}`,
      anchor: (i === 0 ? "start" : "end") as "start" | "end",
    }));

  return { line, area, gridY, dots, empty: false };
}

export function Sparkline({
  points,
  height = 120,
}: {
  points: readonly SparkPoint[];
  height?: number;
}) {
  const palette = usePalette();
  const gid = useId();
  const W = 600;
  const pad = 24;
  const geo = buildSparkGeometry(points, { width: W, height, pad });

  if (geo.empty) return null;

  return (
    <View accessibilityRole="image" accessibilityLabel="Rank trend" style={{ width: "100%" }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={palette.signal} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={palette.signal} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {geo.gridY.map((gy, i) => (
          <Line key={i} x1={pad} y1={gy} x2={W - pad} y2={gy} stroke={palette.lineSoft} strokeWidth={1} />
        ))}
        <Line x1={pad} y1={height - pad} x2={W - pad} y2={height - pad} stroke={palette.line} strokeWidth={1} />
        <Path d={geo.area} fill={`url(#spark-${gid})`} />
        <Path
          d={geo.line}
          fill="none"
          stroke={palette.signal}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {geo.dots.map((d, i) => (
          <React.Fragment key={i}>
            <Circle cx={d.x} cy={d.y} r={3.5} fill={palette.signal} stroke={palette.panel} strokeWidth={2} />
            <SvgText
              x={d.anchor === "start" ? d.x + 4 : d.x - 4}
              y={d.y - 8}
              fill={palette.faint}
              fontSize={11}
              fontFamily="monospace"
              textAnchor={d.anchor}
            >
              {d.label}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}
