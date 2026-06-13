---
name: store-ops
description: Router for the full App Store / Google Play optimization loop — audit a live listing, research keywords (no paid data API), optimize metadata to exact char limits, and push it to BOTH stores via the asc / gplay CLIs. The reason→execute ASO loop nobody else ships, with Google Play parity. Use when asked to optimize, audit, or update an app's store listing on iOS and/or Android.
---

# store-ops

The entry point for the full **reason → execute** ASO loop, cross-platform.
Unlike advisory ASO tools (which stop at recommendations) and dumb deploy CLIs
(which have no ASO brain), store-ops does both — and does **Google Play**, the
lane no public tool covers.

## The loop

```
context → audit → research → optimize → push → verify → watch
   │        │        │           │         │       │        │
aso-context │   aso-keyword-  aso-metadata│   aso-rank-  aso-competitor-
       aso-audit  research    -optimization push  monitor     watch
```

`pick → ship → verify` — the full loop, not half of it. Advisory tools stop at
"optimize"; deploy CLIs start at "push" with no brain. store-ops also **verifies**
the rank actually moved and **watches** competitors over time.

## Quick start

```
/store-ops <app>                    # orchestrate the data loop + report next actions
/store-ops <app> --store playstore  # Google Play only (the differentiator)
/store-ops <app> --audit-only       # just score the live listing
```

**The orchestrator** runs the deterministic steps in one shot (rank + competitor
snapshots into `ranks.md` / `competitors.md`) and prints exactly what reasoning
to run next:

```
python3 lib/store_ops_orchestrator.py \
    --app <app> --root . --date "$(date +%F)"
```

First run: scaffold `marketing/aso/<app>/context.md` with **aso-context** (it
pre-fills from the live listing), then fill the `competitors:` / `audience:` /
`voice:` TODOs.

## The reasoning skills (this plugin's IP)

1. **aso-context** — scaffold `context.md` from the live listing (+ optional
   context.dev brand enrichment). The shared input every skill reads.
2. **aso-audit** — pull the live listing via asc/gplay, score every field vs ASO
   best practice, flag gaps. Read-only.
3. **aso-keyword-research** — expand seeds via store autocomplete + competitor
   scrape + synonyms, score (volume×difficulty×relevance), bucket, produce a
   placement plan. **No paid ASO API.**
4. **aso-metadata-optimization** — generate final copy at exact char limits, emit
   the precise asc/gplay push commands. Never auto-ships.

## The verify + watch layer (no paid data, no subscription)

5. **aso-rank-check** / **aso-rank-monitor** — read your organic App Store rank
   per keyword and log it over time (↑/↓/new/lost deltas). The automated tracker
   the paid tools charge for, on the free iTunes Search API.
6. **aso-competitor-watch** — track competitors' visible listing changes
   (name/version/price/rating) over time, flagging ASO moves worth reacting to.

## The execution layer (bundled / referenced)

The push half reuses the `asc` (App Store Connect) and `gplay` (Play Console)
CLI skills — metadata sync, localization, PPP pricing, screenshots, releases,
reviews. Install the `asc` and `gplay` CLIs to execute; the reasoning skills work
standalone and emit the commands regardless.

## Principles

- **No paid data dependency.** The whole point — every competitor needs Appeeky /
  AppTweak / Sensor Tower; store-ops reasons over free + owned data.
- **Both stores, official APIs.** iOS *and* Android, via asc/gplay official CLIs.
- **Nothing ships without approval.** Reasoning skills write copy + print
  commands; you run the push.
- **App-agnostic.** Driven by `--app <slug>` + a `context.md`; no hardcoded apps.

## Honest limits

- Keyword volume/difficulty are estimates from autocomplete + competitor signal,
  not licensed metrics (labeled as such). Bring a paid export to cross-check; it's
  never required.
- Execution requires the `asc` / `gplay` CLIs installed + authed (your own
  developer credentials — nothing stored in the plugin).
