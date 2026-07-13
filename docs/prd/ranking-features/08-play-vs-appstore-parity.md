# Ranking parity — where Google Play stands vs the App Store (2026-07)

> The ranking-features PRDs (`00`–`06`) were written for iOS. This one answers a
> direct question: **how much of our ranking engine actually runs for Google Play
> today, and what closes the gap?** It's a status + plan doc, grounded in the
> current engine code (`engine/rankCheck.ts`, `chartRank.ts`, `play/playChartRank.ts`,
> the `rank_snapshots` table, and the four analysis modules).
>
> **Update — parity steps 1–4 are now BUILT (this PR).** Chart rank is persisted
> (`play_rank_snapshots`), Play keyword **search rank** exists and persists into the
> shared `rank_snapshots` (so the analysis modules run for Play keyword rank), and
> autocomplete **discovery** (`playSuggest`) is built. The scoreboard below is the
> "before" state; the ✅/⏳ markers in "Path to parity" track what landed. Remaining:
> a Play rank-delta **card** (web) and flipping the search-rank flag on after we
> accept the scrape's reliability/ToS cost.

## Short answer

We measure **three** kinds of "rank" and persist **one**. On iOS all three run and one is
a time series. On Play we have exactly **one** of the three, and **nothing is persisted**.

- **iOS** is a ranking *engine*: keyword search rank is **measured and stored as a weekly
  time series**, top-charts rank is measured on-demand, and four analysis modules
  (opportunity / attribution / war-room / annotations) consume the history.
- **Play** is a ranking *reading*: only **category chart rank** is measured (keyless,
  #221), it's **recomputed every audit and never stored**, there is **no Play keyword
  search rank at all**, and **none** of the analysis modules have Play data to run on.

So: Play has caught up on the *chart* half of "measured rank," but has none of the
*persistence* or *keyword-rank* or *analysis* that make iOS a ranking engine rather than a
snapshot.

## The scoreboard (what's actually in the code)

| Capability | App Store (iOS) | Google Play | 
|---|---|---|
| **Keyword search rank** (organic position for a term) | ✅ **measured + persisted** — `rankCheck.ts` `ranksFor()` over the iTunes Search index, written to `rank_snapshots` per country by the snapshot cron | ⛔ **not built** — no module queries Play search for the app's index |
| **Category / top-charts rank** | ✅ measured, **on-demand only** — `chartRank.ts` off the marketing-tools RSS feed; attached to the run, not stored | ✅ measured, **on-demand only** — `playChartRank.ts` + `playChartSource.ts` (keyless `vyAe2` chart), degrade-safe; merged into audit findings, **not stored** |
| **Rank persistence** (time series) | ✅ `rank_snapshots` (`+country`, #180) — keyword rank only | ⛔ **none** — no Play writer, no Play row, cron is iOS-only |
| **Rank opportunity score** | ✅ `rankOpportunity.ts` | ⛔ no Play history to score |
| **Rank-movement attribution** | ✅ `rankAttribution.ts` (ties moves to your pushes) | ⛔ no Play history to attribute |
| **Competitor rank war-room** | ✅ `rankWarRoom.ts` | ⛔ no Play history |
| **Rank-timeline annotations** | ✅ `rankAnnotations.ts` | ⛔ no Play history |
| **Per-market rank** | ✅ `rank_snapshots.country` + `localeKeywords.ts` (#180) | ⛔ chart rank takes a `country` arg but nothing is stored per market |

**Bottom line:** the only thing MEASURED-and-PERSISTED anywhere is **iOS keyword search
rank**. iOS *and* Play both have on-demand category rank. Everything else — Play keyword
rank, all Play persistence, and the entire analysis layer for Play — is **not built**.

## Why the gap exists (it's structural, not neglect)

Two of the three gaps trace straight to the Play/iOS asymmetries in `../google-play/01-data-map.md §0`:

1. **iOS has a free keyless Lookup + Search; Play does not.** iOS keyword rank is cheap and
   low-risk (`itunes.apple.com/search`, sanctioned, keyless). The Play equivalent is
   *scraping* `play.google.com/store/search` — ToS-grey and **429-prone from a Worker's
   datacenter egress** (`01 §1`). So Play keyword rank isn't just "unbuilt," it carries a
   reliability/ToS cost iOS keyword rank doesn't.
2. **Play search rank is noisier.** Play personalizes search results harder than the App
   Store, so a single scraped integer position is lower-confidence (`01` Open-Q #4). This is
   *why* chart rank shipped first for Play — charts are stabler than search.
3. **Persistence was simply scoped to iOS first.** `rank_snapshots` and the snapshot cron
   only run the iOS `ranksFor` path. No structural blocker — just not yet extended.

## Path to parity (ordered by value ÷ effort)

Each step reuses existing machinery and stays inside the measured-or-null / degrade-safe
discipline the Play engine already follows.

1. ✅ **Persist Play chart rank as a time series.** *(S — highest leverage. DONE.)* We
   already *measured* it (#221) and threw it away. Now a sibling **`play_rank_snapshots`**
   table (schema.sql + migration 0003, both idempotent) stores each measured sample from
   the owner audit path; `persistPlayChartRank` (no-op on UNKNOWN) + `getPlayChartRankHistory`.
   Keyed by (collection, category, country) — a chart position is not a keyword position.
2. ✅ **Play keyword search rank (scrape), reliability-gated.** *(M. DONE, flag-gated.)*
   `playSearchRank.ts` + `playSearchSource.ts` mirror `rankCheck.ts`: scrape Play search,
   find the app's index → rank, with a coarse **bucket** (top-3/10/20/50) that the finding
   leads with (Play personalizes; the integer is evidence only). Degrades to `null` on a
   429. Wired into the owner audit behind **`PLAY_SEARCH_RANK_ENABLED`**, and persisted into
   the shared `rank_snapshots` (keyword-keyed, per market).
3. ✅ **Point the analysis modules at Play history.** *(DONE by construction.)* Because Play
   search rank persists into the **same `rank_snapshots`** the iOS modules read, and
   `rankOpportunity` / `rankAttribution` / `rankWarRoom` key on `app_id` (store-agnostic),
   they run for Play keyword rank the moment step 2 writes rows — no per-module change.
4. ✅ **Autocomplete keyword discovery (`IJ4APc`) as the honest volume replacement.** *(DONE,
   engine.)* `playSuggest.ts` — the keyless suggest source + a zero-volume discovery finding
   (`playSuggestFinding`), ready to feed the store-neutral keyword reasoner and give the
   search-rank tracker real terms to track. (Wiring it into a discovery route is the follow-up.)

**Remaining to full parity:** a Play **rank-delta card** in the web app (read
`getPlayChartRankHistory` / the Play rows of `rank_snapshots`), and flipping
`PLAY_SEARCH_RANK_ENABLED` on once we accept the scrape's reliability/ToS cost.

## Honesty guardrails specific to Play rank

Carried from the rest of the product, sharpened for Play:

- **No fabricated position, ever.** Measured index, an honest "not in the top N," or `null`
  UNKNOWN — the exact `playChartRank` contract, extended to keyword rank.
- **No Play keyword *volume*, ever** (`01 §0.5`, §4) — demand is expressed as *measured
  rank*, never a modeled volume presented as fact.
- **Chart rank ≠ keyword rank.** Keep them distinct surfaces — a category-chart position is
  not a search-keyword position, and the UI must not conflate them.
- **Attribution is correlational** — "after your change, rank moved," never "caused."
- **Degrade-safe, market-and-time-stamped** — a Worker 429 yields UNKNOWN, and every Play
  rank prints its market + as-of date because scraped Play rank is noisier than iOS.

## Recommendation

Do **step 1 first** — persisting the chart rank we already measure is a small change that
converts Play from a one-shot reading into a tracked series and immediately makes two of the
four analysis modules useful for Play. Steps 2–4 then bring Play keyword rank and full
analysis parity, gated for the reliability/ToS realities that make Play search rank
genuinely harder than iOS.
