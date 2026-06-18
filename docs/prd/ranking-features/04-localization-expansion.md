# PRD 04 — Localization rank expansion

> Each App Store locale is a SEPARATE keyword surface (its own name/subtitle/
> keywords that rank independently). Most apps ship one locale and leave ranking
> surfaces unclaimed. Recommend the highest-ROI locales to add for the app's category.

## The move
We read ALL locales (`readAscAllLocales`) + the app's category (`readAscAppInfo`).
If the app is live in few locales, each *added* localization is a fresh set of
keyword fields competing in that storefront. Rank the candidate locales by
expected ROI (storefront size × category fit × low incremental effort — same
keywords often translate).

## Inputs
- ASC all-locales (which locales exist + their completeness).
- ASC category (the relevance lens).
- A STATIC locale-value model (storefront size + language reach) — bundled data,
  not a live call. Honest about being a heuristic, tunable.

## Deliverable
`cloud/src/engine/localizationExpansion.ts` — pure:
```ts
export type LocaleRecommendation = {
  locale: string;            // e.g. "es-MX"
  rationale: string;         // "large storefront, strong category fit, easy add"
  storefrontTier: "large"|"mid"|"long-tail";
  alreadyLive: boolean;
  effort: "translate"|"new";  // do you have copy to translate, or net-new?
};
export function recommendLocales(input: {
  liveLocales: string[]; category?: string;
}): LocaleRecommendation[];   // sorted by ROI, alreadyLive excluded
```

## UI
- A "Expand to more markets" section: the top recommended locales with rationale,
  and (post-MVP) a "draft this locale's metadata" affordance that runs the
  optimizer for that storefront.

## Honesty
- The locale-value model is a STATIC heuristic (storefront size + reach), not live
  install data. Say "high-opportunity markets for your category," not "you'll get N
  more installs." Don't fabricate numbers.

## TDD
Pure: single-locale app gets recommendations; already-live locales excluded;
sort by tier; category influences ordering.

## Acceptance
- `recommendLocales` returns ROI-sorted locale suggestions, excluding live ones.
- UI shows the recommendations with honest, non-fabricated rationale.
