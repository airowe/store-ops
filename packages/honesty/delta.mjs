/**
 * Rank-movement classification — the honesty rules behind RankMovementRow (web
 * `.dchip`, native `RankMovementRow`), in one shared place so both surfaces
 * agree on what a move "means".
 *
 * Rank is INVERTED (lower is better), so an improvement is previous > current.
 * Honesty:
 *   • current null            → "unmeasured" (renders "—", never 0)
 *   • previous null (1 snap)  → "new"        (NO fabricated count-up / delta)
 *   • else                    → up / down / same by the signed delta
 */

/**
 * @param {{ previous: number|null|undefined, current: number|null|undefined }} entry
 * @returns {{ direction: "up"|"down"|"same"|"new"|"unmeasured", delta: number|null }}
 */
export function classifyDelta(entry) {
  const { previous, current } = entry;
  if (current == null) return { direction: "unmeasured", delta: null };
  if (previous == null) return { direction: "new", delta: null };
  const delta = previous - current; // >0 = improved (moved up toward #1)
  if (delta > 0) return { direction: "up", delta };
  if (delta < 0) return { direction: "down", delta };
  return { direction: "same", delta: 0 };
}
