---
name: aso-rank-check
description: Read an app's organic App Store search rank for a list of keywords and append the result to a dated log, so you can SEE whether a keyword/metadata change actually moved the needle over time. Uses the free public iTunes Search API (no paid ASO API, no auth). The watch half of the ASO loop — closes the gap left by aso-keyword-research (picks) and aso-metadata-optimization (ships). Use after shipping new keywords, or on a schedule, to verify ranking outcomes.
---

# aso-rank-check

The **watch** half of the ASO loop. The other skills *pick* keywords
(`aso-keyword-research`) and *ship* them (`aso-metadata-optimization`); this one
tells you whether the picks actually paid off — your organic rank for each term,
logged over time so you can see it move.

This is the piece the paid rank-trackers (Astro, AppTweak, etc.) charge a
subscription for. We get it for free: the public **iTunes Search API** returns
apps in the App Store's own relevance/ranking order, so your app's index in that
list **is** its organic rank for the term. No account, no key, no scraping.

## Inputs

- `--bundle <id>` — the app's bundle id (e.g. `app.airowe.clarity`, `com.chat.swoop`).
  Resolve from the app's `app.json` / `Info.plist` if you don't know it.
- `--keywords "a,b,c"` — the terms to check. Default: read the live keyword
  field via `aso-audit` (or `marketing/aso/<app>/aso-copy.md`) so you track
  exactly what you're targeting.
- `--country <US>` — App Store country (default US).
- `--app <slug>` — used only to name the log file (`marketing/aso/<app>/ranks.md`).

## Method

1. For each keyword, call the iTunes Search API
   (`entity=software`, up to 200 results) and find the app's `bundleId` in the
   ordered results. Its 1-based index is the organic rank; absent → "not in top N".
2. **Append** a dated row block to `marketing/aso/<app>/ranks.md` — never
   overwrite. The point is the time series: each run is one snapshot, and the
   deltas between runs are the signal.
3. Surface the deltas vs. the previous logged run (↑ improved, ↓ dropped,
   `new`, `lost`) so a glance tells you what the last change did.

```bash
python3 lib/aso_rank_check.py \
    --bundle app.airowe.clarity \
    "agnostic,aurelius,stoic,mindfulness,journal,philosophy" --json
```

Each row: `keyword`, `rank` (1-based or null), `found_name` (the app's listed
name at that rank — an identity sanity-check), `total_results` (how many apps
competed), `limit` (how deep we scanned).

## Output — `marketing/aso/<app>/ranks.md`

A growing, dated log. Example shape:

```
## 2026-06-11 · US · App Store

| keyword     | rank | Δ vs prev | competitors |
|-------------|------|-----------|-------------|
| agnostic    | #45  | —         | 52          |
| aurelius    | #84  | ↑ +6      | 133         |
| stoic       | —    | lost      | 184         |
```

A "—" rank is honest signal, not a failure: it means the app isn't in the top
200 for that head term — usually the aspirational/unwinnable cluster the
research skill told you to *track, not target*. Watching a "—" turn into a real
rank is how you know a long-tail bet is landing.

## How it closes the loop

- `aso-keyword-research` → which keywords to bet on (with reasoned volume).
- `aso-metadata-optimization` → ships them to the listing.
- **`aso-rank-check`** → did they land? Re-feed the answer:
  - A targeted keyword still "—" after a few weeks → it was too hard; demote it
    to aspirational and reclaim the keyword-field characters.
  - A long-tail term climbing → the bet's working; consider promoting it toward
    the subtitle.
  This is the feedback signal that turns one-shot optimization into a loop.

## Run it on a schedule

Rank moves over weeks, not minutes. Run weekly (e.g. a cron / scheduled-marketing
entry) per app and let `ranks.md` accumulate. The deltas are only meaningful
across time — a single snapshot is a starting line, not a result.

## Honest limits

- **App Store only.** The iTunes Search API ranking reflects App Store search.
  Google Play's public ranking endpoints are fragile/rate-limited; for Play, drive
  a search in Chrome and read the result order manually. The keyword *field* (the
  thing this verifies) is an iOS concept anyway.
- The Search API order is Apple's blended relevance, which weighs more than your
  metadata (installs, ratings, recency). It's the same ranking real users see, so
  it's the right number to watch — just don't expect metadata alone to fully
  explain it.
- `total_results` caps at ~200 (Apple's limit). Beyond that the app is "—"; you
  can't distinguish #201 from #5000, and you don't need to — both mean "not
  ranking."

## No external dependency

Standard-library Python + the free public iTunes Search API. No paid ASO SaaS,
no API key, no auth. (grep this skill for "appeeky"/"apptweak" → none.)
