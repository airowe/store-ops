# PRD 02 — similarApps → competitor discovery ("Apple's graph")

> The storefront page's "You Might Also Like" shelf is Apple's OWN answer to
> "who competes with this app" — free, already parsed
> (`StorefrontListing.similarApps`), and each entry carries the one field the
> iTunes lookup API never returns: the competitor's **subtitle**. Make it a
> second discovery source next to keyword search, and let those subtitles feed
> the keyword-gap engine, which already tokenizes `subtitle` but has only ever
> seen `""` there.

## Strategic frame

Intelligence platforms (AppKittie-class) sell "similar apps" panels scraped at
scale; we get the same graph from a page we already fetch once per audit, at
zero marginal cost. Honestly framed, this is Apple's editorial/behavioral
association — not proof of keyword competition — so it complements, never
replaces, our search-derived discovery (#72-C), and the two must stay visibly
distinct in the UI. The real compounding win is downstream: competitor
subtitles finally reach `findKeywordGaps`, unlocking subtitle-term gap intel
that lookup-only pipelines structurally cannot see.

## What exists (read these first)

- `cloud/src/engine/storefrontListing.ts` — `StorefrontApp { bundleId, name,
  subtitle?, rating?, ratingCount? }`; `StorefrontListing.similarApps?`.
  The audit already carries it as `audit.storefront` (StorefrontIntel seam).
- `cloud/src/engine/competitorWatch.ts` — `discoverCompetitors` (search-derived,
  #72-C; spec lives in `competitorDiscover.spec.ts`), `lookup(by:'bundleId')`.
- `cloud/src/d1.ts` + `schema.sql` — `app_competitors` (source `'user'|
  'discovered'`, status `'suggested'|'confirmed'`; comp_key = trackId).
- `POST /apps/:id/competitors/discover` in `cloud/src/api/index.ts`.
- `cloud/src/engine/keywordGap.ts` — `findKeywordGaps` already reads
  `CompetitorListing.subtitle` (dormant: iTunes lookup never fills it).

## Deliverable

**Engine — new `cloud/src/engine/competitorDiscover.ts`** (pure + FetchFn-injected;
move `discoverCompetitors` + `DiscoveredCompetitor` here from `competitorWatch.ts`,
re-export for compat):

```ts
export type DiscoverySource = "search" | "apple_similar";

export type DiscoveredCompetitor = {
  key: string;                    // App Store trackId, stringified (comp_key)
  name: string;
  source: DiscoverySource;
  matchedKeywords: string[];      // search-derived only; [] for apple_similar
  subtitle?: string;              // apple_similar only, when the shelf carried one
  rating?: number;                // as shown on Apple's page at read time
  ratingCount?: number;
};

// Pure: drop self (bundleId/name), dedupe, cap. No network.
export function filterSimilarApps(
  similar: StorefrontApp[],
  opts: { selfBundleId?: string; selfName?: string; limit?: number },
): StorefrontApp[];

// bundleId → trackId via lookup(by:'bundleId') so keys dedupe against
// search-derived rows and stay watchable. Unresolvable entry → skipped
// (never a half-row). Never throws.
export async function resolveSimilarCompetitors(
  fetchFn: FetchFn,
  similar: StorefrontApp[],
  opts: { selfBundleId?: string; selfName?: string; country?: string; limit?: number },
): Promise<DiscoveredCompetitor[]>;
```

**D1/schema** — `app_competitors.source` gains `'apple_similar'`. SQLite CHECK
constraints can't be altered in place: db-migrate rebuilds the table (create-new
→ copy → rename), BEFORE deploying a Worker that writes the new value.
`upsertCompetitor` unchanged (status precedence preserved: re-discovery from
either source never downgrades a confirmation; existing rows keep their source).

**Endpoint** — `POST /apps/:id/competitors/discover` runs BOTH sources: keyword
search (as today) + the app's own storefront page (one `fetchStorefrontListing`
of `app.track_view_url`, or the latest `audit.storefront` when fresh). Both land
as `status:'suggested'`; response items carry `source` so the UI labels
"From Apple's 'similar' graph" vs "Surfaces for your keywords". Search-derived
rows win a key collision (they carry keyword evidence).

**keywordGap hook** — no `keywordGap.ts` change. When confirmed competitors are
watched, fill `Listing.subtitle` from their storefront page (same
`fetchStorefrontListing`, safe-degrade to `""` = today) so `findKeywordGaps`'
existing subtitle tokenization finally receives real data.

## Honesty rules (verbatim for this feature)

- Apple's graph is an ASSOCIATION signal, not measured keyword competition.
  Say "Apple lists this app as similar"; never "competes with you for X" —
  `matchedKeywords` stays `[]` for `apple_similar`, never invented.
- Suggestions are never silently watched: `status:'suggested'` until the human
  confirms (#72). Only confirmed rows feed runs + the sweep — unchanged.
- `rating`/`ratingCount` are shown only when the shelf carried them, labeled as
  page-read-time values. Absent → "?" — never 0, never a lookup-backfilled guess.
- A missing/unreadable storefront page degrades discovery to search-only
  (a note, not an error); an unresolvable bundleId skips that candidate.
- A subtitle feeding keywordGap means "this competitor VISIBLY uses this term" —
  never a causal rank claim (PRD ranking-features/01 discipline, unchanged).

## Test plan (TDD — specs first, red before green)

- `competitorDiscover.spec.ts`: `filterSimilarApps` drops self by bundleId and
  by folded name, dedupes, caps; `resolveSimilarCompetitors` resolves via
  bundleId lookup, skips unresolvable entries, sets `source:'apple_similar'`,
  `matchedKeywords: []`, carries subtitle/rating only when present; never throws
  on a failing fetch. Moved search-derived specs stay green.
- API spec: discover endpoint merges both sources; collision keeps the
  search row; storefront 403 → search-only + no error; new rows `suggested`.
- `keywordGap.spec.ts` addition: a competitor Listing with a real subtitle
  yields subtitle-term gaps with correct attribution (proves the dormant path).
- `d1.competitorsSchema.spec.ts`: `'apple_similar'` insert accepted post-migration.

## Non-goals

- No auto-confirmation, no auto-watch, no change to the confirmed-only run flow.
- No crawling of similar apps' OWN pages at discovery time (their subtitles come
  from the shelf; full listings only once confirmed and watched).
- No transitive graph walks (similar-of-similar), no Google Play equivalent.
- No dashboard redesign — the existing suggestions list gains a source label only.

## Open questions

1. Resolution cost: up to ~16 iTunes lookups per discover call (bundleId→trackId).
   Cache in-memory per call is trivial; do we need a D1-backed resolution cache?
2. Should `moreByDeveloper` (same shape, same shelf parser) be excluded from
   candidates explicitly, or is self-bundleId filtering enough for shared-seller apps?
3. When the latest `audit.storefront` exists, is "fresh enough" 7 days, or do we
   always re-fetch the page on an explicit discover click?
4. Table-rebuild migration vs. dropping the CHECK entirely (validate in code):
   which does the db-migrate workflow prefer for D1?
