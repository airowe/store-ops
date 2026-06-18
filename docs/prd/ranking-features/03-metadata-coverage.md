# PRD 03 — Metadata coverage score

> Quantify how much of the user's scarce metadata budget (name 30, subtitle 30,
> keyword field 100) is doing real ranking work vs. wasted on brand repeats,
> dupes, filler, or empty space. A single "coverage %" + the specific waste.

## The move
Apple ranks you on the distinct, relevant terms across name + subtitle + keyword
field. Waste = (a) a word repeated across fields (Apple counts it once), (b) the
app's own brand name burned in the subtitle (ties to #42), (c) low-relevance
filler, (d) unused characters. Score the budget; show what's wasted.

## Inputs (ASC read)
- Live name / subtitle / keyword field (ASC `readAscLocalization`).
- Keyword scoring (`scoreKeyword`) for per-term value.

## Deliverable
`cloud/src/engine/metadataCoverage.ts` — pure:
```ts
export type CoverageReport = {
  coverageScore: number;        // 0–100: working-keyword chars / available budget
  usedChars: { name; subtitle; keywords };   // of 30/30/100
  distinctTerms: number;        // unique ranking terms across all fields
  waste: Array<{ kind: "duplicate"|"brand_repeat"|"filler"|"unused"; detail: string; chars: number }>;
  topMissingValue?: string;     // a high-value term that would fit (links to gap finder)
};
export function metadataCoverage(copy: { name; subtitle; keywords }): CoverageReport;
```

## UI
- A "Metadata coverage" gauge on the run page: the score + a breakdown of waste
  ("'weatherthere' repeats your app name — 12 wasted chars", "3 duplicate terms").
- Each waste item is actionable → feeds the optimizer's next proposal.

## Honesty
- "Coverage" is a heuristic for budget efficiency, not a guarantee of rank. Frame
  as "how hard your metadata is working," not "your rank score."

## TDD
Pure: duplicate detection across fields; brand-repeat detection (name word in
subtitle); char accounting (30/30/100); unused-char calc; coverage math.

## Acceptance
- `metadataCoverage` returns the score + itemized waste from copy fixtures.
- The gauge renders with actionable waste items.
- Ties into #42 (brand-repeat) and #01 (topMissingValue → gap finder).
