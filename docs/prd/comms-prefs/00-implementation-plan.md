# Communication preferences — implementation plan

Status: **planned** (this document set is the iterated plan; build follows per phase).

## Problem

Users cannot control the frequency or type of communications. Today:

- The **weekly digest email** is welded to the weekly sweep — the only way to
  silence it is `agent_paused`, which also stops the product working.
- **Push** (run-ready notifications, added with the mobile app) is all-or-nothing
  at the OS-permission level; there is **no server-side toggle** and **no
  unregister endpoint** — sign-out leaves the device token pointed at the account
  until Expo reports the device dead.
- The **digest email has no unsubscribe path** — a recurring, non-transactional
  email without one is a CAN-SPAM / deliverability liability the moment real
  users are on it (mailbox providers punish the whole sending domain).
- `rank_cadence` exists (API-only) but controls **data collection**, not
  communications — and has no UI anywhere.

## Goal

Per-user communication preferences with honest defaults (existing behavior
unchanged), controllable from web + mobile, plus a compliant one-click
unsubscribe on the digest email. The agent's WORK is never silently affected:
communication preferences change what we *send*, never what we *do*.

## Non-goals

- Per-app communication prefs (per-app targeting already exists via
  `agent_paused`; prefs are per-user, mirroring `rank_cadence`).
- Marketing email (none exists; the `subscribers` table is a separate concern).
- New notification types (the model must accommodate them, not ship them).
- In-app notification center / SMS / anything beyond email + push.

## The preference model

Two channels exist today, each with exactly one communication type:

| Pref | Channel · type | Values | Default (= today's behavior) |
|---|---|---|---|
| `email_digest` | email · weekly digest | `'weekly'` \| `'off'` | `'weekly'` |
| `push_run_ready` | push · run awaits approval | `1` \| `0` | `1` |

**Columns on `users`**, not a JSON blob or a side table — consistent with
`agent_paused` / `rlhf_opt_out` / `rank_cadence`, CHECK-enforced, and legible in
SQL. Growth path: each future type is a new column with a CHECK enum; if the
count ever exceeds ~6, consolidate into a `notification_prefs` table then (a
migration we'd need anyway, and YAGNI until then).

`email_digest` is an **enum, not a boolean**, so a future `'daily'` digest slots
into the same column. `push_run_ready` is a plain 0/1 (there is no cadence to a
gate alert).

**Decision — defaults are opt-out (on):** the digest and run-ready push are core
product value ("prove the rank moved" / "a run needs you"), sent only to people
who signed up and connected an app; both become one-tap silenceable. Existing
users keep exactly today's behavior through the migration defaults.

**Layering with existing switches** (no interaction changes):
- `agent_paused` (per-app) keeps suppressing that app's digest input AND its
  runs — pausing stops the work, so there is nothing to communicate.
- Tier gates keep applying first (free tier: no sweep → no digest either way).
- Communication prefs sit AFTER those gates: they only filter delivery of
  communications the system would otherwise send.

## Phases

| # | PRD | Scope | Verifiable here |
|---|---|---|---|
| 1 | `phase-1-server-prefs.md` | schema + prefs API + digest/push gating + push unregister | fully (vitest) |
| 2 | `phase-2-unsubscribe.md` | signed unsubscribe token + RFC 8058 one-click + email headers/footer | fully (vitest) |
| 3 | `phase-3-web-settings.md` | web settings panel (digest, cadence surfacing) | fully (vitest + e2e) |
| 4 | `phase-4-mobile-settings.md` | mobile settings screen + sign-out token cleanup | fully (jest render) |

Phases 1→2 are ordered (unsubscribe flips the Phase-1 pref). 3 and 4 are
independent of each other, both depend on 1 (and 3's unsubscribe copy on 2).

## Key integration points (verified against the code)

- **Digest gate:** `sendWeeklyDigests` (cloud/src/cron/scheduled.ts) already
  loads the user row per app — the `email_digest === 'off'` skip slots in right
  after `getUser`, before any further reads.
- **Push gate:** `notifyRunAwaitingApproval` (cloud/src/push.ts) — check the
  owner's `push_run_ready` before listing device tokens (one extra read; keeps
  the gate server-side so a stale client can't bypass it).
- **Unsubscribe token:** `auth.ts` mint/verify already audience-separates via
  `TokenKind = "magic" | "session"` — add `"unsub"`. Same HMAC secret, long TTL,
  cannot be replayed as a session or magic token (tested, like `/auth/exchange`).
- **Email headers:** `EmailMessage` has no headers field; extend it with optional
  `headers` and wire Brevo/Resend to pass `List-Unsubscribe` +
  `List-Unsubscribe-Post` through (Console sender just logs them).
- **`/auth/me`** already carries `paused` / `rlhf_opt_out` / `rank_cadence` —
  extend the same body with the two prefs so clients need no extra boot call.

## API surface (final shape)

```
GET    /account/notifications          → { email_digest, push_run_ready }
POST   /account/notifications          { email_digest?, push_run_ready? } → new state
DELETE /account/push-token             { token } → { removed: boolean }   (own row only)
GET    /email/unsubscribe?token=…      → confirmation PAGE (no state change)
POST   /email/unsubscribe?token=…      → flips email_digest='off' (idempotent)
```

- `POST /account/notifications` is a PATCH-style partial update: only the fields
  present change; unknown values → 400 (never silently coerced) — mirrors
  `rank-cadence`.
- `DELETE /account/push-token` deletes `WHERE token = ? AND user_id = ?` — a
  user can only remove their OWN registration (complements the documented
  re-registration tradeoff on POST).
- **Unsubscribe is POST-only for state change.** Mail scanners and link
  prefetchers follow GET links; a GET that unsubscribes silently drops real
  users off the digest. GET renders a page with one confirm button; the RFC 8058
  one-click header POSTs directly. This is the classic footgun — designed out.

## Security / privacy invariants

- The unsubscribe token is audience-separated (`"unsub"`), long-TTL, and scoped
  to ONE action (digest off). It must never authenticate anything else, and a
  session/magic token must never work as an unsub token (both directions tested).
- The unsubscribe endpoints are public but leak nothing: an invalid token gets
  the same generic 400 page; a valid token's page shows only the (already-known)
  email it came addressed to.
- No pref read/write path touches credentials; prefs ride `/auth/me` exactly as
  the existing flags do.
- Demo mode (`X-User-Email`) works unchanged — prefs are per-user rows.

## Honesty invariants

- Turning `email_digest` off stops the EMAIL, not the sweep — runs still open,
  the dashboard still shows them. The settings copy must say exactly that.
- Turning `push_run_ready` off stops the NOTIFICATION, not the run. Same copy rule.
- The unsubscribe confirmation page states what was turned off and that the
  product keeps working — never a guilt-trip, never a dark-pattern re-subscribe.

## Rollout / migration

- `ALTER TABLE users ADD COLUMN …` with defaults preserving current behavior
  (documented in schema.sql exactly like the prior migrations; the human applies
  remotely). Legacy rows read as defaults via the same null-coalescing used for
  `rank_cadence` (`mapUserRow`).
- No client dependency ordering: old clients ignore the new `/auth/me` fields;
  new clients degrade (settings hidden) if the fields are absent.

## Success criteria

1. A user can turn the digest email off (web, mobile, or the email itself) and
   still see runs open normally.
2. A user can turn run-ready push off server-side without touching OS settings,
   and sign-out removes the device registration.
3. The digest email carries a working RFC 8058 one-click unsubscribe.
4. Every gate has a test proving the communication is NOT sent when off and IS
   sent when on (both directions — a gate that silently never sends is a bug the
   "off works" test alone won't catch).
