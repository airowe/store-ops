import type { RankAnnotation } from "@shipaso/api";

/**
 * Stable React key for a "What changed" timeline annotation.
 *
 * The timeline renders `annotations.slice(-8)` — a MOVING window — so the array
 * index is not an identity: a 9th annotation shifts every row's index and React
 * reconciles rows against the wrong data (a competitor diff wearing your push's
 * ▲ marker). `at` alone won't do either — same-day annotations collide.
 *
 * The content tuple is the only identity the wire type offers (unlike mobile's
 * RankAnnotation, the web's carries no runId), and it is stable across the
 * re-window.
 */
export function annotationKey(an: RankAnnotation): string {
  return `${an.at}:${an.kind}:${an.label}`;
}
