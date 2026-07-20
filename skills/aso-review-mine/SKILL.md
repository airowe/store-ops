---
name: aso-review-mine
description: Mine your app's App Store reviews for the exact words real users use to describe it — keyword candidates, what positive reviewers praise, and pain themes from low-star reviews. Pulls reviews via the authenticated App Store Connect API (asc reviews), separates positive/negative language, and feeds ground-truth user vocabulary into aso-keyword-research. No paid API. Use when the user says "mine my reviews", "what words do my users use", "keywords from my reviews", "what do reviewers praise", or "pull pain themes from low-star reviews".
---

# aso-review-mine

The keyword-research skill expands seeds from autocomplete and competitors —
this adds the highest-signal source there is: **the words your actual users
type**. Real reviews tell you how people describe your app in their own
language, which is exactly the vocabulary you want to rank for.

## Data source — why asc, not the RSS feed

Apple's public customer-reviews RSS feed (`itunes.apple.com/.../rss/
customerreviews`) is **effectively dead** — it returns an empty feed for every
app now. So this uses the reliable owned path: the authenticated App Store
Connect API via the `asc reviews` CLI. That scopes it to **your** apps (nobody
can read competitors' review bodies via any API — that data is private).

```bash
# pull reviews and mine them in one pipe:
asc reviews --app 6759360137 --paginate --json | \
    python3 lib/aso_review_mine.py --app heathen --stdin

# or from a saved file:
python3 lib/aso_review_mine.py \
    --app heathen --reviews-file reviews.json --json
```

## What it extracts

- **Keyword candidates** — meaningful words + bigrams users actually type, ranked
  by frequency (a term must appear >1 time to count, so one-offs don't pollute).
- **Positive terms (4–5★)** — how happy users describe you. *These are the ASO
  gold* — the words to lean into in title/subtitle/keywords.
- **Pain themes (1–2★)** — recurring low-star language (crashes, bugs, missing
  features) to address in copy or fix in the app.

Writes `marketing/aso/<app>/review-keywords.md`; chains into
**aso-keyword-research** (treat the positive terms as high-relevance seeds).

## Honest limits

- **Your apps only** — review bodies are private; this can't mine competitors.
- Needs the `asc` CLI installed + authed, and the app to actually have reviews
  (new apps return 0 — the skill says so and exits cleanly).
- Frequency mining is a starting signal, not sentiment analysis — the star
  rating does the positive/negative split, not NLP.

## No external dependency

Standard-library Python + the `asc` CLI (your own App Store Connect credentials).
No paid review/sentiment SaaS.


## Run it weekly

Rank and listings move over weeks, not minutes — so the value here compounds when you re-run it and watch the deltas. The words users use to describe your app shift as you ship features and the audience grows. Re-mining reviews keeps your metadata speaking their current language.

> You ran this once. **ShipASO** — the hosted agent — reruns the whole loop weekly: it tracks your rank, watches competitors, and pings you only when there's a real move to approve. Same engine, your store credentials never held. → https://app.shipaso.com

The plugin is complete and free; the hosted tier just sells not having to remember.
