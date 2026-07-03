# Communication preferences — implementation plan

Status: **planned, v2** — draft v1 revised per an adversarial plan review run
against the actual codebase (3 blockers, 8 gaps fixed; noted inline as B*/G*).

## Problem

Users cannot control the frequency or type of communications. Today:

- The **weekly digest email** is welded to the weekly sweep — the only way to
  silence it is `agent_paused`, which also stops the product working. And the
  digest is **per-app fan-out**: `planDigests` emits one email per app, so a
  3-app user gets 3 emails every Monday (G8).
- **Push** (run-ready notifications) is all-or-nothing at the OS-permission
  level; there is **no server-side toggle** and **no unregister endpoint** —
  sign-out leaves the device token pointed at the account.
- The **digest email has no unsubscribe path** — a recurring, non-transactional
  email without one is a CAN-SPAM / deliverability liability.
- `rank_cadence` exists (API-only) but controls **data collection**, not
  communications — and has no UI anywhere. There is also **no settings surface
  on the web at all** (B2): the only "settings" are a privacy link in the header
  and the pause button on the dashboard banner.

## Goal

Per-user communication preferences with honest defaults (existing behavior
unchanged), controllable from web + mobile, plus a compliant one-click
unsubscribe on the digest email. The agent's WORK is never silently affected:
communication preferences change what we *send*, never what we *do*.

## Non-goals

- Per-app communication prefs. Prefs are per-user, consistent with **every**
  existing user-level switch — including `agent_paused`, which is per-user too
  (`users.agent_paused`; `isAgentPaused` resolves an app to its owner's flag —
  B3 corrected: draft v1 wrongly called it per-app). Per-app granularity is
  future work if ever demanded.
- Marketing email (none exists; `subscribers` is a separate concern).
- New notification types (the model must accommodate them, not ship them).
- In-app notification center / SMS / web push (none exists — no fake toggles).

## The preference model

Two channels exist today, each with exactly one communication type:

| Pref | Channel · type | API value | SQLite | Default (= today) |
|---|---|---|---|---|
| `email_digest` | email · weekly digest | `'weekly'` \| `'off'` | TEXT CHECK | `'weekly'` |
| `push_run_ready` | push · run awaits approval | `boolean` | INTEGER 0/1 | `true` |

(N5: boolean at the API edge, 0/1 in SQLite — the `agent_paused` precedent.)

**Columns on `users`**, not a JSON blob or side table — consistent with
`agent_paused` / `rlhf_opt_out` / `rank_cadence`, CHECK-enforced, legible in
SQL. Growth path: each future type is a new column; consolidate into a table
only if the count ever exceeds ~6. `email_digest` is an **enum, not a boolean**,
so a future `'daily'` slots into the same column.

**Decision — defaults are opt-out (on):** the digest and run-ready push are core
product value, sent only to people who signed up and connected an app; both
become one-tap silenceable. Existing users keep exactly today's behavior.

**Layering with existing switches** (no interaction changes):
- Tier gates apply first (free tier: no sweep → no digest either way).
- `agent_paused` (per-user) keeps suppressing sweeps → nothing to communicate.
- Communication prefs sit AFTER those gates: they only filter delivery of
  communications the system would otherwise send.
- **Digest fan-out consequence (G8):** because the pref is per-user and the
  digest is per-app, `email_digest='off'` silences ALL of a user's app digests,
  and the unsubscribe copy must say so ("stops the weekly digest for every app
  on this account").

## Phases

| # | PRD | Scope | Verifiable here |
|---|---|---|---|
| 1 | `phase-1-server-prefs.md` | schema + prefs API + digest/push gating + push unregister | fully (vitest) |
| 2 | `phase-2-unsubscribe.md` | signed unsubscribe token + RFC 8058 one-click + email headers/footer | fully (vitest) |
| 3 | `phase-3-web-settings.md` | **create** the web settings surface (`#/settings`) + controls | fully (vitest + CI e2e) |
| 4 | `phase-4-mobile-settings.md` | mobile Settings screen + sign-out token cleanup | fully (jest render) |

1→2 ordered (unsubscribe flips the Phase-1 pref). 3 and 4 independent, both on 1.

## Key integration points (verified by the plan review)

- **Digest gate:** `sendWeeklyDigests` loads the user row per app entry
  (`getUser` after a `getTier` read) — the `email_digest === 'off'` skip goes
  there, before the `hasOpenRun`/`getRankHistory` reads. N4: cache the user row
  per `user_id` in that loop — the prefs ride the same row, and today's code
  re-reads per app.
- **Push gate:** `notifyRunAwaitingApproval` — a slim `getPushRunReady(db,
  userId)` read (mirroring `getRankCadence`/`getOptOut`) BEFORE listing tokens.
  **Missing row / pre-migration → defaults ON (fail-open = today's behavior)**;
  this also keeps the existing push.spec fakes (whose `.first()` returns null)
  green (G4). No circular-import risk (push.ts already imports d1.ts; d1.ts
  imports nothing back — verified).
- **Unsubscribe URL origin (B1):** the cron has NO request to derive an origin
  from, and `DASHBOARD_ORIGIN` is the Pages frontend which does not serve API
  routes. Phase 2 adds an **`API_ORIGIN` env var** (wrangler.toml + `Env`);
  when unset the digest is sent WITHOUT footer link/headers (degrade, warn) —
  never a broken link.
- **Unsubscribe token:** `TokenKind = "magic" | "session"` extends with
  `"unsub"`; `verify` enforces the kind tag; payload carries the email. Same
  HMAC secret; audience separation tested both directions.
- **Email headers:** `EmailMessage` gains optional `headers`; both Brevo and
  Resend fetch bodies are hand-built JSON that accept a top-level headers
  object (verified) — Console sender logs them.
- **`/auth/me`** carries the prefs alongside `paused`/`rlhf_opt_out`/
  `rank_cadence` — in **both** branches (session AND demo, G7), and the
  `public/mock.js` demo backend's `/auth/me` is extended to match.

## API surface (final shape)

```
GET    /account/notifications          → { email_digest, push_run_ready }
POST   /account/notifications          { email_digest?, push_run_ready? } → new state
DELETE /account/push-token             { token } → { removed: boolean }   (own row only)
GET    /email/unsubscribe?token=…      → confirmation PAGE (no state change)
POST   /email/unsubscribe?token=…      → flips email_digest='off' (idempotent)
```

- `POST /account/notifications` is a partial update; unknown values → 400.
- `DELETE /account/push-token` deletes `WHERE token = ? AND user_id = ?`; not
  owned → `{removed:false}`, 200 (sign-out must be idempotent). DELETE routing
  precedent exists (`DELETE /apps/:id`) and CORS already allows DELETE.
- **Unsubscribe state change is POST-only** (scanner-prefetch safety). The
  handlers take the token from the **query string only** and must NOT use
  `readJson` — the RFC 8058 one-click POST and the confirm-form POST are
  `application/x-www-form-urlencoded`, which `readJson` would 400 (G1). Body is
  read leniently or ignored.
- Unsubscribe responses are HTML pages via a dedicated helper — NOT the `json()`
  helper (N2).

## Security / privacy invariants

- The unsub token is audience-separated, TTL **60 days** (a fresh token ships
  with every weekly digest; 180d was needless replay window — N3), and scoped to
  ONE action. Session/magic tokens fail as unsub tokens and vice versa (tested
  both directions).
- Email→user resolution in the unsubscribe flip must be **non-creating** (G2):
  a direct `UPDATE … WHERE email = ?` or a `getUserByEmail` — NEVER `upsertUser`,
  which would resurrect a deleted account. Deleted account → same success page,
  nothing flipped.
- The public pages leak nothing: invalid token → generic 400 page; a valid
  token's page shows only the email from the VERIFIED payload, HTML-escaped.
- No CORS machinery for the unsubscribe POSTs (N3): one-click is server-to-server
  and the confirm form is a same-origin navigation.

## Honesty invariants

- Digest off stops the EMAIL, not the sweep. Push off stops the NOTIFICATION,
  not the run. Settings + unsubscribe copy state this verbatim.
- The unsubscribe page says it silences the digest for EVERY app on the account
  (G8) — never a per-app implication the model can't honor.

## Rollout / migration (G3 — deploy order is load-bearing)

`USER_COLS` is an explicit column list: deploying a Worker that SELECTs the new
columns against an un-migrated DB fails every `getUser`/`requireUser` call —
app-wide, not just prefs. Therefore, pinned order:

1. Apply `ALTER TABLE users ADD COLUMN email_digest TEXT NOT NULL DEFAULT
   'weekly' …` + `push_run_ready INTEGER NOT NULL DEFAULT 1` (remote + local),
2. THEN deploy the Worker.

Same discipline as the `rank_cadence` migration; documented in schema.sql. The
`mapUserRow` null-coalescing covers NULL values and fake-D1 rows — it does NOT
excuse the deploy order.

## Success criteria

1. Digest off (web, mobile, or email) → no digest email; runs still open.
2. Push off server-side works without touching OS settings; sign-out removes
   the device registration (best-effort, never blocks sign-out).
3. The digest carries a working RFC 8058 one-click unsubscribe when `API_ORIGIN`
   is configured, and degrades cleanly when not.
4. Every gate tested in BOTH directions (suppressed when off, delivered when on).
