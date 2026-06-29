# Phase 1 — Auth + Dashboard PRD (ShipASO mobile)

Parent: `00-implementation-plan.md`. Depends on: Phase 0.

## Objective
A user can sign in (magic link → Bearer session token in SecureStore), land on
the dashboard, see their connected apps, connect a new app by name/URL/id, and —
when logged out on a live backend — see the try-before-signup preview.

## Scope
- **In:** login screen + magic-link deep-link capture; session boot via
  `/auth/me`; authed/unauthed route groups; dashboard (apps list + latest run
  status); connect/search picker (resolve → candidates → connect) with paging +
  infinite scroll; empty state; logged-out preview.
- **Out:** app detail internals, run detail, credentials (Phases 2–3).

## Files
- `mobile/app/(public)/login.tsx`, `mobile/app/(public)/preview.tsx`
- `mobile/app/(app)/_layout.tsx` (auth guard → redirect to login if `/auth/me` unauthed)
- `mobile/app/(app)/index.tsx` (dashboard)
- `mobile/src/auth/session.ts` (token store, boot, deep-link capture, sign-out)
- `mobile/src/components/ConnectPicker.tsx`, `AppCard.tsx`, `EmptyState.tsx`
- `mobile/src/api/endpoints.ts` (`me`, `authRequest`, `authExchange`, `resolve`,
  `connectApp`, `listApps`, `preview`)
- tests: `session.test.ts`, `ConnectPicker.test.tsx`, `dashboard.test.tsx`

## Contracts / reuse
- `POST /auth/request {email}` → always `{sent:true}`.
- **Mobile callback (server gate, see plan §1a):** magic link → universal link
  opens the app with a token → `authExchange` returns `{ token }` (or
  `/auth/callback` JSON mode). App stores it in SecureStore; all calls Bearer.
- `GET /auth/me` → `{ authed, via, email? }` boot check.
- `POST /resolve {query}` → `{kind:'resolved'|'candidates'|'not-found', candidates}`.
- `POST /apps {bundle_id|query,...}` → connect (may return `{needsChoice,candidates}`).
- `GET /apps` → list + latest run status. `POST /preview`/`GET preview` for logged-out.

## Acceptance criteria
- Cold start with a stored valid token → dashboard; no token / 401 → login.
- Magic-link deep link captured → token persisted → routed into the app.
- Connect by name shows the candidate picker; ambiguous connect surfaces choices;
  exact id/URL connects directly and routes to the app.
- Picker pages ("show more" + scroll sentinel), honest end-of-results nudge.
- Logged-out + live backend → preview (a real `/preview` audit), signup gated at
  "Connect & run."

## Tests
- `session.test.ts` — boot states (token→authed, none→login, 401→sign-out),
  deep-link token capture writes to SecureStore.
- `ConnectPicker.test.tsx` — resolved→connect, candidates→pick, not-found nudge,
  paging appends.
- `dashboard.test.tsx` — renders app cards with status; empty state.
- All against a mock API (the `mock.js` contract as typed fixtures) — no network.

## Dependencies / external gates
- **Server gate:** the mobile auth-callback/exchange + universal-link association
  files (AASA / assetlinks). Until shipped, dev uses the demo `X-User-Email` path
  or a pasted token for testing.

## Definition of done
Sign-in works end to end against a test/staging backend; dashboard + connect
flow green in tests; logged-out preview renders. Credentials still absent.
