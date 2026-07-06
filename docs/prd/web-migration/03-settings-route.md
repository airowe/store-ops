# PRD 03 — `/settings` (first route cutover)

> Migrate the smallest, lowest-risk route first to prove the whole machine end to
> end: shared spine → TanStack Start route → real API mutations → edge cutover →
> E2E-gated flip. `/settings` exercises auth, forms, mutations, stored keys, and
> the theme toggle without touching the honesty-critical rank/approval surfaces.

## The move
Port `viewSettings()` (`app.js`) to a TanStack Start route at `/settings`,
faithful to the Expo `(app)/settings.tsx` (which is already componentized) and
the current web card layout.

## Deliverables
- `cloud/web/app/routes/settings.tsx`.
- Sections (parity with today): **Communications** (run-ready push, weekly
  digest, rank-check cadence), **Stored keys** (metadata-only list + honest
  delete), **Appearance** (System/Light/Dark — ported from the mobile control),
  **Account** (email, sign-out).
- Mutations via `@shipaso/api`: `setNotifications`, `setRankCadence`, key
  delete, `/auth/logout`. Optimistic where the mobile app already is.

## UI
- Reuse ported `.card`, `.fld`, `.btn` styles; toggles read On/Off honestly.
- Rank-cadence is labeled **data collection, not email frequency** (verbatim from
  the current copy).

## Honesty
- A denied OS push permission (mobile parity) / a server-off state shows a
  truthful off-state, never a lying "on".
- Stored keys list shows **metadata only** — never key material; delete is
  honest ("removed", not "revoked" unless the API confirms).

## TDD
- Port the settings component tests from `mobile/app/(app)/settings.test.tsx`
  patterns; assert each toggle round-trips against a mocked `@shipaso/api`.

## Acceptance
- `/settings` served by the new app (edge flip); legacy `#/settings` path
  redirects to it.
- The `storedCredentials.e2e.ts` "Settings lists saved keys (metadata only) and
  deletes honestly" + `thresholds.e2e.ts` cadence specs pass against the new
  route **before** the flip.
- Comms/cadence changes persist across reload.

## Coexistence / rollback
- Flip only `/settings` in the edge map; everything else still proxies to legacy.
  Rollback = revert that one entry.

## Dependencies
- **PRD 01, 02.** First consumer of the shell; validates the cutover playbook the
  later routes reuse.
