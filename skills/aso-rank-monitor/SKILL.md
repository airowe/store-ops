---
name: aso-rank-monitor
description: Scheduled App Store rank tracking — run a keyword set on a cadence (weekly), append a dated snapshot to ranks.md, and report the delta vs. the previous run (↑/↓/new/lost). This is the automated tracker the paid tools (Astro, AppTweak) charge a subscription for, built on the free iTunes Search API. Use to watch whether a metadata change actually moved your rank over time, or to set up a recurring per-app rank check.
---

# aso-rank-monitor

The **scheduled** layer on top of `aso-rank-check`. Where rank-check is a one-shot
read, this runs on a cadence, keeps the time series in `ranks.md`, and tells you
what *changed* since last time — which is the whole point of rank tracking.

This is Astro / AppTweak's core product (weekly rank tracking + history + delta
alerts), with no subscription and no paid data: it's the free public iTunes
Search API plus a dated log in your repo, with git as the history.

## Inputs

- `--app <slug>` — names the log dir (`marketing/aso/<app>/ranks.md`).
- `--bundle <id>` — the app's bundle id (e.g. `app.airowe.clarity`).
- `--keywords "a,b,c"` — terms to track. **Optional**: if omitted, it reuses the
  keyword set from the previous snapshot, so a scheduled run needs no arguments
  once seeded.
- `--country <US>` · `--root <repo>` · `--date <YYYY-MM-DD>` (the snapshot date —
  passed in, never read from a clock, so runs are reproducible).
- `--json` — emit the delta digest as JSON instead of writing `ranks.md`.

## What it does

1. Reads the latest snapshot block in `ranks.md` to get the previous ranks.
2. Runs `aso_rank_check` for the keyword set (reusing the prior set if none given).
3. Computes a delta per keyword:
   - `↑ +N` improved (rank number went down — lower is better)
   - `↓ -N` dropped · `new` (was absent, now ranks) · `lost` (was ranking, gone)
   - `—` unchanged · `err` (this term's fetch failed; the run still logs the rest)
4. Appends a new dated block to `ranks.md` and prints a one-line digest
   (`↑2, ↓1, new 1`).

```bash
python3 lib/aso_rank_monitor.py \
    --app heathen --bundle app.airowe.clarity --root . --date 2026-06-11
# heathen 2026-06-11: ↑2, new 1  →  marketing/aso/heathen/ranks.md
```

## Run it on a schedule

Rank moves over weeks, so weekly is the right cadence. Two ways:

- **Cron / scheduled-marketing entry** — one line per app, e.g. every Monday:
  ```
  python3 lib/aso_rank_monitor.py \
      --app heathen --bundle app.airowe.clarity --root /path/to/repo \
      --date "$(date +%F)"
  ```
  (`--date` comes from the shell; the lib never reads a clock so runs are
  deterministic and testable.) Commit the updated `ranks.md` so git holds the
  history.
- **On demand** — run it after shipping new metadata to grab a fresh snapshot,
  then again a week later to see what landed.

## How it closes the loop

`aso-keyword-research` picks → `aso-metadata-optimization` ships → **rank-monitor
watches**. Feed the deltas back: a targeted keyword still `lost`/`—` after weeks
means the bet was too hard (demote it, reclaim the keyword-field chars); a
long-tail term trending `↑` is landing (consider promoting it toward the
subtitle). That feedback is what turns one-shot optimization into a loop.

## Honest limits

Same as `aso-rank-check`: App Store only, the iTunes Search API's blended
relevance (weighs more than metadata alone), and a ~200-result ceiling beyond
which an app reads as `—`. A single snapshot is a starting line; the deltas
across snapshots are the signal.

## No external dependency

Standard-library Python + the free public iTunes Search API. No paid ASO SaaS,
no key, no auth.
