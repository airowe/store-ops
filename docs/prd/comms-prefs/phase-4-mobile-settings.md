# Phase 4 — Mobile settings PRD (comms-prefs)

Parent: `00-implementation-plan.md`. Depends on: Phase 1 (API). Independent of
Phase 3.

## Objective

A Settings screen in the Expo app — the app currently has NO settings surface
(only a sign-out button on the dashboard): run-ready push toggle (server pref +
device registration), digest on/off, rank cadence, and sign-out that actually
cleans up the device registration.

## Scope

- **In:** `app/(app)/settings.tsx`; push toggle wiring (pref + register/
  unregister); digest + cadence controls; sign-out moves here and calls
  `DELETE /account/push-token` BEFORE dropping the session; endpoints +
  DTO additions.
- **Out:** iOS notification-settings deep link polish; per-app controls;
  anything Phase 2 serves (unsubscribe is email-side).

## Files

- `mobile/app/(app)/settings.tsx` — the screen (Screen/Card/Button primitives,
  responsive like every other screen)
- `mobile/app/(app)/index.tsx` — dashboard header: replace the inline sign-out
  with a Settings link (sign-out lives in Settings now)
- `mobile/src/api/endpoints.ts` — `getNotifications`, `setNotifications`,
  `deletePushToken`; `mobile/src/types/api.ts` — `NotificationPrefs` DTO +
  extended `Me`
- `mobile/src/notifications/register.ts` — keep the registered token accessible
  (module-level or SecureStore-adjacent? NO — memory only is fine: sign-out can
  send the CURRENT token from a fresh `getExpoPushTokenAsync` call; do not
  persist anything new)
- `mobile/src/auth/AuthProvider.tsx` — `signOut` accepts an optional async
  pre-hook (or Settings orchestrates: delete token → then `signOut()`)
- tests: `settings.test.tsx` (render + toggle round-trips + honest copy),
  `signout.cleanup.test.ts` (ordering: DELETE fires while still authed)

## Contracts / reuse

- Push toggle = TWO coordinated actions, surfaced honestly:
  - ON: OS permission prompt → register token (`POST /account/push-token`) →
    `POST /account/notifications {push_run_ready:true}`. Permission denied → the
    toggle stays off with copy pointing at OS Settings (never a lying "on").
  - OFF: `POST /account/notifications {push_run_ready:false}` (server gate — the
    token stays registered so ON is instant; the server won't send).
- Sign-out ordering matters and is test-pinned: `DELETE /account/push-token`
  requires auth, so it MUST run before the session token is cleared; a failed
  DELETE never blocks sign-out (best-effort, the server gate still holds).
- Digest + cadence: same POSTs as web; state boots from `/auth/me` via the
  existing AuthProvider `me` object (extended DTO).

## Acceptance criteria

- Settings renders all three controls with current state from `me`.
- Push OFF → server pref flips; no OS interaction. Push ON with permission
  granted → registers + flips pref; with permission denied → stays off, honest
  copy, no fake state.
- Sign-out: device token DELETE observed BEFORE session clear (ordering test
  with a recording fake client); DELETE failure → sign-out still completes.
- Digest/cadence toggles reflect server responses; failures restore prior state.
- Renders correctly at phone AND iPad widths (add to `screens.smoke.test.tsx`).

## Tests

jest-expo render tests with the established fake-client + mocked-native harness;
the never-persisted invariant suite must stay green (nothing new is persisted —
the push toggle stores NOTHING on device beyond what exists today).

## Definition of done

A mobile user controls push/digest/cadence from Settings; sign-out cleans up its
device registration; all suites green at both size classes.
