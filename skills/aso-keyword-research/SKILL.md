---
name: aso-keyword-research
description: Research and rank App Store / Google Play keywords for an app WITHOUT any paid ASO data API. Expands seeds via Apple/Google autocomplete + competitor listing scrape + synonyms, scores each keyword (volume × difficulty × relevance), buckets into Primary/Secondary/Long-tail/Aspirational, and outputs a title/subtitle/keyword-field placement plan. Use when optimizing an app's store keywords, planning a listing, or before metadata optimization. Chains into aso-metadata-optimization.
---

# aso-keyword-research

The ASO *brain* — keyword research that reasons over **free / owned data**, with
**no dependency on a paid ASO API** (AppTweak, Sensor Tower, etc.). This
is the differentiator: every other AI ASO skill routes through a paid data SaaS.

Works for **both** App Store and Google Play.

## Inputs

- `--app <slug>` — your app identifier
- `--seeds "a,b,c"` — 3–5 seed keywords (what your app is about)
- `--locale <en-US>` — target locale (default en-US)
- `--store <appstore|playstore|both>` — default both
- optional `context.md` — a per-app file with category, audience, 3–5
  competitors, brand terms (see `context.template.md`). If present, it sharpens
  expansion and relevance scoring.

## Method (no paid data)

1. **Expand** the seed set from sources the agent can gather for free:
   - **Store autocomplete** — query Apple App Store search suggestions and Google
     Play autocomplete (via WebFetch / Chrome / the store search endpoints) for
     each seed and its prefixes. These suggestions ARE the demand signal — they're
     what real users type.
   - **Competitor listings** — pull the titles/subtitles/descriptions of the
     `context.md` competitors (or top search results for the seeds) and extract
     their keyword choices. App Store / Play pages are JS-heavy and anti-bot, so
     the default path is WebFetch → Crawl4AI fallback. If a `CONTEXT_DEV_API_KEY`
     is set, the bundled context.dev client does this more reliably (see
     **Optional scrape accelerator** below) — but it is never required.
   - **Synonyms / modifiers** — add intent modifiers (free, best, app, tracker,
     planner, for X) and morphological variants.
   - **User language (on- + off-store)** — the highest-signal seeds are the words
     real users actually type. Run **aso-review-mine** (your own App Store
     reviews) and **aso-offstore-mine** ("best <category> apps" articles + YouTube
     review videos) and fold their keyword candidates in as high-relevance seeds.
     off-store mining also surfaces the competitors articles compare you to.
2. **Score** each candidate keyword:
   `score = volume*0.4 + (100 - difficulty)*0.3 + relevance*0.3`
   - **volume** — see **Grounded volume** below. If an Apple Search Ads
     credential is configured, this is Apple's *real* Search Popularity
     (5–100). Otherwise it falls back to an autocomplete-rank proxy + how many
     competitors target it (an honest estimate, labeled as such).
   - **difficulty** — proxied from how many strong competitors already rank /
     target it.
   - **relevance** — how directly the term describes THIS app (LLM judgment vs
     the app's actual function + context.md).
3. **Bucket**:
   - **Primary** — high score, must win (goes in title)
   - **Secondary** — strong, distinct (subtitle / short description)
   - **Long-tail** — lower volume, high relevance, winnable (keyword field / body)
   - **Aspirational** — high volume, high difficulty (track, don't target yet)

## Grounded volume (real data — two sources)

The `volume` axis is the one number that was pure opinion. Ground it on a real
demand source when a credential is present. Two bundled clients, both emitting a
0–100 `volume` ready to drop into the scoring formula above. This is the ASO
analogue of grounding the sportswriter on real stats before it writes.

### Source A — Google Keyword Planner (primary)

Real **average monthly searches** (a raw integer) + competition. Covers App
Store *and* web/Play search intent. No withholding floor — a 0 means Google
genuinely has no volume for that term.

```bash
python3 lib/gads_volume_cli.py \
    "recipe app, meal planner, grocery list" --geo 2840 --lang 1000 --json
```

Each row: `avg_monthly_searches`, `competition` (→ a 0–100 `difficulty`), and a
**log-scaled** `volume` (0–100; search volume is heavy-tailed, so linear scaling
would crush the long tail). `--geo`/`--lang` are Google constant ids (2840=US,
1000=en; 2826=GB, 2276=DE, etc.).

**Credentials** (`.env`, never committed):
- `GADS_DEVELOPER_TOKEN` + `GADS_CUSTOMER_ID` (digits only) **and** either
- `GADS_ACCESS_TOKEN`, or `GADS_REFRESH_TOKEN` + `GADS_CLIENT_ID` + `GADS_CLIENT_SECRET`.
- `GADS_LOGIN_CUSTOMER_ID` optional (MCC accounts).

**Setup gate:** the developer token needs Google approval (~1–2 business days);
test-mode tokens return canned data, not real volumes. See the repo's
`GOOGLE_ADS_SETUP.md` for the click-by-click.

### Source B — Apple Search Popularity (secondary)

Apple's own 5–100 Search Popularity. Use when you specifically want App-Store
demand. Note Apple's account setup is painful and (since Oct-2025) it withholds
SP < 35.

```bash
python3 lib/asa_popularity_cli.py "recipe app, meal planner" --market US --json
```

`ASA_ORG_ID` (this account: `22251290`) + `ASA_ACCESS_TOKEN` or
`ASA_CLIENT_ID`+`ASA_CLIENT_SECRET`. Withheld keywords come back
`below_threshold` with a floored `volume` (≈15), **never 0** — "Apple won't say"
≠ "nobody searches it". SP is *exponential* (SP 50→60 ≫ SP 20→30).

### No credential?

The skill still works — it transparently falls back to the autocomplete-rank
proxy and labels every volume as an estimate (see below).

## Optional scrape accelerator — context.dev

The volume axis has its credentialed upgrades (Apple/Google above). The
*expansion* leg has one too: **context.dev** turns any URL — including JS-heavy,
anti-bot App Store / Play listings — into clean LLM-ready markdown in one call,
and extracts brand data (logos, colors, industry, socials) from a domain.

Same rule as the volume sources: **optional, with a free fallback.** The plugin's
whole point is *no paid data API REQUIRED* — context.dev is to the scrape leg
what Apple/Google are to the volume leg. No key → the skill scrapes via
WebFetch / Crawl4AI exactly as before.

```bash
# competitor listing → markdown (falls back automatically if no key)
python3 lib/context_scrape.py "https://apps.apple.com/us/app/.../id123"
# auto-fill the context.md brand block from the app's marketing domain
python3 lib/context_scrape.py example.com --brand
```

**Credential** (`.env`, never committed): `CONTEXT_DEV_API_KEY`. Base URL / auth
header are env-overridable (`CONTEXT_DEV_API_BASE`, `CONTEXT_DEV_AUTH_HEADER`)
should context.dev's shape shift.

## Output

Writes `marketing/aso/<app>/keywords.md`:
- ranked keyword table (term | bucket | est. volume | difficulty | relevance | score)
- a **placement plan**: which keywords go in title (≤30), subtitle (≤30),
  keyword field (≤100, iOS), Play short description (≤80) / long description.
- explicit note on which numbers are estimates (no paid data) vs. observed.

Chains into **aso-metadata-optimization**, which turns this plan into final copy
+ the exact store-push commands.

## Honest limits

- **Without** an Apple Search Ads credential, volume/difficulty are **proxies**,
  not licensed metrics — the skill labels them as estimates. **With** a
  credential, volume is Apple's real Search Popularity (see Grounded volume);
  difficulty/relevance remain reasoned estimates.
- For a paid-data cross-check the user can still bring their own
  AppTweak/Sensor Tower export — but the skill never *requires* it.
- Autocomplete and SP both reflect *current* demand; re-run periodically.

## No paid SaaS dependency

Core path uses store autocomplete + public listing data via WebFetch/Chrome
only — no paid ASO SaaS (AppTweak/Sensor Tower). The *optional* volume
grounding uses the user's **own** Apple Search Ads account (free with the
account; not a third-party data vendor).


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Keyword opportunity shifts weekly — search trends move, competitors target new terms. A single research pass is a starting line; the wins come from re-running it and acting on the deltas.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
