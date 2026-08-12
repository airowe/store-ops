/**
 * Keyword standing (#473) — where an app sits across EVERY tracked keyword
 * right now, as opposed to how one keyword moved over time.
 *
 * `rankDeltasView` answers "what changed": it reduces the snapshot history to
 * previous/current/direction per keyword. That reduction drops two fields the
 * standing view needs and cannot reconstruct — `total` (how many apps competed
 * for the term) and `checked_at` (when the reading was taken). This derives the
 * standing from the SAME `RankSnapshotRow[]` rather than a second query, so the
 * two surfaces can never disagree about a keyword's current position.
 *
 * Honesty:
 *   • the latest snapshot per keyword wins, and it carries its own date — a
 *     stale row says when it was read instead of implying it is current,
 *   • `rank: null` is preserved as null (searched, not in the results). It is
 *     never coerced to the scan depth: a default-filled absence reads as a
 *     bad-but-real position and stops being noticed,
 *   • `total: null` when the snapshot carried no competitor count — unknown,
 *     never 0.
 */
import type { RankSnapshotRow } from "./d1.js";

/** One keyword's latest reading. */
export type StandingEntry = {
  keyword: string;
  /** measured position, or null when the term was searched and not found. */
  rank: number | null;
  /** apps competing for the term at that reading; null when unknown. */
  total: number | null;
  /** ISO timestamp of the reading this row describes. */
  checked_at: string;
};

export type StandingView = {
  entries: StandingEntry[];
  /** how many of the tracked terms have a measured position. */
  ranked: number;
  /** how many terms are tracked at all — the denominator that makes `ranked` honest. */
  tracked: number;
  /** the strongest measured position, or null when nothing ranks. NEVER 0. */
  best: number | null;
};

/**
 * The latest snapshot per keyword, ordered best-position first and then by how
 * contested the unranked terms are.
 *
 * Pure. `rows` is the same history `appDeltas` already loads; it is ordered
 * `checked_at ASC` by `getRankHistory`, but this does not rely on that — it
 * compares timestamps explicitly so a caller passing rows in another order
 * still gets the latest reading rather than the last one in the array.
 */
export function standingFromHistory(
  rows: readonly RankSnapshotRow[],
  opts: { keywords?: readonly string[] } = {},
): StandingView {
  // #74 parity with appDeltas: scope to the CURRENTLY targeted keywords so a
  // term the app no longer targets doesn't resurface from old snapshots.
  const allow =
    opts.keywords && opts.keywords.length
      ? new Set(opts.keywords.map((k) => k.trim().toLowerCase()))
      : null;

  const latest = new Map<string, RankSnapshotRow>();
  for (const row of rows) {
    if (allow && !allow.has(row.keyword.trim().toLowerCase())) continue;
    const seen = latest.get(row.keyword);
    if (!seen || Date.parse(row.checked_at) >= Date.parse(seen.checked_at)) {
      latest.set(row.keyword, row);
    }
  }

  const entries: StandingEntry[] = [...latest.values()].map((r) => ({
    keyword: r.keyword,
    rank: r.rank,
    total: typeof r.total === "number" ? r.total : null,
    checked_at: r.checked_at,
  }));

  // ranked first (best leads); then the unranked, most-contested first — an
  // absence on a busy term is a bigger miss than one nobody searches.
  entries.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return (b.total ?? 0) - (a.total ?? 0);
  });

  const positions = entries.filter((e) => e.rank !== null).map((e) => e.rank as number);
  return {
    entries,
    ranked: positions.length,
    tracked: entries.length,
    best: positions.length ? Math.min(...positions) : null,
  };
}
