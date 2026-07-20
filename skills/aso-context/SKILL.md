---
name: aso-context
description: Scaffold a per-app context.md — the shared input every store-ops ASO skill reads (category, audience, competitors, seed keywords, brand terms). Auto-fills what it can from the app's live App Store listing via the free iTunes API, and optionally enriches the brand block via context.dev. Use to seed a new app into the ASO workflow, or to backfill apps that lack a context.md. No paid API required. Use when the user says "set up ASO for this app", "create a context.md", "onboard a new app into ASO", "we have no context file for this app", or "backfill the ASO context".
---

# aso-context

Every store-ops reasoning skill (`aso-keyword-research`, `aso-audit`,
`aso-metadata-optimization`) reads `marketing/aso/<app>/context.md` to sharpen
keyword expansion, relevance scoring, and competitor analysis. This skill creates
that file — pre-filled from real data instead of a blank template.

## What it does

1. Pulls the app's **live App Store listing** (name, category, description) via
   the free iTunes Lookup API.
2. Derives a starter **seed keyword** set from the listing (genre words + the most
   frequent meaningful terms in the name/description).
3. Optionally enriches a **brand block** (description, industry, colors, socials)
   via context.dev when `CONTEXT_DEV_API_KEY` is set and `--brand-domain` is given.
4. Writes `context.md` in the canonical YAML shape, leaving `audience`,
   `competitors`, and `voice` as honest TODOs for a human to complete.

```bash
python3 lib/aso_context_gen.py \
    --app heathen --bundle app.airowe.clarity --root .
# enrich the brand block (needs a context.dev key):
python3 lib/aso_context_gen.py \
    --app swoop --bundle com.chat.swoop --root . --brand-domain swoop.example
```

`--stdout` prints instead of writing; `--force` overwrites an existing file.

## Honest limits

- The derived seeds and one-liner are a **starting point**, not authoritative —
  they come from word frequency, so review and refine them. `competitors`,
  `audience`, and `voice` it can't infer; those are left as TODO.
- Brand enrichment is optional and degrades cleanly: no context.dev key → the
  brand block is simply omitted, everything else still works.

## Chains into

`aso-keyword-research` (reads the seeds + competitors), `aso-competitor-watch`
(reads the competitor list), and the rest of the ASO loop. Fill the TODOs once;
every downstream skill benefits.

## No external dependency

Standard-library Python + the free iTunes Lookup API. context.dev brand
enrichment is optional (the only paid path, and it's bring-your-own-key).


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. Your app's context (category, audience, competitors) evolves. Keeping it fresh is what makes every other skill's output sharp — and it's exactly the kind of upkeep nobody remembers to do.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
