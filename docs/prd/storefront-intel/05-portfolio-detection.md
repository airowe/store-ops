# PRD 05 — Portfolio auto-detection from `moreByDeveloper`

> The storefront page of every audited app already lists the seller's OTHER apps
> (`moreByDeveloper`, persisted on the run trace since the intel seam). Turn that
> into "we found N other apps by this seller — track them?" — API endpoint now,
> dashboard card as a fast-follow.

## Strategic frame (why this, why now)

Multi-app is the Phase-3 expand motion, and every competitor (AppKittie included)
makes users hand-enter each app. We get the seller's whole portfolio for free on
the very first audit — the cheapest possible activation lever for a fleet tier,
with zero extra fetches. It's honest expansion: we only ever *suggest*; the user
explicitly adds. Why now: the intel seam just landed (`audit.storefront` on the
persisted trace, commit `88cb191`), so this is a pure read of data we already store.

## Where it attaches

- **Data (shipped):** `audit.storefront.moreByDeveloper?: StorefrontApp[]`
  (`cloud/src/engine/agent.ts` → `StorefrontIntel`), extracted in
  `cloud/src/engine/storefrontListing.ts` and persisted in `runs.reasoning_json`.
  `StorefrontApp = { bundleId, name, subtitle?, rating?, ratingCount? }`.
- **This PRD adds:** one pure engine module, one D1 helper, one GET route.
  No engine `audit()` edits, no new storefront fetches.

## Deliverable

Pure engine module `cloud/src/engine/portfolio.ts` (no bindings):

```ts
export type PortfolioSuggestion = StorefrontApp; // bundleId, name, subtitle?, rating?, ratingCount?

export type PortfolioResult =
  | { known: true; suggestions: PortfolioSuggestion[] } // shelf was read; [] = "all tracked already"
  | { known: false };                                   // shelf unread/absent — UNKNOWN, not zero

export function detectPortfolio(
  moreByDeveloper: StorefrontApp[] | undefined, // from the stored trace
  trackedBundleIds: string[],                   // the user's apps table rows
  selfBundleId: string,                         // the audited app itself
): PortfolioResult;
```

Dedupe: drop `selfBundleId` and every bundle id the user already tracks
(case-insensitive compare — bundle ids are case-insensitive in practice).
Suggestions pass through exactly as extracted; optional fields stay absent when
the page didn't carry them.

D1 helper in `cloud/src/d1.ts` (reuses the existing `reasoning_json` read pattern):

```ts
export async function latestRunTraceForApp(
  db: D1Database,
  appId: string,
): Promise<{ runId: string; createdAt: string; trace: ReasoningTrace } | null>;
```

API route `GET /apps/:id/portfolio` in `cloud/src/api/index.ts`, segment-match
(`seg[0] === "apps" && seg[2] === "portfolio" && seg.length === 3 && method === "GET"`),
shaped like `competitorsList`: `requireOwnedApp` → `latestRunTraceForApp` →
`detectPortfolio(trace.result.audit.storefront?.moreByDeveloper, listAppsForUser(...).map(bundle_id), app.bundle_id)`.

```ts
// response
{ portfolio:
    | { known: true; suggestions: PortfolioSuggestion[]; asOf: string } // run created_at
    | { known: false; note: string } }                                  // honest reason
```

Public-storefront data only (Apple's own page) — safe past the serialization
privacy boundary. The dashboard card ("found N — track them?") is a fast-follow
(cloud/web isn't deployed); it will call the existing `POST /apps` per accepted
suggestion. Tracking stays a user action.

## Honesty rules (this feature)

- **Shelf absent ≠ no other apps.** An unread page, a pre-seam run, or a page
  without the shelf returns `known: false` — never `suggestions: []`, never zero.
- **`known: true` + `[]` means exactly** "we read the shelf and everything on it
  is already tracked (or is the app itself)" — the only case that earns it.
- **Staleness is disclosed:** `asOf` is the run's `created_at`; suggestions are
  as-of-that-run, not live.
- **Never auto-track.** Suggestions never become `apps` rows without an explicit
  `POST /apps` (same discipline as competitor discovery: suggested ≠ watched).
- **Pass-through only:** no invented ratings/subtitles; absent stays absent.
- **Safe-degrade:** no runs yet / old trace / malformed trace → `known: false`
  with a note ("run the agent to read the storefront"), never a 500.

## Test plan (TDD — specs first, red, then implement)

- `cloud/src/engine/portfolio.spec.ts` (pure): dedupes self + tracked
  (case-insensitive); preserves optional fields verbatim; `undefined` shelf →
  `{ known: false }`; all-tracked → `{ known: true, suggestions: [] }`; order preserved.
- API spec (colocated, `runSerialize.spec.ts` round-trip style): persist a trace
  carrying `audit.storefront.moreByDeveloper`, JSON round-trip, GET returns
  suggestions minus tracked with `asOf`; unauthed → 401; unowned app → 404;
  no runs → `known: false` + note; pre-seam trace (no `storefront`) → `known: false`.
- Gates from `cloud/`: `npm run typecheck` and `rtk proxy npx vitest run`, both green.

## Non-goals

- No UI in this PRD (cloud/web undeployed; the card is the fast-follow).
- No auto-adding apps; no plan-limit enforcement changes (`POST /apps` governs).
- No new storefront fetches, no suggestion persistence/table — computed on read
  from the stored trace.
- No Google Play analog ("more by this developer") — App Store only for now.
- No cross-user aggregation of seller portfolios.

## Open questions

- Should the response respect plan app-limits ("track them?" vs "upgrade to
  track"), or is that purely the dashboard's concern at POST time?
- Should `GET /apps` carry a small `portfolioCount` badge per card so the
  dashboard hook needs no extra call — and does that violate the one-precise-read
  shape of the list route?
- `StorefrontApp` has no country; new apps inherit the audited app's `country`
  on add — is that always right for a seller shipping per-storefront variants?
- Suggest from the latest run only, or the latest run *whose trace carries the
  shelf* (more resilient to a one-off page drift, slightly staler)?
