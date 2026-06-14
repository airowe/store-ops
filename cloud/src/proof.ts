/**
 * Proof capture — the PURE core behind the landing-page "real movement" stat
 * and any per-app "here's what we moved for you" receipt. It distils the same
 * flat `RankSnapshotRow[]` that `getRankHistory` returns into a list of concrete
 * RANK WINS (a keyword whose position improved meaningfully over the window we
 * have data for) and an anonymized roll-up across many apps.
 *
 * It has no knowledge of D1, the network, app names, or emails — it operates on
 * in-memory arrays only, so it unit-tests without a Worker runtime. The caller
 * does the I/O (fetch per app, fan the per-app wins into `aggregateProof`).
 *
 * Rank convention: rank is a search-result POSITION, so LOWER is better. A win
 * is therefore `from - to > 0` (the rank number went DOWN). `from` is the
 * earliest non-null rank we have for the keyword and `to` is the latest, so the
 * improvement reflects the full observed span, not the best/worst spike between.
 */
import type { RankSnapshotRow } from "./d1.js";

export type RankWin = {
  keyword: string;
  /** the EARLIEST non-null rank observed for this keyword (the "before"). */
  from: number;
  /** the LATEST non-null rank observed for this keyword (the "after"). */
  to: number;
  /** from - to; always > 0 for a win (lower rank = better). */
  improvement: number;
  /** days elapsed between the `from` and `to` snapshots (may be fractional). */
  spanDays: number;
};

export type ProofAggregate = {
  /** how many apps contributed at least one win. */
  appsWithWins: number;
  /** total wins summed across every app. */
  totalWins: number;
  /** the single largest improvement seen anywhere (0 when there are none). */
  bestImprovement: number;
  /** median improvement across every win (0 when there are none). */
  medianImprovement: number;
};

export type ExtractWinsOpts = { minImprovement?: number };

/** A win must clear at least this much improvement unless the caller overrides. */
const DEFAULT_MIN_IMPROVEMENT = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse the D1 timestamp shape ("YYYY-MM-DD HH:MM:SS") as UTC. D1/SQLite stores
 * naive UTC strings with a space separator; turning it into a valid ISO instant
 * ("...T...Z") keeps the day-span math free of the host's local-timezone drift.
 */
function parseCheckedAt(checkedAt: string): number {
  return Date.parse(`${checkedAt.replace(" ", "T")}Z`);
}

/**
 * PURE. Per keyword, pair the EARLIEST non-null-rank snapshot (`from`) with the
 * LATEST non-null-rank snapshot (`to`); when `from - to >= minImprovement` it's
 * a win. Keywords that never had two distinct non-null ranks are skipped.
 * Results are sorted by improvement, biggest first.
 *
 * Input is the flat, mixed-keyword `RankSnapshotRow[]` from `getRankHistory`
 * (ASC by checked_at); we re-derive earliest/latest from `checked_at` rather
 * than trusting array position, so a caller passing an unsorted slice is safe.
 */
export function extractWins(
  rankHistory: RankSnapshotRow[],
  opts: ExtractWinsOpts = {},
): RankWin[] {
  const minImprovement = opts.minImprovement ?? DEFAULT_MIN_IMPROVEMENT;

  // group by keyword, keeping only rows with a real (non-null) rank.
  const buckets = new Map<string, RankSnapshotRow[]>();
  for (const row of rankHistory) {
    if (row.rank === null) continue;
    const bucket = buckets.get(row.keyword);
    if (bucket) bucket.push(row);
    else buckets.set(row.keyword, [row]);
  }

  const wins: RankWin[] = [];
  for (const [keyword, bucket] of buckets) {
    // need at least two non-null observations to claim any movement.
    if (bucket.length < 2) continue;

    let earliest = bucket[0]!;
    let latest = bucket[0]!;
    let earliestAt = parseCheckedAt(earliest.checked_at);
    let latestAt = earliestAt;
    for (let i = 1; i < bucket.length; i++) {
      const row = bucket[i]!;
      const at = parseCheckedAt(row.checked_at);
      if (at < earliestAt) {
        earliest = row;
        earliestAt = at;
      }
      if (at > latestAt) {
        latest = row;
        latestAt = at;
      }
    }

    // ranks are guaranteed non-null here (null rows were filtered out above).
    const from = earliest.rank as number;
    const to = latest.rank as number;
    const improvement = from - to;
    if (improvement < minImprovement) continue;

    wins.push({
      keyword,
      from,
      to,
      improvement,
      spanDays: (latestAt - earliestAt) / MS_PER_DAY,
    });
  }

  wins.sort((a, b) => b.improvement - a.improvement);
  return wins;
}

/** Median of a non-empty numeric list (caller guarantees length > 0). */
function median(sortedAsc: number[]): number {
  const mid = sortedAsc.length >> 1;
  return sortedAsc.length % 2 === 1
    ? sortedAsc[mid]!
    : (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

/**
 * PURE. Fan the per-app win lists into the anonymized aggregate that backs the
 * landing-page stat ("real movement across N apps"). Deliberately emits ONLY
 * numbers — no app names, no emails, no keywords — so it can be shown publicly.
 */
export function aggregateProof(winsByApp: RankWin[][]): ProofAggregate {
  let appsWithWins = 0;
  const improvements: number[] = [];

  for (const appWins of winsByApp) {
    if (appWins.length > 0) appsWithWins++;
    for (const win of appWins) improvements.push(win.improvement);
  }

  if (improvements.length === 0) {
    return {
      appsWithWins: 0,
      totalWins: 0,
      bestImprovement: 0,
      medianImprovement: 0,
    };
  }

  const sorted = [...improvements].sort((a, b) => a - b);
  return {
    appsWithWins,
    totalWins: improvements.length,
    bestImprovement: sorted[sorted.length - 1]!,
    medianImprovement: median(sorted),
  };
}
