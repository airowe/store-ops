# Phase 2 — Digest unsubscribe PRD (comms-prefs)

Parent: `00-implementation-plan.md`. Depends on: Phase 1 (`email_digest` pref).
**Deliverability-critical** — this is the compliance phase.

## Objective

A working, compliant unsubscribe on the weekly digest: a footer link everyone
can click, and the RFC 8058 `List-Unsubscribe(-Post)` headers mailbox providers
use for their native "Unsubscribe" button. One click → `email_digest='off'`.

## Scope

- **In:** `"unsub"` token kind (mint/verify); `GET /email/unsubscribe` (confirm
  page — NO state change) + `POST /email/unsubscribe` (the flip, idempotent);
  per-recipient footer link in the digest; `EmailMessage.headers` +
  `List-Unsubscribe`/`List-Unsubscribe-Post` wiring in Brevo/Resend senders.
- **Out:** unsubscribe for any other email (magic links are transactional);
  re-subscribe flows beyond the settings UI; preference-center pages.

## Files

- `cloud/src/auth.ts` — `TokenKind` + `"unsub"`, `mintUnsubToken(secret, email,
  {ttlSeconds})` / `verifyUnsubToken` (mirrors magic/session wrappers)
- `cloud/src/api/index.ts` — public GET/POST `/email/unsubscribe` (before
  requireUser, like `/auth/*`), tiny HTML page helpers (inline, no assets)
- `cloud/src/digest.ts` — footer link rendered into html + text (per-recipient
  URL passed via `DigestAppInput`/plan opts)
- `cloud/src/cron/scheduled.ts` — mint the token per recipient in
  `sendWeeklyDigests`, pass link + headers
- `cloud/src/auth.ts` senders + `EmailMessage` — optional `headers`
  (Brevo: `headers` field; Resend: `headers` field; Console: log them)
- specs: `cloud/src/api/unsubscribe.spec.ts`, extend `cloud/src/auth.spec.ts`
  (audience separation), extend the digest/scheduled specs (footer + headers)

## Contracts

- Token: HMAC-signed, audience `"unsub"`, payload = email, TTL **180 days**
  (a digest older than that shouldn't carry a live credential; a fresh token
  ships with every digest anyway).
- `GET /email/unsubscribe?token=…` → 200 HTML page: "Stop the weekly digest for
  <email>?" + a form button POSTing the same URL. **Never mutates** — link
  prefetchers/scanners follow GETs and must not silently unsubscribe anyone.
  Invalid/expired token → generic 400 page (no enumeration; no echo of the token).
- `POST /email/unsubscribe?token=…` → flips `email_digest='off'` for the token's
  user, 200 confirmation page ("Weekly digest off. ShipASO keeps working — runs
  still open; turn it back on in Settings."). Idempotent: already-off → same 200.
  Also accepts the RFC 8058 body (`List-Unsubscribe=One-Click`) — same behavior.
- Headers on every digest email:
  `List-Unsubscribe: <https://api…/email/unsubscribe?token=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Unknown user for a VALID token (deleted account): same generic success page —
  nothing to leak, nothing to flip.

## Security invariants (tested)

- A session token or magic token in the `token` param → 400 (audience split,
  both directions — an unsub token must also never pass `verifySessionToken`
  or `verifyMagicToken`).
- The flip touches ONLY `email_digest` — an unsub token can never pause the
  agent, change cadence, or authenticate any other route.
- The confirmation pages set no cookies and echo no attacker-controlled strings
  (the email shown comes from the VERIFIED token payload, HTML-escaped).

## Acceptance criteria

- Digest html AND text carry the footer link; headers present on the message.
- GET renders the confirm page and changes nothing (pref still `weekly` after).
- POST (button) and POST (One-Click body) both flip to `off`; second POST → 200.
- After unsubscribing, the next `sendWeeklyDigests` pass skips that user
  (integration assertion tying Phase 2 to Phase 1's gate).
- Bad/expired/foreign-audience token → generic 400 page, no state change.

## Definition of done

A digest email carries a compliant, tested unsubscribe path end to end; suite
green; tsc clean.
