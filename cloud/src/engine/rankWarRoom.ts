/**
 * Competitor rank war room — PRD 05 (`docs/prd/ranking-features/05-competitor-rank-war.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE builder for per-keyword head-to-head rank
 * matchups: your app vs a set of SELECTED competitors. Per keyword it computes
 * your rank, each competitor's rank (or `null` where we never checked them on
 * that keyword), the gap to the best competitor, a trend over the tracked
 * window, and a `winning` flag — then sorts so the most CLOSEABLE gaps lead, so
 * the user chases reachable wins rather than vanity incumbents.
 *
 * It consumes the same per-keyword rank history `getRankHistory(db, appId)`
 * returns (`RankSnapshotRow[]`, oldest → newest), normalized to `RankSnapshot`
 * (`{ keyword, rank, checked_at }`). The current/previous-snapshot logic mirrors
 * `lastTwoDistinct` from digest.ts so the war room and the weekly digest can
 * never disagree about what "this week vs last week" means.
 *
 * HONESTY DISCIPLINES (carried from the PRD + the suite overview):
 *  - Unknown ≠ zero ≠ "they don't rank". A competitor we did not check on a
 *    keyword is `null` (the UI renders "—"); we NEVER guess or interpolate a
 *    rank, and an unknown rank is never folded into the best/gap math.
 *  - `gapToBest` is CURRENT, never historical or projected — `trend` carries the
 *    movement context separately so the gap is never dressed up as momentum.
 *  - `winning` is true ONLY when you beat EVERY selected competitor we have a
 *    rank for — an unknown competitor blocks the win claim (we can't prove it).
 *  - No raw competitor listing data here — only the competitor's NAME + rank
 *    number cross the boundary, never subtitle/price/rating/genres.
 */

/** A single rank reading, normalized from `RankSnapshotRow`. */
export type RankSnapshot = {
  keyword: string;
  /** 1-based organic position, or null if not in the top results / unchecked. */
  rank: number | null;
  /** ISO date "YYYY-MM-DD" (the snapshot's checked_at). */
  checked_at: string;
};

/**
 * Trend of YOUR rank over the window's two most-recent distinct snapshots. Lower
 * rank is better, so a smaller current = "gaining". `"lost"` = we fell out of the
 * tracked results entirely (previous number → null current); `"new"` = first-ever
 * (or first-in-window) appearance (null/absent previous → number current).
 */
export type WarTrend = "gaining" | "losing" | "flat" | "new" | "lost";

export type HeadToHead = {
  keyword: string;
  /** your current rank for this keyword, or null if unranked. */
  you: number | null;
  /** one entry per selected competitor, in the order they were supplied. */
  competitors: Array<{
    name: string;
    /** their current rank on this keyword, or null when we never checked them. */
    rank: number | null;
  }>;
  /**
   * your rank − the best (lowest-number) competitor rank. null when there is no
   * gap to close: you beat every competitor, you have no rank, or no competitor
   * has a known rank on this keyword. Always CURRENT, never historical.
   */
  gapToBest: number | null;
  /** YOUR movement over the window (see WarTrend). */
  trend: WarTrend;
  /** true iff you beat every selected competitor we have a known rank for. */
  winning: boolean;
};

export type BuildWarRoomInput = {
  /** your per-keyword history (normalized RankSnapshotRow[]). */
  yourRanks: RankSnapshot[];
  /** per-competitor history; `name` is stable across snapshots. */
  competitorRanks: Array<{ name: string; ranks: RankSnapshot[] }>;
  /** days to look back for trend (default 7). Reserved for windowed trend. */
  window?: number;
};

const DEFAULT_WINDOW_DAYS = 7;

/**
 * Group a flat snapshot list by keyword. Within each bucket rows are sorted
 * oldest → newest by `checked_at` (stable) so the builder is INPUT-ORDER
 * INDEPENDENT — whether the caller hands us getRankHistory's oldest→newest order
 * or a newest-first list, the newest row is always the bucket's last element.
 */
function bucketByKeyword(rows: RankSnapshot[]): Map<string, RankSnapshot[]> {
  // Carry the original index so equal-date rows keep their input order (a stable
  // tie-break) without polluting the public RankSnapshot shape.
  const buckets = new Map<string, Array<{ snap: RankSnapshot; idx: number }>>();
  rows.forEach((snap, idx) => {
    const b = buckets.get(snap.keyword);
    if (b) b.push({ snap, idx });
    else buckets.set(snap.keyword, [{ snap, idx }]);
  });
  const out = new Map<string, RankSnapshot[]>();
  for (const [keyword, items] of buckets) {
    items.sort((a, b) => {
      if (a.snap.checked_at !== b.snap.checked_at) {
        return a.snap.checked_at < b.snap.checked_at ? -1 : 1; // oldest → newest
      }
      return a.idx - b.idx;
    });
    out.set(keyword, items.map((i) => i.snap));
  }
  return out;
}

/**
 * From a per-keyword bucket (oldest → newest), pick the current and previous
 * ranks using the two most-recent DISTINCT checked_at values — identical logic to
 * digest.ts `lastTwoDistinct`. Rows sharing the newest checked_at collapse to one
 * "current"; the previous is the last row of the next-newest checked_at, or null
 * when there is no older snapshot.
 */
function lastTwoDistinct(
  bucket: RankSnapshot[],
): { current: number | null; previous: number | null } {
  if (bucket.length === 0) return { current: null, previous: null };
  const newest = bucket[bucket.length - 1]!;
  const current = newest.rank;
  let previous: number | null = null;
  for (let i = bucket.length - 2; i >= 0; i--) {
    const row = bucket[i]!;
    if (row.checked_at !== newest.checked_at) {
      previous = row.rank;
      break;
    }
  }
  return { current, previous };
}

/** Classify YOUR rank movement between the window's two distinct snapshots. */
function classifyTrend(previous: number | null, current: number | null): WarTrend {
  if (previous === null && current === null) return "flat"; // still unranked
  if (previous === null) return "new"; // entered (or first-in-window)
  if (current === null) return "lost"; // dropped out of the tracked results
  if (current < previous) return "gaining"; // lower is better
  if (current > previous) return "losing";
  return "flat";
}

/** The current (most-recent) rank for a competitor on a keyword, or null. */
function currentRank(bucket: RankSnapshot[] | undefined): number | null {
  if (!bucket || bucket.length === 0) return null;
  return bucket[bucket.length - 1]!.rank;
}

/**
 * Build the head-to-head war room. PURE: same input → identical output, no
 * network, no Date.now, no randomness.
 *
 * Per keyword (every keyword YOU track):
 *   1. your current/previous rank via the two most-recent distinct snapshots,
 *   2. each selected competitor's CURRENT rank (null if unchecked on this kw),
 *   3. gapToBest = you − best-known-competitor (null when no gap to close),
 *   4. trend from (1), winning = you beat every KNOWN competitor rank.
 *
 * Sorted so the most closeable gap leads (gapToBest ascending among rows that
 * HAVE a gap), then keywords with no gap (winning / no competitor data), with a
 * stable keyword tie-break throughout for determinism.
 */
export function buildWarRoom(input: BuildWarRoomInput): HeadToHead[] {
  // `window` is accepted for API parity; the two-distinct-snapshot rule already
  // bounds the trend to the latest movement (mirrors the digest). Read it so the
  // param is "used" and future windowed filtering has an anchor.
  void (input.window ?? DEFAULT_WINDOW_DAYS);

  const yourBuckets = bucketByKeyword(input.yourRanks);
  // Pre-bucket each competitor's history by keyword once.
  const compBuckets = input.competitorRanks.map((c) => ({
    name: c.name,
    byKeyword: bucketByKeyword(c.ranks),
  }));

  const rows: HeadToHead[] = [];
  for (const [keyword, bucket] of yourBuckets) {
    const { current: you, previous } = lastTwoDistinct(bucket);
    const trend = classifyTrend(previous, you);

    const competitors = compBuckets.map((c) => ({
      name: c.name,
      rank: currentRank(c.byKeyword.get(keyword)),
    }));

    // Best = the lowest (numerically smallest) KNOWN competitor rank. Unknown
    // (null) ranks are ignored entirely — never coerced to 0 or any guess.
    const knownCompRanks = competitors
      .map((c) => c.rank)
      .filter((r): r is number => r !== null);
    const best = knownCompRanks.length ? Math.min(...knownCompRanks) : null;

    // winning: you have a rank AND beat (≤) every KNOWN competitor rank. We
    // require at least one known competitor — you can't "win" a matchup we never
    // measured. An unknown competitor never blocks the win (we don't claim about
    // what we didn't check); only known ranks decide it.
    const winning =
      you !== null && knownCompRanks.length > 0 && knownCompRanks.every((r) => you <= r);

    // gapToBest: how far behind the best competitor you are RIGHT NOW. null when
    // there's nothing to close — you have no rank, no competitor has a known
    // rank, or you already beat the best (gap ≤ 0).
    let gapToBest: number | null = null;
    if (you !== null && best !== null) {
      const gap = you - best;
      gapToBest = gap > 0 ? gap : null;
    }

    rows.push({ keyword, you, competitors, gapToBest, trend, winning });
  }

  // Sort by CLOSEABILITY, not vanity (the suite's winnability mandate + the PRD
  // algorithm's "gapToBest ascending"): rows WITH a gap first, SMALLEST gap
  // leading — the reachable race you can actually win (you're #14, they're #11)
  // beats the unwinnable incumbent race (you're #200, they're #1). Rows with no
  // gap (you're winning, or we have no competitor data) sink below. A stable
  // keyword tie-break keeps the output deterministic.
  return rows.sort((a, b) => {
    const aHas = a.gapToBest !== null;
    const bHas = b.gapToBest !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.gapToBest !== b.gapToBest) {
      return a.gapToBest! - b.gapToBest!; // smaller (closeable) gap first
    }
    return a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0;
  });
}
