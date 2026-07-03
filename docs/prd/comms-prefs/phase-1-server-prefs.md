# Phase 1 — Server preferences PRD (comms-prefs)

Parent: `00-implementation-plan.md`. Depends on: nothing (first).

## Objective

The per-user preference rows, the API to read/write them, and the two delivery
gates actually honoring them — plus the missing push unregister. After this
phase the system OBEYS preferences end to end; UIs come later.

## Scope

- **In:** `users.email_digest` + `users.push_run_ready` columns (+ migration
  notes); d1 helpers; `GET/POST /account/notifications`; prefs on `/auth/me`;
  digest gate in `sendWeeklyDigests`; push gate in `notifyRunAwaitingApproval`;
  `DELETE /account/push-token`.
- **Out:** unsubscribe (Phase 2), any UI (Phases 3–4), new notification types.

## Files

- `cloud/schema.sql` — columns + ALTER migration comments (established pattern)
- `cloud/src/d1.ts` — `UserRow` fields, `mapUserRow` null-coalescing (legacy rows
  → defaults), `getNotificationPrefs`, `setNotificationPrefs`,
  `deleteDeviceTokenForUser(db, userId, token)`
- `cloud/src/api/index.ts` — `notificationsRoute` (GET/POST), `/auth/me` body,
  `DELETE /account/push-token` dispatch
- `cloud/src/push.ts` — pref check in `notifyRunAwaitingApproval`
- `cloud/src/cron/scheduled.ts` — `email_digest === 'off'` skip in
  `sendWeeklyDigests`
- specs: `cloud/src/api/notifications.spec.ts`,
  `cloud/src/cron/digestGate.spec.ts` (or extend the scheduled spec),
  extend `cloud/src/push.spec.ts` + `cloud/src/api/pushToken.spec.ts`

## Contracts

- `GET /account/notifications` → `{ email_digest: 'weekly'|'off', push_run_ready: boolean }`.
- `POST /account/notifications { email_digest?, push_run_ready? }` — partial
  update; absent fields untouched; invalid values → 400 (`email_digest` must be
  `'weekly'|'off'`; `push_run_ready` must be boolean). Returns the full new state.
- `/auth/me` (authed) additionally carries `email_digest` + `push_run_ready`
  alongside the existing `paused`/`rlhf_opt_out`/`rank_cadence`.
- `DELETE /account/push-token { token }` → `{ removed: boolean }`; deletes
  `WHERE token = ? AND user_id = ?` only (never another user's row); a
  malformed token is a 400, a token not owned by the caller → `removed:false`
  (not an error — sign-out must be idempotent).
- Gate semantics: `email_digest='off'` removes the user's apps from the digest
  INPUTS (before rank-history reads — cheaper AND correct);
  `push_run_ready=false` returns 0 from `notifyRunAwaitingApproval` before any
  token read.

## Acceptance criteria

- Fresh user: prefs read `weekly`/`true`; legacy row (columns absent in fake DB /
  pre-migration) reads the same via null-coalescing.
- POST flips each pref independently; bad enum/type → 400; auth-gated (401).
- Digest: a user with `off` gets NO digest while a `weekly` user in the same
  sweep still gets theirs (both directions in one test).
- Push: `push_run_ready=false` → notify returns 0 and never reads tokens;
  `true` → sends as today.
- DELETE push-token: removes own row; cannot remove another user's row; second
  call → `removed:false`, 200.
- `agent_paused` and tier gates behave exactly as before (regression assertions
  in the digest test).

## Tests

Route specs use the established in-memory-D1 + `handleApi` + demo-auth harness.
The digest test drives `sendWeeklyDigests` with a canned `CronReport` and a fake
sender capturing `to:` addresses — asserting both the suppressed AND delivered
sides. Push tests extend the existing fake-D1 pattern in `push.spec.ts`.

## Definition of done

All gates honored and tested both directions; full cloud suite green; tsc clean.
No UI yet — the API is the product of this phase.
