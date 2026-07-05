/**
 * Rank-trend geometry — the pure core BOTH chart renderers consume (web uPlot,
 * native Victory-XL / SVG). Ported from `mobile/src/components/Sparkline.tsx`.
 *
 * Honesty rules, matched to the web `sparkline()`:
 *   • a null rank plots at the floor and labels "#200+" (never a fake 0);
 *   • the rank axis is INVERTED — #1 sits at the top;
 *   • <2 points draws nothing (no trend to draw) — callers gate on `!empty`.
 */

/** Rank used to plot an unranked snapshot (kept in sync with the web's 200). */
export const UNRANKED_PLOT = 200;

/**
 * @param {ReadonlyArray<{ rank: number|null }>} points
 * @param {{ width: number, height: number, pad: number }} opts
 */
export function buildSparkGeometry(points, opts) {
  const { width: W, height: H, pad } = opts;
  if (points.length < 2) return { line: "", area: "", gridY: [], dots: [], empty: true };

  const plot = (r) => (r == null ? UNRANKED_PLOT : r);
  const ranks = points.map((p) => plot(p.rank));
  const minR = Math.min(...ranks);
  const maxR = Math.max(...ranks);
  const lo = Math.max(1, minR - 3);
  const hi = maxR + 3;
  const x = (i) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (r) => pad + ((r - lo) / (hi - lo || 1)) * (H - pad * 2); // inverted: best at top

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
      anchor: i === 0 ? "start" : "end",
    }));

  return { line, area, gridY, dots, empty: false };
}
