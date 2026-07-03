# Phase 4 — Mobile settings PRD (comms-prefs) — v2

Parent: `00-implementation-plan.md`. Depends on: Phase 1 (API). Independent of
Phase 3.

## Objective

A Settings screen in the Expo app — the app has NO settings surface (only a
sign-out button on the dashboard): run-ready push toggle (server pref +
registration awareness), digest on/off, rank cadence, and sign-out that cleans
up the device registration.

## Scope

- **In:** `app/(app)/settings.tsx`; push/digest/cadence controls; token capture
  at registration (G6); sign-out ordering (DELETE while still authed);
  endpoints + DTOs; phone + iPad smoke coverage.
- **Out:** OS notification-settings deep links; per-app controls; unsubscribe
  (email-side).

## Files

- `mobile/app/(app)/settings.tsx` — the screen (existing primitives; responsive)
- `mobile/app/(app)/index.tsx` — header: Settings link replaces the inline
  sign-out (sign-out moves into Settings)
- `mobile/src/notifications/register.ts` — **G6: capture the token**. Today
  `NotificationsBridge` fire-and-forgets `registerForPush` and DISCARDS its
  returned token, so sign-out would have nothing to delete. Add a module-level
  `lastKnownPushToken: string | null` set by `registerForPush` on success
  (memory only — nothing new persisted; the never-persisted suite must stay
  green). A fresh `getExpoPushTokenAsync` call is the FALLBACK only (it is a
  network round-trip to exp.host and fails offline/permission-denied — it must
  not be the primary path).
- `mobile/src/api/endpoints.ts` — `getNotifications`, `setNotifications`,
  `deletePushToken`. **G5: the client has no `delete` method** — implement as
  `c.request(path, { method: "DELETE", body: { token } })`, which the client
  already supports. Do NOT add a new client method (every fake client in the
  test suite is `{get, post, request}` and would break).
- `mobile/src/types/api.ts` — `NotificationPrefs` DTO; `Me` extended with the
  prefs (mirrors the Phase-1 `/auth/me` body).
- `mobile/src/auth/AuthProvider.tsx` — sign-out stays dumb; the Settings screen
  orchestrates: best-effort `deletePushToken(lastKnownPushToken ?? fresh)` →
  THEN `signOut()`.
- tests: `settings.test.tsx` (render, toggle round-trips, honest
  permission-denied state), `signout.cleanup.test.ts` (ordering + failure
  tolerance), extend `screens.smoke.test.tsx` (both widths).

## Contracts / reuse

- Push toggle = two coordinated actions, surfaced honestly:
  - ON: OS permission (prompt if undetermined) → `registerForPush` (existing) →
    `POST /account/notifications {push_run_ready:true}`. Permission denied →
    toggle stays OFF with copy pointing at OS Settings — never a lying "on".
  - OFF: `POST /account/notifications {push_run_ready:false}` only. The token
    stays registered (ON is instant again); the SERVER gate stops sends — copy
    says "ShipASO stops sending; your device stays registered."
- Sign-out ordering, test-pinned: `DELETE /account/push-token` requires auth ⇒
  it MUST run before the session token is cleared. A failed/absent-token DELETE
  never blocks sign-out (best-effort; the server pref gate still holds).
- Digest + cadence: same POSTs as web; state boots from the AuthProvider `me`
  object (extended DTO) — no extra fetch.

## Acceptance criteria

- Settings renders all three controls from `me`; navigation from the dashboard
  header works.
- Push OFF → one POST, no OS interaction. Push ON + granted → register + POST.
  Push ON + denied → stays off, honest copy, no fake state.
- Sign-out: DELETE observed BEFORE session clear (recording fake client);
  DELETE rejection → sign-out still completes; no captured token + fallback
  failure → sign-out still completes.
- Toggles reflect server responses; failures restore prior state.
- Renders at phone AND iPad widths (smoke suite).
- `credentials.neverPersisted` suite untouched and green (nothing new persists).

## Definition of done

Mobile users control push/digest/cadence from Settings; sign-out cleans up its
registration; all suites green at both size classes.
