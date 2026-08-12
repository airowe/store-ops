---
name: aso-teardown
description: Write a long-form, publishable ASO teardown of any App Store app from PUBLIC measured data only — listing copy, screenshots, ratings reconciled per storefront, category chart position, measured search rank, icon vs. category convention, and the off-store conversation that omits the app. Composes the existing aso-* skills into one prose artifact with every figure sourced. Never estimates revenue or downloads. Use when the user says "write a teardown", "teardown this app", "long-form ASO breakdown", "analyze a competitor's listing publicly", or "turn an audit into an article".
---

# aso-teardown

**aso-audit** grades a listing for the owner. This writes the **article** — a
long-form, publishable teardown of an app you may not own, built only from
figures a reader could verify themselves.

The difference matters. An audit is a private worklist. A teardown is a public
claim, so every number in it has to survive being checked by the app's own
developer.

## The rule that defines this skill

**Public measured data only. Never a modeled figure for a third-party app.**

Everything below is readable without credentials: the storefront page, the
public search endpoints, the reviews RSS, the category chart feed. None of it
requires the subject's App Store Connect key, and none of it is estimated.

The moment a teardown needs a revenue figure, a download count, or an install
estimate, **it stops**. Those numbers are modeled by aggregators, not measured,
and republishing them — even hedged — is the line this skill does not cross.
Write "not measurable from public data" and move on. That sentence is not a gap
in the article; it is the reason the rest of it can be trusted.

## Inputs

- `--app <slug>` — output directory name
- `--bundle <bundle id>` — the subject app (e.g. `com.example.habits`)
- `--country <US>` — storefront (default US)
- `--competitors <ids|bundles>` — head-to-head set; if omitted, take the
  category chart's top apps as the comparison set

## The passes

Run these in order. Each is an existing skill or lib — this skill composes, it
does not re-implement.

### 1. The listing itself

```bash
python3 lib/aso_screenshot_score.py --app <slug> --bundle <bundle> --fetch --json
```

Reuse **aso-audit** for the field-by-field grade. For the article you want the
*specifics*, not the score: how many of the 30 title characters are spent, what
the subtitle repeats from the title, whether promotional text is empty (see
aso-audit — an empty field is a finding, not a non-event).

### 2. Ratings, reconciled per scope

The single most credibility-earning paragraph in a teardown, and it is free.

The lookup API's `userRatingCount` is **per storefront**, and the figure quoted
on aggregator sites is usually the worldwide total. Both are correct at different
scopes. Readers who have seen two figures elsewhere assume one source is wrong —
showing that both are true, and naming which is which, reads as authority and
costs one fetch per market.

Verified, one app across four storefronts on the same day:

```bash
for cc in us gb de jp; do
  curl -s "https://itunes.apple.com/lookup?id=<track id>&country=$cc" \
    | python3 -c "import json,sys; print('$cc', json.load(sys.stdin)['results'][0]['userRatingCount'])"
done
# us 2330 · gb 740 · de 727 · jp 34
```

State it explicitly: *"2,330 ratings in the US storefront; 740 in the UK."*
Never average them, never sum them into a total you did not read, and never
present one as "the" rating count.

The same scoping applies to the star average — a 4.8 in one market and a 4.1 in
another is two measurements, not a contradiction to be resolved.

### 3. Category chart position

```bash
python3 lib/aso_rank_check.py --bundle <bundle> --country <cc> --json
```

The chart feed gives a measured position or an honest absence. "Not in the top
100 of its category" is a finding — write it as a reading, not as a zero.

### 4. Measured search rank (see the honest-substitute note below)

```bash
python3 lib/aso_rank_check.py "keyword one, keyword two" --bundle <bundle> --country <cc> --limit 200 --json
```

Report ranked terms as measured positions and unranked terms as *"searched the
top 200, not found"* — which is a measurement, distinct from a term nobody
checked.

### 5. Head-to-head against named competitors

```bash
python3 lib/aso_competitor_watch.py --app <slug> --ids <track ids> --country <cc> --date $(date +%F) --json
```

Compare on things both listings actually show: character budget spent, screenshot
count, caption presence, whether a preview video exists, subtitle strategy.

### 6. Icon vs. the category convention

The sharpest finding in a good teardown, and the one most tools miss entirely:
does the icon read as the same *kind of object* as the rest of the results page?

ShipASO's engine measures this (`icon_stands_apart` / `icon_conforms_to_category`
via `cloud/src/engine/iconComparison.ts`). It reads your icon and the top chart
neighbours' icons and reports which side of the category convention you sit on.

Write the honest trade in both directions. An icon that stands apart earns the
eye but stops saying what the app does — so the title has to carry that job. An
icon that conforms is instantly legible and harder to pick out of a row. Neither
is "better", and a teardown that declares one a mistake is guessing.

### 7. The off-store conversation

```bash
python3 lib/aso_offstore_mine.py --app <slug> --url <listicle url> --youtube <review url> --json
```

Usually the biggest real gap, and invisible if you only look at store rankings:
the "best <category> apps" roundups, comparison articles, and review videos that
shape discovery — and whether they mention the subject at all.

An app absent from every roundup in its own category is a finding with a concrete
fix, and no store-side tool will ever surface it.

### 8. Localization reach

```bash
python3 lib/aso_locale.py --list
```

Which storefronts carry localized metadata and which ship the default locale into
a non-English market. Reuse **aso-localize-research**.

## Output

Writes `marketing/aso/<app>/teardown-<date>.md`:

1. **What the app is** — positioning in one paragraph, from the listing itself
2. **The listing, field by field** — with character budgets spent
3. **Ratings, reconciled** — per-scope, both figures named
4. **Where it ranks** — category chart + measured search rank
5. **Head-to-head** — the named comparison set
6. **The icon** — convention or contrast, with the trade stated
7. **Off-store** — who talks about this category, and whether they mention it
8. **The five moves** — prioritized, each traceable to a section above
9. **Method + limits** — what was measured, what was not, and why

Every figure carries its scope and source inline. A teardown with an unsourced
number in it is not publishable.

### Not checked: popularity and difficulty scores

Teardowns in the wild lean on tables like *"96 keywords tracked, 21 ranked, with
popularity and difficulty per term."* Those scores come from a **paid ASO API**.

Our keyword stack is deliberately keyless, so **we cannot reproduce them and must
not imply we can.** There is no free source for Apple's search popularity index;
anything presenting itself as one is inferring it.

The honest substitute is **measured search rank** (pass 4) plus autocomplete
depth — a weaker signal stated accurately, rather than a stronger one we would
have to buy and could not verify. Label it as what it is:

> "Measured organic rank in the US storefront, top 200 scanned. Not a popularity
> score — we don't have licensed keyword volume."

Do not silently omit the difference. A reader comparing this to a paid-tool
teardown should be told which numbers are missing and why.

### Not checked: revenue, downloads, or MRR

Restated here because it is the most tempting thing to add, and every aggregator
makes it look available. Those figures are **modeled**, and a teardown that
repeats them inherits an error it cannot bound.

If the developer has published a number themselves, you may cite *them* — with
attribution and a date, as a claim they made, never as a measurement you took.

## Honest limits

- **Public data only.** Without the subject's ASC key there is no keyword field,
  no conversion rate, no impression data. Say so; don't infer them.
- **Screenshot-text indexing is undocumented.** Apple does not confirm that text
  inside screenshots is indexed. Plan around it if you like, but do not hand it
  to a reader as a confirmed fact.
- **A teardown is a snapshot.** Listings, charts, and ratings move. Date every
  figure — an undated number becomes wrong without anyone editing it.
- **Read-only.** This writes an article. It never touches the subject's listing,
  and it is not a substitute for **aso-metadata-optimization** on your own app.

## Etiquette

You are publishing about someone else's work, often a solo developer's. Two
things follow:

- **Critique the listing, not the person.** Every finding should name a specific,
  fixable thing.
- **Credit what works.** A teardown that only finds faults is a worse read and a
  less accurate one — an app with real traction is doing something right, and
  saying what earns the rest of the piece its credibility.

## No external dependency

Public App Store endpoints, the reviews RSS, Jina Reader for off-store pages, and
yt-dlp for video captions. No paid ASO SaaS, no credentials for the subject app.

## Run it on your own app first

The fastest way to see whether a teardown is fair is to run it on something you
own, where you can check every claim against what you already know.

> Publishing one teardown is an afternoon. **ShipASO** — the hosted agent — runs
> the same measured passes on your app weekly and pings you only when there's a
> real move to approve. Same engine, your store credentials never held.
> → https://app.shipaso.com
