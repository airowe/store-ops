# PRD (reference) — Google Play data map: where Play listing data actually comes from

> Companion to `00-implementation-plan.md`. That doc **chose** the data-plane
> abstractly (option a licensed API / b scrape / c official API) and defined the
> `PlayDataSource` seam. This doc is the **concrete research** behind that choice:
> exact endpoints, fields, auth, rate limits, ToS, Cloudflare-Worker fit, and how
> each surface maps onto ShipASO's honesty model and the iOS features we already
> shipped. It fills the gaps `00` left as "TBD" and is the Play sibling of the
> App Store map in `../analytics-reports/04-public-data-map.md`.
>
> **See also:** [`02-new-surfaces.md`](./02-new-surfaces.md) scopes the buildable
> surfaces from the 2026-07 refresh (vitals expansion, data-safety write, funnel
> ingest) into landable increments; [`../ranking-features/08-play-vs-appstore-parity.md`](../ranking-features/08-play-vs-appstore-parity.md)
> tracks how much of the ranking engine runs for Play vs iOS.
>
> **Status: research / decision-support.** Some of this is now built (the keyless
> web reader, the Android vitals finding, and the keyless category **chart rank** all
> shipped — see the engine's `play/` modules); the rest is *available and unbuilt*.
> The legend marks the **trust tier** each surface lands in, because that is what the
> honesty model keys off.
>
> **2026-07 refresh (verified against the live Discovery docs — `androidpublisher`
> rev 20260706, `playdeveloperreporting` rev 20260709).** §3 gained a **Data Safety
> *write* API** and **four new vitals metric sets**; the funnel gained a **BigQuery
> Data Transfer** path (§3.3). Two **undocumented** API surfaces beyond the scrape
> tier were evaluated and **rejected** — the device-facing `fdfe/` protobuf API and
> the internal Play Console backend (new **§7**). The three big ⛔ gaps (experiments,
> custom listings, a conversion *query* metric set, keyword volume) were re-checked
> and **still have no API**.

## Legend — trust tier (maps to `NormalizedListing.reliable`)

- 🌐 **keyless public** — scrape tier. Any competitor by package name, **no key**.
  `reliable:false` → an empty field/screenshot set is **UNKNOWN, not zero**.
- 🔑 **licensed API** — a vendor's sanctioned JSON. Any competitor, **costs money**,
  vendor holds the scraping exposure. Still `reliable:false` (visible listing only).
- 🔒 **owner-keyed** — official Google API with the developer's own service account.
  **Owner-only** (never a competitor), `reliable:true` → absence is real.
- ⛔ **no honest source** — needs a number Google does not publish; we don't fake it.

---

## 0. The seven asymmetries vs iOS (this is the "expand our awareness" core)

Everything below reduces to seven ways Play is **not** iOS. These are the facts
that must not be ported blindly from the App Store engine:

1. **No free keyless Lookup.** iOS gets a sanctioned, free, keyless
   `itunes.apple.com/lookup`. Play has **nothing equivalent**. Its keyless tier is
   *undocumented scraping* of `play.google.com` internal endpoints
   (`AF_initDataCallback` blobs + the `batchexecute` RPC), which Google's ToS
   forbids ("don't … access [our Services] using a method other than the interface
   … we provide", policies.google.com/terms) and actively rate-limits (429s;
   [google-play-scraper#590](https://github.com/facundoolano/google-play-scraper/issues/590)).
   **So Play's "public" tier costs either money (licensed API) or ToS/IP risk (scrape)** —
   there is no free lunch the way iOS has one. This is the single biggest structural
   difference and it drives the whole data-plane choice in `00`.

2. **Google splits what Apple unifies.** Apple gives one owner key (App Store Connect)
   for metadata **and** an async Analytics funnel. Google splits it across **three**
   surfaces: `androidpublisher` (metadata, §3), `playdeveloperreporting` (Android
   **vitals only** — *not* the funnel, §3), and a **Cloud Storage CSV export** that is
   the *only* official home of installs/acquisition/ratings history (§3.3).

3. **No keyword field; the long description IS the keyword surface.** iOS indexes
   name/subtitle/**keywords** and does *not* index the description. Play has **no
   keyword field** and indexes title (30) + short desc (80) + **long desc (4000)**.
   Consequence: keyword **repetition in the long description** is simultaneously a
   ranking lever **and a spam-rejection risk** — the *inverse* of iOS's "fill the
   100-char field." (`GOOGLE_PLAY_PROFILE` already encodes `hasKeywordField:false`.)

4. **Android vitals are a Google-DOCUMENTED visibility lever — no iOS analogue.**
   Play states outright that exceeding a technical-quality threshold "may reduce the
   visibility of your title" **and show users a warning on the store listing"**
   ([developer.android.com/topic/performance/vitals](https://developer.android.com/topic/performance/vitals)).
   VERIFIED thresholds (28-day, user-perceived): **crash rate 1.09%** overall / 8% per
   phone model; **ANR rate 0.47%** overall / 8% per phone model. Apple exposes crash
   metrics but never ties App Store ranking to them. **This is the highest-value new
   signal in the whole study** — a cited, factual ranking input we can audit.

5. **No Play keyword search volume exists anywhere — honest or not.** Not in Play
   Console, not in any Google API. Google Ads / Keyword Planner volume is **Google
   *web* search**, wrong corpus (`KeywordPlanNetwork` enum is only `GOOGLE_SEARCH` /
   `GOOGLE_SEARCH_AND_PARTNERS` — there is no Play network). **Every** third-party
   "Play search volume" number is a vendor **model** (AppTweak self-describes theirs
   as autosuggest-presence cross-referenced with *Apple's* iOS popularity index).
   So Play inherits #65's stance harder than iOS: **we never show a Play volume as
   measured.**

6. **PPO and CPP exist on Play but have ZERO official API — and they're *more*
   capable than Apple's.** Play's **store listing experiments** (= Apple Product Page
   Optimization) and **custom store listings** (= Apple Custom Product Pages) are
   **Console-UI-only** — no create/read/results verb in `androidpublisher` *or*
   `playdeveloperreporting`. The iOS PPO-read (#182) and CPP-audit (#154) features we
   shipped have **no owner-API data source on Play**. Two capability deltas worth
   knowing (VERIFIED, product-relevant even though unreadable by API): Play experiments
   can **A/B-test the short *and* long description copy** — Apple PPO **cannot** test
   description text at all — and Play custom listings target by **country / Google Ads
   audience / install-referrer**, not just Apple CPP's URL-only targeting. So the *advice*
   we can give a Play owner is richer than iOS even though the *data* is Console-locked.

7. **Play-only listing surfaces with no iOS field.** Data-safety section, IARC
   content rating (regional, vs Apple's single global band), "contains ads" flag, IAP
   price *range* string, **install-count buckets** (ranges — honest by construction),
   a **Google-curated tags** system (~5, no iOS analogue), the **required feature
   graphic** (1024×500 — and it's a *hard gate*: the promo video won't render without
   it), and the **YouTube-URL trailer** (a URL to lint, vs Apple's hosted App Preview
   binary). Phone screenshots: **min 2 to publish, 4+ for featuring eligibility, max 8**,
   plus separate 7"/10" tablet slots. These are net-new audit surfaces, not ports.

---

## 1. 🌐 The keyless public tier (scrape) — reachable, ToS-grey, IP-gated

How the de-facto reference impl
([`facundoolano/google-play-scraper`](https://github.com/facundoolano/google-play-scraper))
actually reads Play. Two transports: **(A)** the app pages ship pre-rendered JSON
inside `<script>AF_initDataCallback(...)</script>` blobs (keyed `ds:0`, `ds:1`, …,
parsed by regex); **(B)** an internal RPC `POST https://play.google.com/_/PlayStoreUi/data/batchexecute`.

> ⚠️ **The `rpcids=` in the batchexecute query string is stale/hard-coded** — the
> real RPC id is the first string inside the `f.req` envelope. VERIFIED real ids below.

| Surface | Transport | Endpoint / rpcid | Key fields |
|---|---|---|---|
| **App detail** | A (GET) | `…/store/apps/details?id=<pkg>&hl=&gl=` (`ds:5`) | title, description(+HTML), **recentChanges** (What's New), score, **ratings count**, **histogram** (1–5), **installs bucket** + **minInstalls/maxInstalls** numeric, price, offersIAP, **IAPRange**, icon, **headerImage (feature graphic)**, screenshots[], video, developer{name,email,website,address}, version, androidVersion, genre/genreId, **contentRating** (IARC), **adSupported** (contains ads), released, updated, **privacyPolicy** URL, editorsChoice |
| **Search** | A (GET) | `…/store/search?c=apps&q=<term>&hl=&gl=` | ordered app rows → **derive rank by index** |
| **Suggest / autocomplete** | B (POST) | rpcid **`IJ4APc`** | up to ~5 completion strings — real Play search terms, **no volume** |
| **Reviews** | B (POST) | rpcid **`UsvDTd`** | id, userName, score, date, text, replyText, version, thumbsUp; `nextPaginationToken` |
| **Permissions** | B (POST) | rpcid **`xdSrCf`** | permission name + group (common/dangerous/other) |
| **Data safety** | A (GET) | `…/store/apps/datasafety?id=<pkg>&hl=` (`ds:3`) | sharedData[], collectedData[] {data,purpose,optional,type}, securityPractices[], privacyPolicyUrl |
| **Similar / more-by-dev** | A (GET) | detail-page cluster (serviceRequestId `ag2B9c`) | app rows (search shape) |
| **Top charts / `list()`** | B (POST) | rpcid **`vyAe2`** | `TOP_FREE`/`TOP_PAID`/`GROSSING` by category+country → **measured "#N in category"** |

- **Auth:** none on any of these. **ToS:** disallowed by Google ToS (see §0.1). Same
  posture we already accept for the iTunes-search scrape on iOS — but Google enforces
  harder.
- **Rate-limit reality:** no published quota (undocumented endpoints). Google returns
  **429s** at volume and throttles/blocks **datacenter/cloud egress IPs** aggressively.
  A **Cloudflare Worker's shared egress is exactly the range most likely to be
  blocked** — plan for low request rates or a residential/rotating proxy in front.
  (Vendor "rotate every 50–100 req / residential ~90% vs datacenter ~30%" figures are
  market lore, not Google-published — treat as INFERRED.)
- **Worker fit:** the endpoints are Worker-friendly (`fetch` GET for pages, `POST`
  `application/x-www-form-urlencoded` for batchexecute; parse with regex + `JSON.parse`;
  **no headless browser needed** — Play ships the data server-rendered). But **do NOT
  `npm i google-play-scraper`** — it depends on `got`/`tough-cookie` (Node http),
  which don't map to Workers. **Reimplement the ~8 request builders + parsers on
  `fetch`.** The fragile parts are Google's `bl=` build-label and the giant `f.req`
  field-masks (hard-coded 2019/2022 constants) — schema drift is the top maintenance
  hazard, so this is exactly why `00` isolates it behind the swappable `PlayDataSource`.

---

## 2. 🔑 The licensed API tier — any competitor, sanctioned JSON, costs money

The honest way to "audit any competitor's Play listing" without owning the scrape/ToS
risk. Vendor holds the collection exposure; we call a plain REST+JSON endpoint (Worker
`fetch`). **Still `reliable:false`** — even a licensed API returns only the *visible*
listing, never owner-truth or measured search volume.

| Vendor | Listing by package | Histogram | Numeric installs | Data safety | Keyword **rank** | Keyword **volume/difficulty** | Entry price | Model |
|---|---|---|---|---|---|---|---|---|
| **DataForSEO** | ✅ `app_info` | ? | ✅ | ? | ✅ (Labs Play) | partial | **$0.0006/call** | pure PAYG |
| **42matters** | ✅ (richest) | ✅ | ✅ min/max | ✅ | ✅ | ✅ (`keyword_stats`) | ~€79/mo | hits sub |
| **SerpApi** | ✅ `google_play_product` | ✅ | ✗ bucket | ✅ | index-derived | ✗ | $75/5k + **$2M US shield** | sub |
| **SearchAPI.io** | ✅ | ✅ | ✗ bucket | ? | index-derived | ✗ | $40 / 100 free | sub |
| **AppTweak** | ✅ | ~ | est. | ~ | ✅ | ✅ (modeled) | credit sub, 100k trial | sub |
| **Oxylabs** | ✅ structured scraper | ~ | ✅ | ✗ | parse | ✗ | ~$49/mo | sub+PAYG |
| **Sensor Tower / data.ai** | ✅ (richest) | ✅ | ✅ | ✅ | ✅ | ✅ | **$5k–20k/yr API** | **enterprise-only** |

**Recommendation for the `PlayDataSource` binding:**
- **Cheapest "audit any competitor by package":** **DataForSEO** (~$0.0006/listing, no
  monthly floor; verify histogram + data-safety field presence on docs first), or
  **SerpApi `google_play_product`** for the cleanest turnkey JSON with a confirmed
  ratings histogram + data-safety block **and a $2M collection-liability shield** (the
  strongest ToS posture of any vendor).
- **If we also want Play keyword rank + a labeled vendor-modeled volume:** **42matters**
  (`app_keyword_ranking` + `keyword_stats`) or **AppTweak** are the only self-serve
  vendors exposing both as first-class metrics.
- **Exclude Sensor Tower / data.ai** (merged into Sensor Tower, 2024): enterprise
  contracts only, no per-call tier.
- **Honesty rule for imported vendor numbers:** any vendor "search volume/difficulty"
  is a **model** — surface it **only** badged "3rd-party estimate (modeled)", never as a
  measured Play number, or omit it. (This is #65 applied to Play.)

---

## 3. 🔒 The owner-keyed tier — official Google APIs (owner-only, `reliable:true`)

The Play analogue of connecting an ASC key. Two APIs **plus** a Cloud Storage export.
All owner-only: every call is scoped to a `packageName` the caller's **service account**
was granted in that developer's Play Console (Users & permissions → invite the SA email;
**propagation up to 48 h**). **Never reads a competitor** — same trust model as ASC.

### 3.1 Android Publisher API (`androidpublisher` v3) — high-fidelity metadata read
Scope `…/auth/androidpublisher`. **Read model:** `edits.insert` opens an edit (a copy of
live state) → call the `.get`/`.list` verbs → **never `commit`** → nothing publishes
(the edit auto-expires). VERIFIED: reads have **no write side effect**. Caveat: **one
open edit per user identity** — serialize per developer account or you invalidate your
own in-flight edit.

| Verb | Returns |
|---|---|
| `edits.listings.get` / `.list` | per-language **title, shortDescription, fullDescription, video** |
| `edits.details.get` | defaultLanguage, contact email/phone/website |
| `edits.images.list` | screenshots + feature graphic + icon per **type × language** (`AppImageType`: `phoneScreenshots`, `sevenInchScreenshots`, `tenInchScreenshots`, `icon`, `featureGraphic`, …) — returns URL + content hash, **no captions** (Play has none → screenshot text must be OCR'd from bytes, exactly like our #182 caption lens) |
| `edits.tracks.list` | release tracks, `releaseNotes` per language, `userFraction` |
| `reviews.list` / `.get` / `.reply` | owner reviews — **⚠️ only the last ~7 days**, 100/page; history needs continuous polling+persist or the GCS export (§3.3) |
| `inappproducts` / `monetization.subscriptions` / **`monetization.onetimeproducts`** (NEW) | IAP / subscription / one-time-product catalog |
| **`applications.dataSafety`** (NEW, **WRITE**) | `POST …/applications/{pkg}/dataSafety` with a `SafetyLabelsUpdateRequest` (`safetyLabels` CSV string) — "Writes the Safety Labels declaration of an app." The first official way to **push** the data-safety form (we could previously only *read* it, scraped). Closes the loop on the data-safety-consistency lint (§6.5). |

**Quotas:** 200k req/day; 3k/min per bucket; 429 on overage. **This is what gates the
`fastlane supply` handoff in `00` §4** — the owner-grounded read.

> **Other new-since-2023 `androidpublisher` resources (VERIFIED, non-ASO — noted for
> completeness):** `externaltransactions` (alternative-billing reporting),
> `apprecovery`, `generatedapks` / `systemapks` (download Google-built split APKs),
> `edits.countryavailability`, `orders` (get/batchget/refund), and v2 purchase-state
> models (`purchases.subscriptionsv2` / `productsv2`). None touch store-listing metadata
> beyond `edits.listings/details/images`, so they don't change the audit surface.

### 3.2 Play Developer Reporting API (`playdeveloperreporting` v1beta1) — vitals ONLY
Scope `…/auth/playdeveloperreporting`. **Synchronous `:query` POST** (unlike Apple's
async report jobs); read `FreshnessInfo` per metric-set for the latest available datapoint
rather than assuming a fixed lag; **10 QPS**. Metric-set inventory is **entirely Android
vitals/errors** — now **8 vitals sets** (four added since our first pass, VERIFIED in the
rev-20260709 Discovery doc): `vitals.crashrate`, `vitals.anrrate`,
`vitals.errors.{counts,reports,issues}`, `vitals.slowstartrate`, **`vitals.excessivewakeuprate`**,
**`vitals.stuckbackgroundwakelockrate`**, **`vitals.slowrenderingrate`**, **`vitals.lmkrate`**
(low-memory-kill); plus `anomalies.list` and `apps.search`. That is the **complete** v1beta1
tree — nothing else exists.

> **VERIFIED ABSENCE (load-bearing):** there is **no** installs / acquisitions /
> conversion / retained-installer / ratings metric set. **The Play conversion funnel
> has no query API.** This is the #1 fidelity drop vs our Apple Analytics Reports
> integration (#183–#185).

### 3.3 The GCS bulk export — the ONLY programmatic funnel/history source
Every developer account has a private bucket `gs://pubsite_prod_rev_<accountId>/` with
**monthly CSVs**: `stats/installs/`, `stats/ratings/`, `stats/store_performance/`
(store-listing visitors → acquisitions), `reviews/`. Accessed via the GCS API. **~3–7 day
lag, monthly rollups, owner-only.** It is a **file-ingestion problem, not an API query** —
the closest official twin of Apple's Engagement/acquisition series, but coarser and
staler. This is where any honest Play "conversion moved" story has to come from.

> **Two supported ways to ingest it (both service-account OAuth, no scraping):**
> **(1)** read the CSVs straight from the GCS bucket; **(2)** the **BigQuery Data
> Transfer Service "Google Play" connector** (`cloud.google.com/bigquery/docs/play-transfer`),
> which lands the *same* user-acquisition (store-analysis + **conversion-analysis
> funnel**), reviews, and financial reports into BigQuery on a schedule. Since the
> March-2021 export refresh these reports **do include the store-listing
> acquisition/conversion funnel** — so the funnel *is* officially reachable, just
> monthly + lagged. This is the cleanest Play answer to `00`'s Open-Question #3 and the
> direct sibling of the iOS Engagement ingest (analytics-reports `02`).

---

## 4. ⛔ What has no honest source

| Data | Why no honest version |
|---|---|
| **Play keyword search volume** | Does not exist in any Google surface. Ads/Keyword Planner is *web* search, wrong corpus. All vendor "Play volume" is modeled (§0.5). We show **discovery + measured rank**, never a fabricated volume. |
| **Conversion funnel via query API** | Only Play Console UI or the stale monthly GCS CSV (§3.3). No `:query` metric set exists. |
| **Store-listing-experiment results (PPO)** | Console-UI-only. No experiment resource in any API — can't read variant/uplift/confidence. |
| **Custom-store-listing performance (CPP)** | Console-UI-only. `edits.listings` addresses only the *default* listing by BCP-47 language; no custom-listing/group dimension anywhere. |
| **A competitor's owner-truth** | Owner-only by construction — every official verb is scoped to a package you were granted. |
| **Full review history via API** | `reviews.list` is a ~7-day window; history only via GCS `reviews/` export or continuous persistence. |

---

## 5. Honesty consequences — where "unmeasured"/`null` must appear for Android

Extends `00` §6 with the surfaces this research pinned down:

1. **No Play search-volume number, ever.** Autocomplete gives **discovery** (real
   terms, zero volume — nothing to fake); demand is expressed as **measured rank**, not
   volume. Any vendor volume is badged "modeled estimate" or omitted.
2. **Public/licensed absence is UNKNOWN (`reliable:false`).** An empty screenshot/field
   set from scrape or a vendor grades `?`, never "grade F" — the direct port of iOS's
   `dataReliable:false`.
3. **`keywordField` is structurally `null`.** Absent, not "empty." UI must never render a
   Play "0/100 keyword field."
4. **Install counts are buckets/ranges** ("1,000,000+"). Surface the range verbatim; if a
   vendor gives numeric min/max (42matters, DataForSEO) show the **bounds**, never a
   fabricated point estimate.
5. **Vitals is measured & cited; "velocity/uninstall/retention/freshness" are NOT.** Only
   crash-rate/ANR-rate (and recency-weighted ratings) are Google-**documented** ranking
   inputs — assertable as fact with a citation + threshold. Install velocity, uninstall
   rate, retention, update-freshness are **vendor-inferred correlations** — the audit must
   frame them as hypotheses, never documented rules.
6. **Funnel movement, if shown, is monthly & lagged (GCS), or absent.** No live-query
   conversion number exists — don't imply one.
7. **PPO/CPP on Play carry no data** — render as a capability gap ("Play has no experiment
   API"), never a fabricated result.

---

## 6. Product opportunities — what to build, honestly (the "help the product" ask)

Ranked by value ÷ effort. Each reuses machinery we already have.

1. **🌐 Category chart rank → `chart_rank` (Play).** The `list()` (`vyAe2`) chart is
   keyless, low-noise, and yields a **measured "#N in <category> (<country>)"** — the
   cleanest measured Play position, exact twin of the iOS top-charts-RSS `chart_rank` in
   `../analytics-reports/04-public-data-map.md`. Highest value, lowest risk. Persist a
   time series like `rank_snapshots`.
2. **🌐 Measured search-result rank per market.** Same pattern as our iTunes-search
   rank scrape: query Play search for a term, find the app's index → rank. Reuses the
   #180 per-locale `rank_snapshots.country` work. Report **with a timestamp + market**;
   bucket (top-3/10/50) when personalization noise is high; never print false-precision.
3. **🌐 Autocomplete (`IJ4APc`) keyword discovery.** Real terms Play surfaces, zero
   volume — the honest replacement for a volume table, feeding `keywordReasoner` (which
   is already store-neutral).
4. **🔒 Android vitals audit finding (VERIFIED, cited).** Highest-value *new* finding:
   "you exceed Google's 1.09% crash / 0.47% ANR threshold → Play may reduce visibility
   and show a store-listing warning," cited to `developer.android.com/topic/performance/vitals`.
   Data from `playdeveloperreporting` `vitals.crashrate`/`anrrate`. No iOS analogue — a
   genuine expansion of what ShipASO can measure.
5. **🌐/🔒 Play review-risk lint (extends #178).** Hard, enumerable **title rules**
   (≤30 chars, no emoji/kaomoji, no ALL-CAPS unless brand, no "#1/best/top/free/% off"
   performance-or-price claims) + **long-description keyword-stuffing** guard (repetition
   is a Play *spam-rejection* risk, the inverse of iOS field-fill) + **data-safety ↔
   privacy-policy consistency** + **content-rating (IARC) mismatch** + **impersonation**.
   All trace to Google policy pages, so the citations are as verbatim as the iOS guideline
   corpus (#178 Phase 2).
6. **🌐 Play-only surface audit:** missing **feature graphic** (required, 1024×500),
   thin **long description** (under-using the 4000 indexed chars), missing short
   description, screenshot count vs phone/7"/10" families — plugs into the generalized
   `screenshotScore` + the Play `playFindings` rule set from `00` §3.
7. **🔒 Reviews sentiment (owner).** `reviews.list` (7-day) + GCS `reviews/` history →
   the same sentiment surface we built on the iOS RSS feed (#95).

**Deliberately NOT built:** any Play keyword *volume* number; any PPO/CPP *result* read
(no API); any live conversion-funnel query (only monthly GCS). Those are §4 ⛔ — surfaced
as honest capability gaps, not faked.

---

## 7. Undocumented APIs beyond the scrape tier — evaluated & rejected (2026-07)

§1 covers the `play.google.com` **storefront** scrape (`AF_initDataCallback` + `batchexecute`),
which we already accept and use. Two *other* undocumented surfaces exist and are richer —
both were investigated and **rejected as a product dependency**. Recorded here so they're on
the ledger as *considered*, not overlooked.

### 7.1 ⛔ The device-facing `fdfe/` protobuf API (the Play Store *app's* own API)
`https://android.clients.google.com/fdfe/{details,bulkDetails,search,searchSuggest,list,rev,rec}` —
protobuf `DocV2` envelopes, the API the Android Play Store client uses. Reference impl:
`AuroraOSS/gplayapi` (maintained). **Uniquely richer than the HTML scrape:** exact rating
**histograms** (`oneStarRatings`…`fiveStarRatings`) + exact `ratingsCount`/`commentCount`
(the web listing rounds/hides these), **structured search + category-chart ranking**
(`fdfe/search`, `fdfe/list` bucket paging), `relatedSearch`, `fdfe/rec` "similar apps", and
structured sale-vs-full pricing.

**Why rejected:** auth needs a Google **account token** (an AAS master token) *plus* a
registered **GSF device id** — there is **no keyless mode**. Google aggressively bans the
dummy accounts (Aurora took its anonymous token-dispenser *down* "to safeguard accounts").
It is bound to residential/mobile-device egress; a **Cloudflare Worker's shared datacenter IP
is exactly what Google throttles/blocks**. And the protobufs are reverse-engineered and drift.
So it's the technically-richest source but needs an account farm + device profiles +
residential proxies — a **research probe from a real device at most**, never the backbone of a
keyless Worker product. (If we ever want exact competitor histograms, this is the only source —
but pay a **licensed vendor (§2)** for them instead of running an account farm.)

### 7.2 ⛔ The internal Play **Console** backend (the dashboard's private RPCs)
The developer Console (`play.google.com/console`) is a jspb SPA calling private
`batchexecute` / `*.clients6.google.com` RPCs — *technically* the only path to the three
Console-locked datasets (**experiment/PPO results, CPP conversion, the live funnel**).

**Why rejected:** there is **zero** published reverse-engineering of the *Console* rpcids
(all community work targets the storefront), so we'd be first and alone maintaining it; it
authenticates with the developer's **own Google-account cookies + a per-request `SAPISIDHASH`**
(not a service account) — so detection risks the **account that owns their apps and revenue**;
and it violates ToS with no prior art. The funnel is better taken from the **supported
GCS/BigQuery export** (§3.3); **experiments + CPP conversion** have **no** legitimate
programmatic source and stay ⛔ (§4) — surface them via user-supplied CSV/screenshot upload,
never an automated Console session.

> **Net:** neither undocumented surface changes the data-plane recommendation. The scrape
> tier (§1) + licensed vendors (§2) + the owner APIs & export (§3) remain the honest set;
> `fdfe/` and the Console backend are documented dead-ends.

---

## Recommendation (build order)

1. **`store/profiles` are done.** Next: the keyless `PlayDataSource` reader
   (reimplement app-detail + search + `list` + suggest + datasafety on `fetch`, behind
   the injected seam) — unlocks opportunities 1–3, 6 with **zero paid dependency**.
2. **`chart_rank` (Play)** — mirror the iOS chart-rank module; the single highest-value
   measured Play signal, keyless. Ship first.
3. **Licensed `PlayDataSource` binding** (DataForSEO or SerpApi) for competitor audits
   where the scrape tier's IP-block/ToS risk is unacceptable — swappable behind the same
   seam, so it's a config choice, not a rewrite.
4. **Owner tier** (`androidpublisher` read + vitals) — opportunities 4, 7 and the gated
   `fastlane supply` handoff (`00` §4). Vitals finding is the marquee feature.
5. **Play review-risk lint** — extends #178's corpus/quote machinery to Play policy.

Each step is independently shippable and leaves iOS untouched, exactly like `00`'s order.

---

## Open questions

1. **Scrape vs licensed as the *default* public tier.** The Worker's shared egress makes
   direct scrape 429-prone; do we default to a licensed `PlayDataSource` (paid, reliable)
   and treat scrape as a fallback, or run scrape with a residential proxy? (Cost vs ToS/
   reliability — the core `00` tradeoff, now with concrete 429 evidence.)
2. **Vendor pick + legal.** DataForSEO (cheapest PAYG) vs SerpApi ($2M shield) vs
   42matters (richest + keyword rank/volume). Confirm each vendor's **caching/
   redistribution clause** for a product that stores competitor listings (the one open
   legal item across all vendor ToS).
3. **Funnel story on Play.** Accept the monthly/lagged GCS CSV as the only official
   "conversion moved" source, or omit funnel on Play until Google ships a query API?
4. **Rank noise calibration.** Empirically measure run-to-run variance of scraped Play
   search rank per market before printing single-integer positions (charts are stabler
   than search — prefer chart rank where possible).
5. **Vitals data source.** `playdeveloperreporting` is owner-keyed — for a keyless
   competitor audit, is the *public* "data safety" + listing completeness enough, with
   vitals reserved for the connected tier?
