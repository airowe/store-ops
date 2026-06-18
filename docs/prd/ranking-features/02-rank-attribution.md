# PRD 02 — Rank tracker + movement attribution

> The proof feature. Tie each rank change to the metadata change that (correlationally)
> preceded it: "after you added 'stoic' to your keywords, you went unranked → #18
> on 'stoic'." This is what makes ShipASO sticky — it shows what *worked*.

## The move
We have weekly `rank_snapshots` (per keyword, over time) and the run/approval log
(when a metadata change was pushed, and what it changed — `currentCopy` →
`proposedCopy` diffs). Join them on time: for each keyword that moved, find the
most recent pushed metadata change before the move, and present them together.

## Inputs (already captured)
- `rank_snapshots` — per-keyword rank over time (the existing `rankDeltasView`).
- Runs + approvals — when a change was approved/pushed (status `shipped`/approved),
  and the field diff (`currentCopy`/`proposedCopy` already on the trace).
- The keyword each change targeted (from `proposedCopy.keywords` + reasoning).

## Deliverable
`cloud/src/engine/rankAttribution.ts` — pure:
```ts
export type RankMovement = {
  keyword: string;
  from: number | null; to: number | null; delta: number | null; direction: ...;
  attributedChange?: {            // the push that likely drove it (correlational)
    runId: string; pushedAt: string;
    addedTerms: string[];         // terms added to keywords/subtitle in that push
    note: string;                 // "added 'stoic' to the keyword field"
  };
  confidence: "linked" | "coincident" | "none";  // never "caused"
};
export function attributeRankMovements(input: {
  rankHistory: RankSnapshot[];
  pushes: { runId; pushedAt; addedTerms; }[];
}): RankMovement[];
```
- `confidence`: `linked` = the moved keyword was a term added by a push before the
  move; `coincident` = moved but no matching change; `none` = no movement.

## UI
- Extend the existing rank-movement card: a moved keyword with an attributed change
  shows a small "↳ after you added 'stoic' (Jun 12)" line + a link to that run.
- A per-app "what moved & why" timeline (optional, post-MVP).

## Honesty (critical)
- **Correlation, never causation.** Copy: "after you changed X, rank moved Y" /
  "this followed your push" — NEVER "X caused the rank change." ASO has many
  inputs (Apple's algo, seasonality, competitors). The confidence enum encodes this.
- Only attribute when the moved keyword was actually in the pushed change.

## TDD
Pure: a keyword added in a push then improving → `linked` with the right note; a
move with no matching push → `coincident`; no false "caused" language anywhere.

## Acceptance
- `attributeRankMovements` links moves to pushes correctly, labels confidence,
  never claims causation.
- The rank card shows the attribution line for linked movements.
