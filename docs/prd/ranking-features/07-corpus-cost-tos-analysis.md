# Category rank+metadata corpus — cost & ToS analysis (#63/#64)

Status: **cost/ToS analysis gate** (owner picked "cost/ToS analysis first",
2026-07-05). #63 (build the corpus) and #64 (AI pattern-mining on it) are the
compounding-data-moat play. #64 is blocked on #63, and #63 the issue itself
says: *"Feasibility / risk to weigh BEFORE building."* This doc is that weighing
— the thing that must exist before a single broad-collection cron day runs.

## What #63 proposes

Extend the cron to snapshot rank + **visible** metadata for a broad set of apps
per category (top-N across seed keywords), **not just customer apps**, into a
time-series corpus. Over months it becomes a "movers & shakers" panel we can
never buy retroactively. #64 then mines visible-change→rank-move sequences for
correlational hypotheses.

## Cost analysis (the honest budget)

### The dominant cost is egress, not compute or storage

In production, **iTunes calls route through TinyFish** (`fetchForEnv` →
`makeTinyfishFetch`) because Apple 403s Cloudflare egress. TinyFish is a
**paid, per-request** proxy. That makes every corpus fetch a metered unit — the
corpus cost is fundamentally **requests × TinyFish unit price**, and it scales
with breadth × depth × frequency.

Request math for a broad corpus (illustrative — plug real numbers before go):

```
requests/day ≈ Σ_category ( seed_keywords × search_pages )     # rank/search
             + unique_apps_seen × 1 (lookup for visible metadata)  # metadata
```

Worked example — deliberately *minimal* to show the shape:

- 10 categories × 20 seed keywords × 1 search page (top ~50 results) = **200
  search requests/day**.
- Those surface, say, ~600 unique apps → **~600 lookup requests/day** for
  visible metadata.
- **~800 TinyFish requests/day → ~24k/month → ~290k/year**, for a *minimal*
  slice. A "broad" corpus (50 categories, 50 keywords, multiple pages, daily)
  is **10–50×** that: millions of paid requests/year.

The customer-app cron today is a *tiny* fraction of this (N customer apps × K
of their keywords, weekly/threshold-gated). The corpus is a **different order of
magnitude** of paid egress — exactly the issue's stated worry.

### Cloudflare-side costs (secondary but real)

- **Workers CPU / subrequest limits.** A single cron invocation can't make
  hundreds of thousands of subrequests; the corpus needs **chunking across many
  scheduled invocations** (or a queue), not one fat cron. Design cost, not just
  dollar cost.
- **D1 storage growth.** Time-series across thousands of apps daily grows
  unbounded. Needs a **retention/rollup plan from day one** (e.g. keep daily for
  90d, then weekly rollups) — retrofitting rollups onto a huge table is painful.
- **D1 write volume / row limits.** Thousands of inserts/day is fine for D1, but
  the table needs indexing for the #64 query patterns (by keyword, by category,
  by app, by time) chosen up front.

### Cost recommendation

**Do not run broad collection blind.** If collection starts, it must start
**minimal and metered**: a hard daily request budget, a small fixed seed set,
chunked across invocations, with a **kill switch** (an env flag / `app_settings`
row) and a **running cost log** (requests/day emitted to the deploy-alert
channel, same pattern as the deploy-failure alert). Breadth expands only after
the real per-request TinyFish price × the minimal slice is measured against an
actual budget line.

## ToS / acceptable-use analysis (the harder gate)

### The scale distinction the issue flags

We already call iTunes Search/Lookup **for the product** (a user's own app + a
bounded competitor set per run). **Broad, systematic, daily collection across
apps we have no customer relationship with is a materially different activity** —
it's the thing Apple's terms most plausibly restrict, and doing it *through a
paid rendering proxy specifically to evade Apple's egress 403* sharpens the
question rather than softening it.

Points to resolve **before** any broad collection (needs a real read of current
terms, not this doc's summary):

1. **Apple Media Services / iTunes Search API terms** — the Search API is
   intended to help *promote/link to* content, with rate limits (historically
   ~20 calls/min guidance) and restrictions on bulk extraction and building a
   competing dataset. Systematic corpus-building for a "movers & shakers"
   product may exceed intended use. **Must be read against current terms.**
2. **Proxy-to-evade-block signal.** We route through TinyFish because Apple
   403s our egress. Using a renderer to systematically collect at scale what
   Apple is actively rate-limiting/blocking is a governance red flag worth
   explicit legal sign-off, separate from the dollar cost.
3. **TinyFish's own ToS** — does their acceptable-use permit large-scale
   Apple collection? Their terms bind us too.
4. **Redistribution/derived-data.** #64 surfaces patterns from the corpus to
   users. Even framed as correlational hypotheses, a *derived dataset built from
   Apple's catalog* has its own IP/terms questions.

### Honesty caveat carries through (unchanged)

Even a perfect corpus only sees **visible** fields — no subtitle/keyword field
visibility. So #64's patterns are **inherently partial and correlational**,
never causal ("apps that did X *tended to* climb," with sample size + the actual
examples shown — never "do X to rank"). That honesty fence is a #64 hard rule
and does not change here.

## Recommendation

**Hold broad collection; gate on two explicit sign-offs, in order:**

1. **ToS/legal read** (owner or counsel) against *current* Apple iTunes Search
   API terms + TinyFish AUP, specifically for systematic multi-app daily
   collection via the proxy. If this doesn't clear, **stop** — the moat isn't
   worth a platform-terms violation, and #63/#64 close as won't-do.
2. **Budgeted minimal pilot** *only if #1 clears*: measure real TinyFish
   per-request cost × a deliberately tiny seed slice (≤ a few hundred
   requests/day), chunked, kill-switched, cost-logged, with the retention/rollup
   schema decided up front. Expand only against measured numbers.

The compounding argument (start early, history accrues) is real — but the
issue's own "weigh before building" instruction ranks **not violating platform
terms** and **not opening an unbounded paid-egress line pre-PMF** above
early-start. Neither is on the critical path to PMF.

## Status of the issues

#63 stays **open**, gated on sign-off #1 (ToS/legal) then #2 (budgeted pilot).
#64 stays **open and blocked on #63** — no corpus, nothing to mine. This doc is
their resolution-of-record until the ToS read happens.
