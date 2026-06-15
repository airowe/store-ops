---
name: aso-localize-research
description: Run keyword + rank research per market/locale (de-DE, ja-JP, es-MX, …) instead of US-only. Maps a locale code to the right Google geo/language constants, Apple market, and iTunes country so the volume + rank tools "just work" for any market — no hand-looking-up numeric constant ids. Produces per-locale keyword plans and rank snapshots. Unlocks the asc-localize-metadata push. No paid API.
---

# aso-localize-research

ASO is per-store-front: a keyword that's strong in en-US can be worthless in
de-DE, and the German term you should target isn't the English one translated —
it's what German users actually search. The volume + rank tools already take
geo/language/country params; the friction is that Google wants **numeric**
constant ids (`geoTargetConstants/2276`) nobody remembers. This skill is the
registry + glue that removes that friction.

## What it does

1. **Resolves a locale** → the right ids for every tool:
   - Google `geoTargetConstant` + `languageConstant`
   - Apple Search Ads market area
   - iTunes country (for rank + lookup)
2. **Runs localized research** — a rank snapshot in that market, and the exact
   `gads_volume_cli` / `asa_popularity_cli` commands to pull localized volume.

```bash
python3 lib/aso_locale.py --list           # supported locales
python3 lib/aso_locale.py --locale de-DE   # resolve the ids + ready commands
python3 lib/aso_locale.py --locale ja-JP \
    --bundle app.airowe.clarity --keywords "瞑想,マインドフルネス" --ranks
```

Supported markets: en-US/GB/CA/AU, de-DE, fr-FR, es-ES/MX, it-IT, pt-BR, nl-NL,
ja-JP, ko-KR, zh-CN (extend the registry in `aso_locale.py` as needed).

## The localized loop

For each target market: resolve the locale → run keyword-research with the
locale's volume ids (real localized search demand) → produce a localized
placement plan → hand off to **asc-localize-metadata** / **gplay-metadata-sync**
to push the per-locale listing. Then **aso-rank-monitor** with `--country <XX>`
to verify in that market.

This is what makes the `--geo`/`--lang`/`--market`/`--country` params on the
other tools usable as a system, and what feeds the asc-localize-metadata skill
that was otherwise sitting unused.

## Honest limits

- The registry covers the highest-value App Store markets, not all ~175 — add
  a locale by appending its constants (Google's geo/lang id lists are public).
- It resolves ids and runs the data tools; **translating the keywords** into the
  target language is reasoning the agent does (or a native speaker) — don't
  machine-translate keyword fields blindly, mine the local term.

## No external dependency

Standard-library Python + the free iTunes APIs; localized volume reuses your own
Google/Apple credentials (same BYO-key path as en-US). No paid ASO SaaS.


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Per-market rank moves independently — a term that's hot in de-DE can be saturated in ja-JP next month. Tracking each locale over time is where localization ROI shows up.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
