/**
 * rankFill — fraction [0,1] for a rank bar. Honest by construction: a null
 * (unmeasured) rank returns 0 and the RankBar renders NOTHING (the row shows
 * "—"); a measured rank maps monotonically with a floor sliver so even a deep
 * measured rank stays visibly distinct from "no data". cap=50: ranks past 50
 * hit the 0.02 floor.
 */
export function rankFill(rank: number | null, cap = 50): number {
  if (rank == null) return 0;
  if (rank <= 1) return 1;
  return Math.max(0.02, 1 - (rank - 1) / cap);
}
