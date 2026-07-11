# PRD — Analytics Reports Phase 3: measured conversion + movement surface

> **Status: shipped (Phase 3, server).** Builds on Phase 2's persisted series
> (`02-engagement-ingest.md`). This is where the honesty model finally shows a
> **MEASURED conversion number instead of "—"**, and reports how conversion moved
> around each ship. Server + engine only; wiring the number into the web/mobile
> run page is a thin follow-up (below).

## What shipped

| Piece | Location |
|---|---|
| Engine: measured conversion + movement (pure) | `cloud/src/engine/conversionMovement.ts` (+ `.spec.ts`) |
| Route: the measured surface | `GET /apps/:id/analytics/engagement` (`cloud/src/api/index.ts`, + `analyticsEngagement.spec.ts`) |

## Measured conversion (finally, a real number)

`conversionRate(productPageViews, downloads) = downloads / productPageViews` —
**Apple's measured values, divided**. Never modeled. It is **`null` (unmeasured)**
when a side wasn't measured or PPV is 0 — never `0/0`, never a fabricated `0`.

- `latestConversion(series)` — the most recent day's overall conversion
  (aggregated across sources/CPPs: **sum PPV, sum downloads, then divide**), or
  `null` when that day isn't measurable. This is the number that replaces "—".

## Conversion movement (correlational, measured-or-absent)

`conversionMovements(series, pushes, {windowDays=14})` joins the persisted series
to the app's **approved pushes** — the same approval-stamped markers
`rankAnnotations` uses (`derivePushes` → `approval.decided_at`). For each push it
pools conversion in the `windowDays` **before** vs **from** the push and reports
the move, both as an **aggregate** (`source: ""`) and **per traffic source**:

```
{ at, runId, source, before, after, delta, samplesBefore, samplesAfter }
```

Honesty, load-bearing (mirrors `rankAnnotations.ts` / `rankAttribution.ts`):

- **Correlational, never causal** — "after you shipped, conversion moved from A%
  to B%", never "X caused the lift". The UI renders the caveat.
- **Measured-or-absent** — a movement is emitted ONLY when **both** windows have a
  measurable conversion. A one-sided window (e.g. a brand-new app with no
  before-data) yields **nothing**, never a half-invented delta.
- **Windowed** — data outside `[push−window, push+window)` never leaks into the
  comparison; `samplesBefore`/`samplesAfter` disclose how many measured days each
  side actually had.
- **Deterministic + pure** — no fetch, no `Date.now`; date-window math parses
  fixed strings.

## The route — `GET /apps/:id/analytics/engagement`

A plain owner-gated **read of our own D1** — no ASC call, no credential (the data
was persisted in Phase 2). Returns:

- `state: "no_data"` — nothing ingested yet (honest empty, never a zero series);
- `state: "measured"` with `latestConversion`, `movements`, and `days` (distinct
  measured days).

Because it's a pure read, it's cheap and safe to call on the run/app page.

## Honesty rules honored (from `00-overview.md`)

- **Measured or absent — never modeled.** Every number is Apple's, divided or
  quoted; `null`/`no_data`/omitted-movement cover every unmeasured case.
- **Attribution is correlation, not cause.** Movements are temporal markers with
  their sample counts, never a causal claim.
- **No credential persistence changes.** This phase reads only already-persisted
  report data (the user's own app); the `.p8` never enters the read path.

## Peer benchmark — deliberately deferred

The PRD's download-to-paid **peer benchmark** (Apple's differential-privacy
number vs. comparable apps) is **not** in this phase: it's a **different Apple
metric** that Phase 2's Engagement ingest didn't fetch. Surfacing it needs its
own ingest (a benchmark report category), so it's a clean follow-up rather than a
modeled stand-in here — consistent with measured-or-absent.

## Follow-ups (thin, not blocking)

1. **Render it.** Wire `GET …/analytics/engagement` into the web run/app page so
   the conversion figure shows the measured number (and the movement markers
   alongside the rank annotations). Pure client work — the honest server contract
   is done.
2. **Peer benchmark ingest + finding** (see above).
3. **Background daily ingest** (Phase 2 open question 2) so the series stays fresh
   without a manual ingest call.
