# PRD 03 — Review sentiment + topic extraction

**Status:** Proposed
**Priority:** P1 (real public data, no fabrication risk, fills a missing surface)
**Closes gap:** Appeeky has "review sentiment + topic extraction" — a whole
analytics surface we lack entirely.

---

## Problem

User reviews are a first-class ASO signal (Apple weighs ratings; reviews reveal
the language real users use to describe the app — which feeds keyword/intent
work). Appeeky surfaces sentiment and extracted topics. We surface nothing from
reviews. This is a clean win: the data is **public**, so there's no honesty risk,
and it directly feeds our intent-grounding (the words users actually use → keyword
candidates we can defend as real, not fabricated).

## Goals

1. Pull an app's public App Store reviews (RSS / public reviews endpoint).
2. Per app: an overall sentiment read + a ranked list of extracted topics
   (themes) with representative quotes and their sentiment.
3. Feed extracted user vocabulary into the keyword/intent surface as *candidate*
   terms (clearly labeled as review-derived, not measured search volume).
4. Surface it as a new audit section.

## Non-goals

- **No fabricated sentiment scores.** If the review sample is thin (few reviews),
  say so — report "n=12 reviews, low confidence," never a confident number off a
  tiny sample. This is the same honesty discipline as #78.
- Not scraping private/Connect review data — public reviews only at this stage
  (ASC review API can be a later, keyed enhancement).
- Not auto-responding to reviews.

## Proposed design

- New engine module `cloud/src/engine/reviewSentiment.ts`:
  - `fetchReviews(fetchFn, appId, { country })` → public reviews via Apple's
    RSS customer-reviews feed (free, no key), paginated.
  - `analyzeSentiment(reviews)` → overall + per-review polarity. Use the existing
    AI reasoner (`aiReasoner.ts`) for topic extraction + sentiment, **grounded in
    the actual review text** (consistent with our "grounded, not generic" line),
    with explicit sample-size reporting.
  - `extractTopics(reviews)` → ranked themes, each with `{ topic, count,
    sentiment, sampleQuotes[] }`.
- Audit integration: a new `reviews` section in `auditFindings.ts` output.
- Keyword bridge: review-derived terms flow into `keywordGap` / keyword candidates
  **labeled `source: "reviews"`** so they're never confused with measured data.

## Honesty guardrails

- Always report sample size `n` alongside any sentiment summary.
- Below a threshold (e.g. n < 20), label "low confidence" and suppress a numeric
  score in favor of "too few reviews to summarize reliably."
- Topic counts are observed frequencies in the sample, never extrapolated to "X%
  of all users."

## Success criteria

- Auditing a real app returns an overall sentiment + ≥3 extracted topics with real
  quotes, or an honest "too few reviews" when the sample is thin.
- Review-derived keyword candidates appear in the keyword surface, labeled as
  review-sourced.
- A unit test asserts the low-sample path suppresses a confident score.

## Open questions

- RSS feed coverage/limits per country — confirm pagination depth.
- Cache reviews (they change slowly) to avoid re-fetching every audit?

## Rough size

**M** — one new engine module + audit section + reasoner prompt; the AI reasoner
already exists.
