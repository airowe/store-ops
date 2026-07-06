/**
 * Rank-series prep for the MODERN chart renderers (web uPlot, native Victory-XL)
 * — both draw from data arrays, not SVG paths, so this is the shared, honest
 * transform they consume (the SVG-path `buildSparkGeometry` stays for the
 * existing SVG sparklines).
 *
 * Honesty:
 *   • a null rank stays null → the renderer draws a GAP, never a fabricated line
 *     through an unmeasured point (more honest than a floor value);
 *   • the y-range is padded around the measured min/max, clamped to rank ≥ 1;
 *   • <2 points ⇒ empty (no trend to draw).
 * The renderer inverts the y-axis so rank #1 sits at the top.
 */

/**
 * @param {ReadonlyArray<{ rank: number|null, checked_at: string }>} points
 * @returns {{ t: number[], rank: (number|null)[], loRank: number, hiRank: number, empty: boolean }}
 */
export function toRankSeries(points) {
  if (!points || points.length < 2) return { t: [], rank: [], loRank: 1, hiRank: 10, empty: true };
  const t = points.map((p) => Math.floor(Date.parse(p.checked_at) / 1000));
  const rank = points.map((p) => (p.rank == null ? null : p.rank));
  const measured = rank.filter((r) => r != null);
  const minR = measured.length ? Math.min(...measured) : 1;
  const maxR = measured.length ? Math.max(...measured) : 10;
  return { t, rank, loRank: Math.max(1, minR - 3), hiRank: maxR + 3, empty: false };
}
