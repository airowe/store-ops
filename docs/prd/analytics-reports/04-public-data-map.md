# PRD (reference) — Public App Store data map: what needs no `.p8`

> Companion to `00-overview.md`. The Analytics Reports API needs an **Admin**
> key and a 1–2 day async wait. This maps everything reachable **without any
> key at all** — the top-of-funnel data that keeps ShipASO's keyless audit rich
> and honest — and marks what each public source can and cannot substitute for.

## Legend
- ✅ **used** — the code already reads it.
- 🆕 **available, unused** — public, works today, we don't read it yet.
- 🔒 **keyed only** — no honest public substitute; needs the `.p8` (Admin for analytics).

## The public surfaces

### ✅ iTunes Search API — `https://itunes.apple.com/search`
`cloud/src/engine/constants.ts:20`. Keyword → software results (name, id, bundle,
description, genres, price, avg rating, rating count). Powers competitor
discovery + rank checks. **~20 req/min unauthenticated** — the real constraint.

### ✅ iTunes Lookup API — `https://itunes.apple.com/lookup`
`constants.ts:22`. bundleId/id → one app's metadata + `trackViewUrl`. Note the
known gap (#41): it frequently omits screenshots and NEVER returns the subtitle
— which is why we fall back to the storefront page.

### ✅ Customer-reviews RSS — `/{cc}/rss/customerreviews/…/json`
`constants.ts:31-43`, consumed by review sentiment (#95). Public reviews +
star ratings, paginated, per territory. Caps at ~500 recent reviews/market;
mostrecent or mosthelpful sort.

### ✅ Storefront product-page JSON (`serialized-server-data`)
`cloud/src/engine/storefrontListing.ts` (shipped in the storefront-intel suite).
The richest public source: subtitle, ratings histogram, What's New, privacy
labels, languages, category, IAP names+prices, Apple's `similarApps` graph,
`moreByDeveloper`, and the full screenshot set. Already fully consumed.

### 🆕 Top-charts RSS — `https://rss.marketingtools.apple.com/api/v2/{cc}/apps/{chart}/{n}/apps.json`
**Public, no auth, verified live.** `chart` ∈ `top-free | top-paid | top-grossing`
(+ `new-apps-we-love`, `new-games-we-love`); `n` up to ~200; per country; genre
filterable. Returns ranked app lists with id/name/artist/artwork/genre.
- **What it unlocks (honestly):** *category chart rank* — a MEASURED position
  we don't surface today. "You're #34 in Weather (Top Free, US)" is real and
  free. Cross-referenced with `moreByDeveloper`/`similarApps`, it also gives a
  competitor's chart standing.
- **Limits:** overall/genre top lists only — NOT per-keyword search rank (that's
  our own search-scrape), and it's a snapshot, not history (we'd persist our own
  time series, like `rank_snapshots`).
- **Proposed home:** a small `chartRank.ts` engine + a `chart_rank` finding/annotation;
  natural sibling to the rank-features PRDs. Cheap, keyless, on-strategy.

### 🆕 amp-api storefront reviews — `https://amp-api.apps.apple.com/v1/catalog/{cc}/apps/{id}/reviews`
The API the web App Store itself uses. Richer than the RSS feed (more reviews,
better pagination, developer responses inline). **Caveat: needs a bearer token**
scraped from the storefront page's bootstrap JS — public-ish but fragile (token
rotates; ToS-grey). **Recommendation: do NOT build on it** — the RSS feed we
already use is the stable, honest public review source. Noted only so nobody
rediscovers it and assumes it's free of strings.

## What stays 🔒 keyed — no honest public substitute

| Data | Why no public version |
|---|---|
| **Conversion rate, impressions, product page views** | Analytics Reports API only (Admin + async). The storefront page shows the listing, never its funnel. |
| **Downloads / sessions / retention / deletions** | App Usage report; nothing public exposes install counts. |
| **Your real subtitle/keywords as configured** | Lookup omits subtitle (we get it from the page); the **keyword field** is never public — ASC only. |
| **Per-CPP / per-source performance** | Engagement report segments; the public page can't attribute traffic. |
| **Peer benchmark (download-to-paid)** | Apple's differential-privacy computation; Admin analytics only. |
| **Precise ratings/downloads history** | We snapshot public numbers over time ourselves; Apple's authoritative series is keyed. |

## The honest framing for the product

Public sources make the **keyless audit genuinely useful** — subtitle, ratings
shape, languages, chart rank, competitor graph, reviews — everything the
top-of-funnel "try it free, no signup" wedge promises. But the **conversion
funnel is structurally keyed**: no amount of scraping reveals product-page views
or conversion rate. That boundary is a feature, not a limitation — it's exactly
where "connect your key to see + prove movement" earns the upgrade, and it keeps
the honesty model clean: we never *estimate* a funnel number we can't measure.

## Recommendation (build order)

1. **Top-charts RSS → `chart_rank`** (🆕, keyless, ~1 engine module + finding).
   The single highest-value public gap: a measured position we can surface today
   for every app, keyed or not. Ship independent of the Analytics PRD.
2. **Analytics Reports Phase 1** (`01-request-lifecycle.md`) — the keyed funnel,
   starting with the auth/async spike.
3. Leave amp-api reviews alone; the RSS feed is the stable public review source.

## Open questions

1. Chart-rank snapshot cadence + storage — reuse the `rank_snapshots` table
   shape, or a sibling `chart_snapshots`? Genre resolution: the app's primary
   category maps to which chart genre id?
2. Search API 20 req/min ceiling: chart-rank polling for many apps could add
   load — batch by shared genre/country to amortize.
3. Do we surface competitor chart rank (from `similarApps`) in v1, or self only?
