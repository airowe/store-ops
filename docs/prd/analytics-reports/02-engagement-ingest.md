# PRD — Analytics Reports Phase 2: Engagement ingest + persist

> **Status: shipped (Phase 2).** Builds on Phase 1 (`01-request-lifecycle.md`).
> Phase 1 created the async request and detected Admin honestly. Phase 2 **reads
> the generated Engagement report and persists a measured series to D1.** It still
> renders **no metrics** — surfacing (measured-movement, per-CPP conversion, the
> peer benchmark) is Phase 3. This phase is the honest pipe from Apple's files to
> our own store.

## What shipped

| Piece | Location |
|---|---|
| Engine: graph traversal + parser (pure) | `cloud/src/engine/analyticsEngagement.ts` (+ `.spec.ts`) |
| Persistence: idempotent upsert + read | `cloud/src/d1.ts` (`upsertEngagementRows`, `getEngagementSeries`) (+ `d1.analyticsEngagement.spec.ts`) |
| Schema: the series table | `cloud/schema.sql` → `analytics_engagement` |
| Route: on-demand ingest | `POST /apps/:id/analytics/ingest` (`cloud/src/api/index.ts`, + `analyticsIngest.spec.ts`) |

## The ingest graph

```
analyticsReportRequest (Phase 1)
  └─ GET …/reports?filter[category]=APP_STORE_ENGAGEMENT   → the Engagement report
       └─ GET /analyticsReports/{id}/instances?filter[granularity]=DAILY → dated instances
            └─ GET /analyticsReportInstances/{id}/segments → signed URLs to gzipped CSV/TSV
                 └─ download (no auth — URL is pre-signed) → gunzip → parse → rows
```

`ingestEngagement(fetchFn, gunzip, {token, requestId})` walks it and returns
typed rows. The gzip inflate is **injected** (`gunzipText`, a `DecompressionStream`
by default) so the parser tests need no real gzip. Only the Engagement category
is fetched — Commerce/Usage/Framework/Performance are ignored (later phases /
out of scope).

## The parser (`parseEngagementRows`) — the fully-verifiable core

Pure, never throws. Infers the delimiter (tab vs comma), matches headers
case/space-insensitively via a small `COLUMN_MAP`, and maps to a typed
`EngagementRow { date, source?, pageType?, cpp?, impressions?, productPageViews?,
downloads? }`. Honesty rules baked in:

- **A metric column absent from the file is OMITTED** from the row — never a
  fabricated `0`.
- **A `Default`/blank Product Page Id is the default page** (`cpp` undefined) —
  never an invented CPP.
- **A row with no date is dropped** — the date is the series key.

## Persistence — `analytics_engagement`

One row per `app_id × date × source × cpp × page_type`. Metrics are
`INTEGER NULL` (a report that didn't carry a metric stores `NULL`, never `0`).
`upsertEngagementRows` writes one atomic `db.batch` with
`ON CONFLICT(<dimension tuple>) DO UPDATE` — so re-ingesting a day **restates**
it (Apple revises recent days) instead of duplicating. Empty input is a true
no-op (no write). This is the user's **own app data**; the
never-persist-credentials invariant is untouched — only report rows land, never
the `.p8`.

**Conversion is NOT stored.** It's derived at read time (Phase 3) from measured
`productPageViews` + `downloads`, so we never persist a modeled number and can
always show the measurement it came from.

## The route — `POST /apps/:id/analytics/ingest`

Read + our-own-DB-write only (no outward write to Apple), so it's **ungated**
like Phase 1's `status` — it simply needs the ongoing request that the
consent-gated `enable` created. Credentials resolve the same way (`resolveAscCredential`;
`.p8` request-scoped, never persisted). Flow:

1. Resolve token + ASC app id, then Phase 1's `getAnalyticsStatus`.
2. If **not** `pending` (needs Admin / not requested / unavailable) → return that
   state **verbatim** — an honest "enable it first / needs Admin", never a fake series.
3. Otherwise `ingestEngagement`; a `not_ready` (Apple still generating) → `pending`,
   a transient failure → `unavailable`.
4. On success, persist and return **counts only**: `{ state: "ingested",
   instances, rowsPersisted, days }`. The measured numbers themselves are a Phase
   3 surface — the ingest route never emits them.

**Safe-degrade throughout:** every fetch failure resolves to an honest state
(never throws), one bad segment download is skipped best-effort, and a failed
ingest leaves any prior persisted data intact.

## Open question 2 — ingestion cadence — RESOLVED

**Decision: on-demand now; a DAILY cadence piggybacking the existing `0 8 * * *`
cron later — never a new cron trigger.**

Rationale:
- Engagement instances are **daily**, so nothing is gained by polling faster than
  once a day.
- Cloudflare caps a Worker at **5 cron triggers** and we already use 2
  (`0 * * * *` sweep tick, `0 8 * * *` daily rank snapshot). A background ingest
  belongs **on the existing daily tick**, not a third trigger.
- **Background ingest requires a stored key.** Minting the JWT needs the `.p8`,
  which only exists server-side for apps whose owner opted into the encrypted
  saved key (#67). So the daily path can only cover opted-in apps; everyone else
  ingests **on demand** (this route), where the key rides in the request. Shipping
  the on-demand route first de-risks the pipeline before wiring the cron, and
  keeps ingest working for keys that are never stored.

The daily cron wiring is intentionally deferred to a follow-up (it's a scheduling
change with a stored-key dependency, cleanly separable from this pipeline).

## Validate against a live Admin key (the one external unknown)

The traversal and parser follow Apple's **documented** Analytics Reports schema,
but the exact Engagement **column headers**, the instance `granularity`/state
attribute names, and the segment `url` field can only be confirmed against a real
Admin key with a generated report. Everything is written to make that a cheap
fix: `COLUMN_MAP` (header → field) and the endpoint shapes are small, centralized
constants, and the parser matches headers tolerantly. This is the single thing to
verify before Phase 3 renders these numbers.

## What Phase 2 deliberately does NOT do

- No metrics **surface** — conversion / impressions / PPV / downloads still show
  `—` in the UI. Reading `getEngagementSeries` into a view is Phase 3.
- No measured-movement join to run history, no per-CPP conversion, no peer
  benchmark (all Phase 3).
- No background cron yet (deferred per open question 2 above).
- No Commerce/Usage/Framework/Performance categories.
