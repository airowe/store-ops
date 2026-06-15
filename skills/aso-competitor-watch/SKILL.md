---
name: aso-competitor-watch
description: Track competitors' App Store listing changes over time — name, subtitle, version, price, rating, genres — via the free iTunes Lookup API. Appends a dated snapshot to competitors.md and flags what changed since last run (new/changed/same). Use to catch when a competitor renames, reprices, or reshuffles their listing, which usually signals an ASO move worth reacting to. No paid API.
---

# aso-competitor-watch

Watches your competitors' **visible** App Store listings and tells you what
changed since last time. When a rival renames, rewrites their listing, or
reprices, it's a signal — they found something in the data or they're chasing a
term. This catches it without a paid competitive-intel SaaS.

A natural companion to `aso-rank-monitor`: that watches *your* rank, this watches
*their* listings. Same dated-log, diff-vs-previous pattern.

## Inputs

- `--app <slug>` — names the log (`marketing/aso/<app>/competitors.md`).
- `--ids "111,222"` — competitor App Store **track ids**, or
- `--bundles "com.x,com.y"` — competitor **bundle ids**.
  (Omit both to reuse the previous snapshot's set — so a scheduled run is argless.)
- `--country <US>` · `--root <repo>` · `--date <YYYY-MM-DD>` (passed in; no clock).
- `--json` — emit the change digest as JSON instead of writing the log.

## What it watches

The fields iTunes exposes publicly (a competitor's **keyword field is private** —
not available to anyone): **name, version, price, rating, genres**. These are
what users see and where most visible ASO moves show up. Per competitor it flags:
- `new` — first time seen
- `changed` — one or more watched fields differ (shows from → to)
- `same` — no change · `error` — lookup failed (the run still logs the rest)

```bash
# find competitor ids first (iTunes search returns trackId per result):
#   curl "https://itunes.apple.com/search?term=dating&entity=software&limit=5"
python3 lib/aso_competitor_watch.py \
    --app swoop --ids 595287172,930441707 --root . --date 2026-06-11
# swoop 2026-06-11: 2 new  →  marketing/aso/swoop/competitors.md
```

## Run it on a schedule

Weekly is right (listings don't change daily). One cron line per app, reusing the
prior competitor set:

```
python3 lib/aso_competitor_watch.py \
    --app swoop --root /path/to/repo --date "$(date +%F)"
```

Commit the updated `competitors.md` so git holds the change history. A `changed`
flag on a competitor's **name** is the highest-signal event — it usually means
they're testing a new keyword in the title.

## Honest limits

- **Visible fields only.** No competitor's keyword field, install counts, or
  conversion — those are private. This watches what the store shows publicly.
- iTunes Lookup is per-id; large competitor sets take a few seconds (polite
  pacing between calls). Transient failures (429/5xx) retry with backoff.
- `subtitle` is in the field list but iTunes Lookup rarely returns it; when it
  does, it's tracked.

## No external dependency

Standard-library Python + the free public iTunes Lookup API. No paid competitive
SaaS, no key.


> Want this to just happen? **ShipASO** — the hosted agent — runs the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. Competitors change listings on their own schedule — you catch it by watching on a cadence, not by checking once. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
