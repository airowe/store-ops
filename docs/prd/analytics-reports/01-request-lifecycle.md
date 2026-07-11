# PRD — Analytics Reports Phase 1: request lifecycle + Admin detection + honest empty state

> **Status: shipped (Phase 1).** Implements the first phase of `00-overview.md`.
> This phase establishes the asynchronous report *request* and detects, honestly,
> whether the user's key may even ask — and surfaces nothing but a pending state.
> **No metrics.** Ingestion, parsing, and measured-movement surfaces are Phases
> 2/3 and are deliberately out of scope here.

## What shipped

Two thin API endpoints over one pure engine module, plus a dedicated opt-in gate:

| Piece | Location |
|---|---|
| Engine (pure, injected fetch) | `cloud/src/engine/ascAnalytics.ts` (+ `.spec.ts`) |
| Routes (read-only status + consent write) | `cloud/src/api/index.ts` (+ `ascAnalytics.spec.ts`) |
| Opt-in flag | `ANALYTICS_ENABLED` on `Env` (`cloud/src/index.ts`) |

The engine talks to the **Analytics Reports API** (`analyticsReportRequests`)
only — never the deprecated Sales & Trends API (deprecating through 2027).

## The three hard properties, and how Phase 1 answers each

1. **Admin-role required.** A report request needs an **Admin**-role key; the
   audit's App-Manager key may 403. `probeAnalyticsAccess` lists the app's
   `analyticsReportRequests`; a **401/403** becomes the honest `admin_required`
   state ("your key needs Admin — your audit still works, this only gates
   measured conversion data"). The probe **never throws** and is never on the
   audit's path, so a role gap can neither fail nor slow a run.
2. **Asynchronous (~1–2 days).** Creating a request returns **no data** — Apple
   generates instances over 1–2 days. So the only honest post-create state is
   `pending` ("requested — check back; nothing to show yet"), **never** "0
   views". Reading those instances is Phase 2.
3. **Files, not JSON.** N/A to Phase 1 — we only create/inspect the *request*
   resource (JSON:API). The gzipped CSV/TSV segment ingestion is Phase 2.

## The honest state machine (engine `AnalyticsState`)

Every state is measured-or-absent; none carries a fabricated number.

- `admin_required` — 401/403 from Apple. The role gap, disclosed.
- `unavailable` — any other non-OK / network error. A transient reach failure —
  **not** a false "requested" and **not** a zero.
- `not_requested` — permitted, but no ongoing request exists yet (read-only
  status only; the pre-consent state).
- `pending` — an ongoing request exists (or was just created). Carries
  `requestId` and `created` (true = we made it this call, false = already there).

`pickOngoingRequest` is the pure idempotency check: it matches an
`accessType: ONGOING` request that is **not** `stoppedDueToInactivity`. A
`ONE_TIME_SNAPSHOT` or a stopped request does not count as a live feed, so
`enable` treats those as "none exist" and (re)creates.

## Endpoint shapes

Both are app-scoped `POST`s (the credential rides in the body; a GET can't carry
a `.p8`) and resolve the ASC app id from the bundle id via `findAscAppId`.
Credentials resolve through the shared `resolveAscCredential` (#179): the
in-request `p8`/`keyId`/`issuerId` trio wins; otherwise the saved key (#67) is
decrypted for this single use. The `.p8` is request-scoped — **never persisted or
logged** — and no token appears in any response or error.

### `POST /apps/:id/analytics/status` — read-only, **ungated**
Detects the Admin gap and reports whether an ongoing request already exists.
**Never writes.** Not behind `ANALYTICS_ENABLED` (mirrors the read-only
`ascVerifyRoute`), so a surface can show the honest current state on load.
Returns an `AnalyticsState`.

### `POST /apps/:id/analytics/enable` — the **consent write**, gated
Ensures exactly one ongoing request exists, idempotently:
- probe → `admin_required` / `unavailable` short-circuit (no write attempted);
- an existing ongoing request → `pending{created:false}` (**never a second
  request**);
- none → `POST /v1/analyticsReportRequests` with

  ```json
  { "data": { "type": "analyticsReportRequests",
              "attributes": { "accessType": "ONGOING" },
              "relationships": { "app": { "data": { "type": "apps", "id": "<ascAppId>" } } } } }
  ```

  → `pending{created:true}`. A 403 on the create itself still resolves to
  `admin_required` (disclosed, not papered over).

Gated behind **`ANALYTICS_ENABLED`** (unset → **403**, zero egress). Creating the
request is an outward write to the user's Apple account, so it stays dark until a
deployment deliberately turns it on — the same posture as `ASC_WRITE_ENABLED` for
metadata pushes, but a **separate** flag so enabling analytics never implies
enabling metadata writes.

## Open question 1 — where "ensure a request exists" runs — RESOLVED

**Decision: a dedicated opt-in endpoint reached by an explicit UI click — NOT
automatic on a keyed run.**

Rationale:
- Creating an `ONGOING` request is a **write to the user's App Store Connect
  account**. Every other outward ASC write in this codebase (metadata push #11,
  draft-version create #34, locale create #78) is its own explicitly-clicked
  route, never a silent fallback. Analytics follows that established discipline.
- Coupling it to a keyed audit run would make an invisible account write a side
  effect of "just run my audit" — exactly the surprise the consent model exists
  to prevent.
- Splitting **status** (read-only, safe, ungated) from **enable** (write,
  gated + clicked) lets a surface show the honest state *before* asking for
  consent, so the click is informed ("this creates an ongoing report request in
  your App Store Connect account").

## Honesty rules honored (from `00-overview.md`)

- **Measured or absent — never modeled.** Phase 1 surfaces no numbers at all;
  `pending`/`not_requested`/`admin_required`/`unavailable` are disclosures, not
  metrics.
- **Admin-role gap is disclosed, not papered over.** 401/403 → an explicit
  `admin_required`, never a silent zero and never a broken audit.
- **Pending is pending.** The ~1–2 day generation window is named, never
  rendered as "0 views".
- **No credential persistence changes.** The `.p8` stays request-scoped (or the
  already-encrypted saved key, decrypted for one use); only Apple's *report
  request id* is ever returned. The never-persist-credentials invariant is
  untouched — and Phase 1 persists nothing to D1 (that begins in Phase 2).

## What Phase 1 deliberately does NOT do

- No report **instance** fetch, no CSV/TSV parse, no D1 persistence.
- No metrics surface (conversion / impressions / PPV / downloads) — still `—`.
- No Commerce/Usage/Framework/Performance categories.
- No peer benchmark. All of the above are Phases 2/3.

## Follow-ups for Phase 2 (`02-engagement-ingest.md`, to be written)

- Poll `analyticsReportRequests/{id}/reports`, filter to the **Engagement**
  category, page to ready `instances`, download + parse the gzipped segment
  files, and persist a compact per-app/day/source/CPP series in D1.
- Decide ingestion cadence (open question 2) — daily instances need no faster
  than a daily cron.
- Safe-degrade: a not-yet-ready or failed report leaves any prior data intact.
