---
name: aso-metadata-optimization
description: Generate final, char-limit-correct App Store / Google Play listing copy (name, subtitle, keywords, promotional text, description) from a keyword plan + audit, then emit the exact asc / gplay commands to push it. Cross-platform. Honors exact store char limits. Nothing ships without your approval — it writes copy + commands, you run them. No paid ASO API.
---

# aso-metadata-optimization

The execution-bridge: turns the keyword plan (`aso-keyword-research`) + audit
(`aso-audit`) into **final listing copy that fits the exact char limits**, then
hands you the precise `asc` / `gplay` push commands. Reason → ready-to-execute.

## Inputs

- `--app <slug>`
- `--store <appstore|playstore|both>` (default both)
- `--locale <en-US>`
- reads `marketing/aso/<app>/keywords.md` (placement plan) and the latest
  `audit-<date>.md` if present.

## Char limits enforced (HARD — generation fails if exceeded)

| Field | App Store | Google Play |
|---|---|---|
| name / title | 30 | 30 |
| subtitle | 30 | — |
| short description | — | 80 |
| keywords field | 100 | — (Play has no keyword field; keywords live in description) |
| promotional text | 170 | — |
| description | 4000 | 4000 |

The skill counts characters and **regenerates** until every field fits. It never
emits over-limit copy (the #1 cause of rejected/wasted metadata).

## Method

1. Place Primary keywords in the **title**, Secondary in **subtitle / short
   description**, Long-tail in the **keyword field (iOS)** / woven into the
   **description (Play)** — per the keyword plan.
2. iOS keyword field: comma-separated, **no spaces**, no title/subtitle dupes, no
   stop-words — maximize the 100 chars.
3. Write natural, value-led copy (not keyword soup) for human-read fields
   (subtitle, promo, description).
4. Produce a standardized `aso-copy.md` (the deliverable) with every field +
   live char counts.

## Output

1. **`marketing/aso/<app>/aso-copy.md`** — final copy, char-annotated.
2. **The exact push commands** (printed, NOT run):
   - iOS: `asc app-info set ...` / `asc localizations upload ...`
     (reuse the `asc-metadata-sync` / `asc-localize-metadata` skills)
   - Android: `gplay-metadata-sync` upload commands
3. A one-line approval prompt: review `aso-copy.md`, then run the commands to ship.

## Guardrail — nothing auto-ships

This skill **never** calls `asc app-info set` / `gplay` upload itself. It writes
the copy and prints the commands; pushing the listing is a deliberate,
user-approved step. (This is the safe half of "reason → execute.")

## After you ship — verify it

Once the listing is live, run **aso-rank-check** for the keywords you just
placed. It logs your organic App Store rank per term over time, so you can see
whether the change actually moved the needle (and feed that back into the next
keyword-research pass). That's the watch half of the loop — pick → ship → verify.

## No external dependency

LLM generation + char counting + the asc/gplay CLIs. No paid ASO SaaS.


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Optimized copy is only proven once you ship it AND read the rank back. One optimization is a guess; the loop is optimize → push → verify the rank moved → adjust.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
