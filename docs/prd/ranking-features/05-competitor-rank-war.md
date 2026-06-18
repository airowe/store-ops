# PRD 05 — Competitor rank war room

> Head-to-head: for a set of chosen competitors, show per-keyword rank vs. yours,
> over time, with the gap to close and where you're winning/losing. Builds on #25
> (competitor-selectable rank deltas).

## The move
We track competitors (`competitor_snapshots`) and rank keywords (`rank_snapshots`).
The war room joins them: for each keyword × each selected competitor, show both
ranks and the delta, plus the trend. Turns "I rank #18" into "I rank #18, the
competitor I care about ranks #4 — here's the gap and whether it's closing."

## Inputs (already captured)
- Your rank history (`rank_snapshots`).
- Competitor listings + (where available) their ranks for shared keywords.
- The user's competitor selection (the #25 selector).

## Deliverable
`cloud/src/engine/rankWarRoom.ts` — pure:
```ts
export type HeadToHead = {
  keyword: string;
  you: number | null;
  competitors: Array<{ name: string; rank: number | null }>;
  gapToBest: number | null;     // your distance to the best competitor
  trend: "gaining"|"losing"|"flat"|"new";  // over the tracked window
  winning: boolean;             // you beat every selected competitor
};
export function buildWarRoom(input: {
  yourRanks: RankSnapshot[];
  competitorRanks: { name; ranks: RankSnapshot[] }[];
  window?: number;
}): HeadToHead[];   // sorted: biggest closeable gaps first
```

## UI
- The "Rank war room": a per-keyword head-to-head grid (you vs. selected
  competitors), the gap, and a trend chip. Reuse the animated delta styling (#24).
- A competitor selector (the #25 surface) drives which rivals show.

## Honesty
- We can only show competitor ranks for keywords we actually checked them on;
  unknown = "—", not a guess. Don't imply we track every competitor keyword.

## TDD
Pure: head-to-head built from fixtures; gapToBest math; trend over a window;
winning flag; sort by closeable gap.

## Acceptance
- `buildWarRoom` returns sorted head-to-heads with correct gap/trend/winning.
- UI shows the grid driven by the competitor selector (#25).
- Closes/absorbs #25.
