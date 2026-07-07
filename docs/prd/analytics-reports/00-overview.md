# PRD — App Store Connect Analytics Reports (measured conversion)

> **Status: proposed.** The one large ASC surface ShipASO reads NOTHING of today.
> Everything in `cloud/src/engine/ascRead.ts` reads *configuration* (versions,
> localizations, screenshots, previews, IAPs, pricing, categories, age rating,
> CPPs). Apple's **Analytics Reports API** is the *outcome* side — impressions,
> product page views, conversion rate, downloads, per-source and per-CPP — and
> it is the first-party truth for the exact funnel this product optimizes.

## Strategic frame (why this, why now)

The product thesis is "optimize your listing, ship it, and **prove the rank
moved** — you just approve." Today we prove movement with PUBLIC rank snapshots
(scraped search position). We can't show the thing that actually pays: whether a
metadata change moved **conversion**. The honesty model shows "—/unmeasured" for
conversion precisely because we've never had the data.

The Analytics Reports API is that data, first-party and free with the user's
existing key: **product page views, impressions, conversion rate, downloads —
segmentable by traffic Source (Search vs. Explore vs. Referral), by Custom
Product Page, by territory, by app version.** That closes our own loop honestly:

> "You shipped this subtitle on <date>. On Search traffic, conversion moved from
> X% to Y% over the next 14 days." — provable, per-CPP, from Apple.

No scraping competitor (AppKittie et al.) can match this without the user's key,
and it's the read-side that the CPP audit (`cppFindings` in `auditFindings.ts`),
localization coverage, and the deferred ShipShots/CPP add-ons (`visual-assets/03`,
`storefront-intel/05`) all want: *did it work?*

Timing: Apple's **March 2026 overhaul** added 100+ metrics, cohorts, and — the
wedge — a **download-to-paid peer benchmark** computed with differential privacy
against Apple's own app categorization. "Your conversion is below comparable
apps" is a headline finding no one else can surface honestly. Separately, the
legacy **Sales & Trends API is being deprecated through 2027**; anything we build
must target Analytics Reports, never Trends.

## The hard architectural difference (read this first)

This is NOT another synchronous `ascRead` call. Three properties break every
assumption in the current ASC path:

1. **Admin role required.** Analytics report *requests* need an **Admin**-role
   API key. Today the audit needs only App Manager. A user's existing key may
   not have the role — the feature must detect the 403 and explain honestly
   ("your ASC key needs Admin to read analytics"), never fail the audit.
2. **Asynchronous, ~1–2 day first generation.** You `POST` an
   `analyticsReportRequest`, Apple generates instances over **1–2 days**, then
   you poll `analyticsReports` → report `instances` → download segment files
   (gzipped CSV/TSV from a signed URL). This is a background job with persisted
   state, not a request-time read.
3. **Report data is files, not JSON relationships.** Instances are dated
   segments you download and parse, then persist — a genuinely different
   ingestion shape from the JSON:API reads in `ascRead.ts`.

Because of this, the work is phased so Phase 1 ships value without the full
async pipeline, and nothing here touches the synchronous audit's latency.

## The five report categories (what the API exposes)

| Category | ASO relevance | Key metrics |
|---|---|---|
| **App Store Engagement** | ★ the whole point | impressions, product page views, **conversion rate**, downloads — by Source (Search/Explore/Referral), **by CPP**, territory, page type |
| **App Store Commerce** | monetization | proceeds, sales, redownloads, (new) subscription reports |
| **App Usage** | retention | sessions, active devices, installs, **deletions/uninstalls**, cohort retention |
| **Framework Usage** | ✗ off-strategy | API/framework interactions |
| **Performance** | ✗ app-health, not listing | launch, hang, memory, battery |

Phase work targets **Engagement** first (and only). Commerce/Usage are later,
demand-gated. Framework/Performance are explicitly out of scope — ShipASO is
listing optimization, not app-health monitoring.

## Phasing

- **Phase 1 — request lifecycle + Admin detection + honest empty state.**
  Detect whether the key can read analytics; if Admin, ensure an ONGOING
  Engagement `analyticsReportRequest` exists (create once, idempotent);
  surface an honest "analytics requested — Apple takes ~1–2 days; check back"
  state. No metrics yet. This de-risks the auth + async model cheaply. See
  `01-request-lifecycle.md`.
- **Phase 2 — ingest + persist Engagement instances.** Background fetch of ready
  report instances, parse the segment files, persist a compact per-app,
  per-day, per-source, per-CPP conversion/impression/PPV/download series in D1.
  Safe-degrade: a not-yet-ready or failed report leaves prior data intact.
  See `02-engagement-ingest.md`.
- **Phase 3 — measured-movement + peer benchmark surfaces.** Join the persisted
  series to run history (the rank-annotation pattern in `rankAnnotations.ts`) to
  render "you shipped X → conversion moved Y" and the download-to-paid peer
  benchmark finding. This is where the honesty model finally shows a MEASURED
  conversion number instead of "—". See `03-measured-movement.md`.

Each phase ships alone and is independently valuable; Phase 1 is the spike that
proves the async/auth model before we invest in ingestion.

## Honesty rules (hard, whole feature)

- **Measured or absent — never modeled.** Every number here is Apple's, quoted
  verbatim with its date range and segment. We never interpolate a missing day,
  never blend analytics with scraped rank, never present a trend the report
  didn't contain.
- **Attribution is correlation, not cause.** "You shipped X, then conversion
  moved" is a temporal correlation (same discipline as `rankAnnotations.ts` and
  the keyword-gap PRDs) — never "X caused the lift." The copy says so.
- **Admin-role gap is disclosed, not papered over.** A non-Admin key gets an
  honest "needs Admin to read analytics" note, never a silent zero and never a
  broken audit.
- **Pending is pending.** During Apple's 1–2 day generation the surface says
  "requested, awaiting Apple," never "0 views."
- **Peer benchmark carries its provenance.** It's Apple's differential-privacy
  number vs. Apple's peer set — labeled as such, never presented as our metric.
- **No credential persistence changes.** The `.p8` stays request-scoped and
  never persisted (the never-persist-credentials invariant is untouched); only
  the *report data* Apple returns is persisted, and it's the user's own app's.

## What this is NOT

- Not a BI/analytics dashboard (that's the vendor moat we don't chase —
  `phase-4-moat.md`). We surface only the handful of numbers that make an audit
  finding measurable.
- Not Commerce/Usage/Framework/Performance in v1.
- Not the legacy Sales & Trends API (deprecating through 2027).
- No change to the synchronous audit's latency or its App-Manager-key path.

## Adjacent public data (no `.p8` needed) — see `04-public-data-map.md`

The Analytics API needs Admin + async; the sibling doc maps what's reachable
WITHOUT any key at all (iTunes Search/Lookup, the customer-reviews RSS, the
storefront-page JSON we already parse, and the public top-charts RSS feed we do
NOT yet use), and where each honestly substitutes for — or falls short of — the
keyed data. That map is the cheaper, top-of-funnel complement to this PRD.

## Open questions

1. Where does the Phase-1 "ensure a report request exists" run — on first
   ASC-keyed run, or a dedicated opt-in? (Creating an ONGOING request is a write
   to the user's ASC account; it needs explicit consent, like credential save.)
2. Ingestion cadence (Phase 2): piggyback the hourly sweep, or a dedicated cron?
   Instances are daily — no need to poll faster than daily.
3. Retention/storage: how many days of per-segment series do we keep in D1
   before rollup? (Conversion-movement needs ~90 days around a ship.)
4. Peer benchmark is app-level, not per-CPP/source — does it live as a
   standalone finding rather than in the per-change movement view?
