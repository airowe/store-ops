# PRD 01 — Keyword gap finder

> Find keywords your competitors rank for that **you don't** — and that fit your
> remaining metadata budget — so the optimizer (and the user) chase real gaps.

## The move
For each tracked competitor, we already fetch its live listing (`competitorWatch
.lookup`/`lookupAll`) and we know your live keywords (ASC read). The gap = terms
present in competitors' name/subtitle/(inferred) keywords where YOU either don't
rank or don't target them. Surface the gaps ranked by value.

## Inputs (all already captured)
- Your live keyword field + name + subtitle (ASC `readAscLocalization` / snapshot).
- Competitor listings (`competitorWatch`) — their name/subtitle.
- Your rank history (`rank_snapshots`) — which terms you already rank for.
- Keyword scoring (`scoreKeyword`: volume·0.4 + (100−difficulty)·0.3 + relevance·0.3).

## Deliverable
`cloud/src/engine/keywordGap.ts` — pure:
```ts
export type KeywordGap = {
  keyword: string;
  competitorsUsing: string[];   // which tracked competitors use it
  youRank: number | null;       // your current rank for it, if any
  inYourMetadata: boolean;      // already in your name/subtitle/keywords?
  score: number;                // keyword score (winnability-weighted in #06)
  fitsBudget: boolean;          // would it fit your remaining keyword chars?
};
export function findKeywordGaps(input: {
  yourCopy: { name?; subtitle?; keywords? };
  yourRanks: Rank[];
  competitors: CompetitorListing[];
}): KeywordGap[];   // sorted: not-in-metadata + high-score first
```
- A gap is a term a competitor uses that is NOT in your metadata AND you don't
  rank top-50 for. Sort by score desc; flag `fitsBudget` from remaining char room.

## UI
- A "Keyword gaps" section on the run page (and/or a finding `keyword_gap` linking
  to it): top N gaps, each showing which competitors use it, your rank (— if none),
  and a "feed to next run" affordance that adds it to the optimizer's target set.
- Degrades without ASC (uses public listing) — richer with the ASC keyword read.

## Honesty
- Don't claim a competitor "ranks #1 because of keyword X" — we infer term usage
  from their listing, not their ranking algorithm. Say "competitors use this term;
  you don't."
- `fitsBudget` is advisory; the optimizer still enforces the 100-char limit.

## TDD
Pure unit tests: gaps detected from fixtures; terms already in your metadata
excluded; terms you already rank for de-prioritized; sort order; budget flag.

## Acceptance
- `findKeywordGaps` returns sorted gaps from competitor + your-listing fixtures.
- UI lists gaps with competitor attribution + your rank; feeds the optimizer.
- Graceful without ASC.
