/**
 * Rank-trend geometry — the pure core BOTH chart renderers consume (web uPlot,
 * native Victory-XL / SVG). Ported from `mobile/src/components/Sparkline.tsx`.
 *
 * Honesty rules:
 *   • an UNMEASURED point (rank null) BREAKS the line — it is not plotted at
 *     the floor. Drawing it at 200 made the trend dive and recover, which reads
 *     as "we crashed then came back" when the truth is "we did not measure".
 *     A default-filled gap also stops being noticed at all, which is the whole
 *     failure mode (#473);
 *   • the rank axis is INVERTED — #1 sits at the top;
 *   • <2 MEASURED points draws nothing (no trend to draw) — callers gate on
 *     `!empty`. Two readings either side of a gap are still a trend.
 */

/**
 * The rank an unranked snapshot USED to be plotted at. Retained only so the
 * axis can still reserve room for a "#200+" endpoint label; the line itself no
 * longer routes through it. Do not reintroduce it as a plotted value.
 */
export const UNRANKED_PLOT = 200;

/**
 * @param {ReadonlyArray<{ rank: number|null }>} points
 * @param {{ width: number, height: number, pad: number }} opts
 */
export function buildSparkGeometry(points, opts) {
  const { width: W, height: H, pad } = opts;
  const measured = points.filter((p) => p.rank != null);
  // A trend needs two MEASURED readings. Counting unmeasured points would draw
  // a "trend" out of gaps.
  if (points.length < 2 || measured.length < 2) {
    return { line: "", area: "", gridY: [], dots: [], empty: true };
  }

  // Scale from measured ranks only — an unmeasured point must not stretch the
  // axis to 200 and flatten every real movement into a hairline.
  const ranks = measured.map((p) => p.rank);
  const lo = Math.max(1, Math.min(...ranks) - 3);
  const hi = Math.max(...ranks) + 3;
  const x = (i) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (r) => pad + ((r - lo) / (hi - lo || 1)) * (H - pad * 2); // inverted: best at top

  // Break the path at every gap: each measured run becomes its own subpath, so
  // an unmeasured week leaves a visible hole rather than a line through 200.
  let line = "";
  let penDown = false;
  for (let i = 0; i < points.length; i++) {
    const r = points[i].rank;
    if (r == null) {
      penDown = false;
      continue;
    }
    line += `${penDown ? " L" : (line ? " M" : "M")}${x(i).toFixed(1)},${y(r).toFixed(1)}`;
    penDown = true;
  }

  // The fill is only honest under a CONTINUOUS run; with a gap present we drop
  // it rather than shade across a stretch we never measured.
  const hasGap = points.some((p) => p.rank == null);
  const firstIdx = points.findIndex((p) => p.rank != null);
  const lastIdx = points.length - 1 - [...points].reverse().findIndex((p) => p.rank != null);
  const area = hasGap
    ? ""
    : `${line} L${x(lastIdx).toFixed(1)},${H - pad} L${x(firstIdx).toFixed(1)},${H - pad} Z`;

  const gridY = [1, 2, 3].map((g) => +(pad + (g / 4) * (H - pad * 2)).toFixed(1));
  // Endpoints are the first and last MEASURED readings — never a gap, which
  // has no position to point at.
  const dots = [firstIdx, lastIdx].map((i, n) => ({
    x: x(i),
    y: y(points[i].rank),
    label: `#${points[i].rank}`,
    anchor: n === 0 ? "start" : "end",
  }));

  return { line, area, gridY, dots, empty: false };
}
