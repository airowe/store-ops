# Phase 1 — Server preferences PRD (comms-prefs) — v2

Parent: `00-implementation-plan.md`. Depends on: nothing (first).

## Objective

The per-user preference rows, the API to read/write them, and the two delivery
gates actually honoring them — plus the missing push unregister. After this
phase the system OBEYS preferences end to end; UIs come later.

## Scope

- **In:** `users.email_digest` + `users.push_run_ready` columns (+ migration
  notes + pinned deploy order); d1 helpers; `GET/POST /account/notifications`;
  prefs on `/auth/me` (**both** the session and demo branches — G7);
  digest gate in `sendWeeklyDigests`; push gate in `notifyRunAwaitingApproval`;
  `DELETE /account/push-token`.
- **Out:** unsubscribe (Phase 2), any UI (Phases 3–4), new notification types.

## Files

- `cloud/schema.sql` — columns + ALTER migration comments; the migration note
  MUST state the deploy order (ALTER before Worker deploy — see 00-plan G3)
- `cloud/src/d1.ts` — `UserRow` fields (+ `USER_COLS`), `mapUserRow` coalescing,
  `getNotificationPrefs(db, userId)`, `setNotificationPrefs(db, {userId, …})`,
  **slim `getPushRunReady(db, userId)`** (missing row → `true`, mirroring
  `getRankCadence`/`getOptOut` — G4), `deleteDeviceTokenForUser(db, userId, token)`
- `cloud/src/api/index.ts` — `notificationsRoute` (GET/POST), BOTH `authMe`
  branches, `DELETE /account/push-token` dispatch (DELETE precedent:
  `DELETE /apps/:id`)
- `cloud/src/push.ts` — `getPushRunReady` check first in `notifyRunAwaitingApproval`
- `cloud/src/cron/scheduled.ts` — `email_digest === 'off'` skip in
  `sendWeeklyDigests`; while touching the loop, cache the user row per
  `user_id` (N4 — prefs ride the row the loop already fetches per app)
- specs: `cloud/src/api/notifications.spec.ts`, digest-gate coverage in the
  scheduled/digest spec, extend `cloud/src/push.spec.ts` +
  `cloud/src/api/pushToken.spec.ts`

## Contracts

- `GET /account/notifications` → `{ email_digest: 'weekly'|'off', push_run_ready: boolean }`
  (boolean at the API edge; 0/1 in SQLite — N5).
- `POST /account/notifications { email_digest?, push_run_ready? }` — partial
  update; absent fields untouched; invalid values → 400. Returns full new state.
- `/auth/me` (session AND demo branches) additionally carries both prefs.
- `DELETE /account/push-token { token }` → `{ removed: boolean }`; deletes
  `WHERE token = ? AND user_id = ?` only; malformed token → 400; not-owned or
  already-gone → `{removed:false}`, 200 (idempotent sign-out).
- Digest gate: skip a user's app entries when `email_digest='off'` BEFORE the
  `hasOpenRun`/`getRankHistory` reads. Because the digest fans out per app (G8),
  'off' silences every app the user owns.
- Push gate: `getPushRunReady` first in `notifyRunAwaitingApproval`; `false` →
  return 0 before any token read. **Missing row / pre-migration → `true`**
  (fail-open = today's behavior; also keeps the existing push.spec fakes —
  whose `.first()` returns null — green without edits).

## Acceptance criteria

- Fresh user: prefs read `weekly`/`true`; a row with NULLs (pre-migration
  values) reads the same via `mapUserRow` coalescing.
- POST flips each pref independently; bad enum/type → 400; auth-gated (401).
- Digest: in ONE sweep fixture, an `off` user gets NO digest while a `weekly`
  user still gets theirs (both directions in one test); a multi-app `off` user
  contributes ZERO inputs.
- Push: `push_run_ready=false` → notify returns 0, no token read; `true` and
  missing-row → sends as today (regression: existing notify tests unchanged).
- DELETE push-token: removes own row; cannot remove another user's row (their
  row survives, caller gets `removed:false`); repeat call → `removed:false`, 200.
- `agent_paused` + tier gates behave exactly as before (regression assertions).

## Tests

Established in-memory-D1 + `handleApi` + demo-auth harness for routes. Digest
test drives `sendWeeklyDigests` with a canned `CronReport` + fake sender
capturing `to:`. Push tests extend the existing fake-D1 pattern.

## Definition of done

All gates honored and tested both directions; full cloud suite green; tsc clean.
