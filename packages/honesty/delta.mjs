/**
 * Rank-movement classification — the honesty rules behind RankMovementRow (web
 * `.dchip`, native `RankMovementRow`), in one shared place so both surfaces
 * agree on what a move "means".
 *
 * Rank is INVERTED (lower is better), so an improvement is previous > current.
 * Honesty:
 *   • current null, previous set → "lost"       (measured, and it fell out)
 *   • current null, no previous  → "unmeasured" (we have nothing to compare)
 *   • previous null (1 snap)     → "new"        (NO fabricated count-up / delta)
 *   • else                       → up / down / same by the signed delta
 *
 * "lost" vs "unmeasured" is a real distinction, not a nicety (#360). Both have
 * `current: null`, so collapsing them reported "we didn't look" for a keyword
 * we HAD measured at #9 and then measured again and found gone. Dropping out of
 * the top 200 is arguably the most important thing that can happen to a tracked
 * term; it must not read as absence of data.
 */

/**
 * @param {{ previous: number|null|undefined, current: number|null|undefined }} entry
 * @returns {{ direction: "up"|"down"|"same"|"new"|"lost"|"unmeasured", delta: number|null }}
 */
export function classifyDelta(entry) {
  const { previous, current } = entry;
  // No delta in either branch: a lost keyword has no numeric move, and
  // inventing one (e.g. 200 - previous) would fabricate a floor we never read.
  if (current == null) {
    return previous == null
      ? { direction: "unmeasured", delta: null }
      : { direction: "lost", delta: null };
  }
  if (previous == null) return { direction: "new", delta: null };
  const delta = previous - current; // >0 = improved (moved up toward #1)
  if (delta > 0) return { direction: "up", delta };
  if (delta < 0) return { direction: "down", delta };
  return { direction: "same", delta: 0 };
}
