# PRD 06 — Rank opportunity score

> The winnability ranker. For every keyword, score it by how *reachable* a real
> rank gain is — not just raw volume — so users chase the wins they can actually
> get instead of vanity terms. The honest signal competitors fake.

## The move
A high-volume keyword you're #180 on with three giant incumbents is NOT an
opportunity. A mid-volume term you're #14 on with weak competitors IS. The
opportunity score fuses:
- **Volume / relevance** (we have `scoreKeyword`).
- **Your distance to the top 10** (from `rank_snapshots` — closer = more winnable).
- **Competitor strength** on that term (weak/absent rivals = winnable).
- **Trend** (already gaining = momentum to ride).

## Inputs (all already computed)
- `rank_snapshots` (your rank + history per keyword).
- `scoreKeyword` (volume·0.4 + (100−difficulty)·0.3 + relevance·0.3).
- Competitor ranks for shared keywords (`competitorWatch`).

## Deliverable
`cloud/src/engine/rankOpportunity.ts` — pure:
```ts
export type Opportunity = {
  keyword: string;
  rank: number | null;
  opportunityScore: number;     // 0–100, winnability-weighted
  why: string;                  // "close to top 10, weak competitors, gaining"
  reachability: "now"|"soon"|"longshot";
  drivers: { volume: number; distance: number; competitorWeakness: number; momentum: number };
};
export function rankOpportunities(input: {
  ranks: RankSnapshot[]; keywordScores: Record<string, number>;
  competitorRanks?: { name; ranks: RankSnapshot[] }[];
}): Opportunity[];   // sorted by opportunityScore desc
```
- The formula MUST weight reachability so it never sends a #200/weak-app user to
  chase "games". Distance-to-top-10 and competitor weakness are first-class terms.

## UI
- A "Where to push next" panel on the run page / dashboard: the top opportunities,
  each with `why` + reachability chip ("now" green / "soon" amber / "longshot" dim).
- Feeds the optimizer: the top "now"/"soon" opportunities become its target terms.

## Honesty
- The score is a heuristic, framed as "most winnable next," not a guarantee. The
  `reachability` enum is the honest hedge.
- "longshot" terms aren't hidden — labeled, so the user chooses with eyes open.

## TDD
Pure: a close+weak-competitor term outscores a high-volume far+strong one; the
reachability buckets; drivers exposed; sort order. The KEY test: a #1-for-games
scenario must NOT rank as a top opportunity for a weak app.

## Acceptance
- `rankOpportunities` ranks by genuine winnability (the reachability discipline
  proven by tests), exposes drivers + `why`.
- The "where to push next" panel renders, feeds the optimizer's target set.
- This is the recommended FIRST build — leans entirely on data we already compute.
