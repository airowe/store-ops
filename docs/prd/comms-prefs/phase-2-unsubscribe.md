# Phase 2 — Digest unsubscribe PRD (comms-prefs) — v2

Parent: `00-implementation-plan.md`. Depends on: Phase 1 (`email_digest` pref).
**Deliverability-critical** — this is the compliance phase.

## Objective

A working, compliant unsubscribe on the weekly digest: a footer link everyone
can click, and the RFC 8058 `List-Unsubscribe(-Post)` headers mailbox providers
use for their native button. One click → `email_digest='off'` — which, because
the digest fans out per app, silences the digest for EVERY app on the account
(G8; the copy says so).

## Scope

- **In:** `API_ORIGIN` env var (B1); `"unsub"` token kind; `GET
  /email/unsubscribe` (confirm page — NO state change) + `POST` (the flip,
  idempotent); per-RECIPIENT footer link + headers on the digest;
  `EmailMessage.headers` wired through Brevo/Resend/Console; non-creating
  email→user flip helper (G2).
- **Out:** unsubscribe for transactional email (magic links); preference-center
  pages; re-subscribe beyond the settings UI.

## Files

- `cloud/wrangler.toml` + `cloud/src/index.ts` (`Env`) — **`API_ORIGIN`** (B1):
  the public base of the API worker (e.g. `https://api.shipaso.com`). The cron
  has no request to derive an origin from, and `DASHBOARD_ORIGIN` is the Pages
  frontend which does not serve API routes. **Unset → the digest sends WITHOUT
  footer link/headers** (console warn) — degrade, never a broken link.
- `cloud/src/auth.ts` — `TokenKind` + `"unsub"`; `mintUnsubToken` /
  `verifyUnsubToken` (payload carries the email, like magic tokens); TTL **60
  days** (a fresh token ships weekly — N3). `EmailMessage.headers?:
  Record<string,string>`; Brevo + Resend senders pass headers through their
  (hand-built JSON) request bodies; Console logs them.
- `cloud/src/api/index.ts` — public GET/POST `/email/unsubscribe` (in the
  public block before `requireUser`, like `/auth/*`); an **HTML response
  helper** (N2 — the router's `json()` is wrong for pages); handlers take the
  token from the **query string only** and NEVER call `readJson` (G1 — the
  one-click POST and the confirm-form POST are form-encoded, which `readJson`
  would 400; body is ignored).
- `cloud/src/d1.ts` — **`setEmailDigestByEmail(db, email, 'off')` as a direct
  `UPDATE users SET email_digest='off' WHERE email = ?`** (G2). NEVER
  `upsertUser` — it get-or-CREATES and would resurrect a deleted account.
  0 rows changed (deleted account) → same success page, nothing to leak.
- `cloud/src/digest.ts` — footer link in html + text; the unsubscribe URL rides
  the plan inputs (minting is async `crypto.subtle`, so it CANNOT happen inside
  pure/sync `planDigests` — G8).
- `cloud/src/cron/scheduled.ts` — mint **once per unique email** (dedupe — G8:
  a 3-app user gets 3 messages that share one token), attach URL + headers.
- specs: `cloud/src/api/unsubscribe.spec.ts`, `cloud/src/auth.spec.ts`
  (audience separation both directions), digest/scheduled spec (footer, headers,
  deduped minting, API_ORIGIN-unset degrade).

## Contracts

- Token: HMAC-signed, audience `"unsub"`, payload = email, TTL 60d.
- `GET /email/unsubscribe?token=…` → 200 HTML: "Stop the weekly digest for
  <email>? This silences the digest for every app on this account. ShipASO
  keeps working — runs still open." + a form button POSTing the same URL.
  **Never mutates** (scanner-prefetch safety). Invalid/expired/foreign-audience
  token → generic 400 page (no enumeration, token never echoed).
- `POST /email/unsubscribe?token=…` → flips via the non-creating helper, 200
  confirmation page (re-enable pointer to Settings). Idempotent. Accepts the
  RFC 8058 body (`List-Unsubscribe=One-Click`) AND the empty confirm-form body
  identically (both form-encoded; both ignored).
- Headers on every digest email (only when `API_ORIGIN` set):
  `List-Unsubscribe: <{API_ORIGIN}/email/unsubscribe?token=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- No CORS work: one-click is server-to-server; the confirm form is a
  same-origin navigation (N3).

## Security invariants (tested)

- Audience separation BOTH directions: session/magic tokens fail as unsub
  tokens; an unsub token fails `verifySessionToken` AND `verifyMagicToken`.
- The flip touches ONLY `email_digest`. An unsub token authenticates nothing
  else.
- Pages set no cookies; the only reflected string is the verified token's
  email, HTML-escaped.

## Acceptance criteria

- Digest html AND text carry the footer link; headers present; one token per
  unique email across a multi-app user's messages.
- GET renders the confirm page and changes nothing (pref still `weekly` after).
- POST (form) and POST (One-Click body) both flip to `off`; repeat POST → 200.
- After the flip, the next `sendWeeklyDigests` pass skips that user end to end.
- `API_ORIGIN` unset → digest still sends, no footer/headers, a console warn.
- Deleted-account token → success page, no row created (assert row count).

## Definition of done

A digest email carries a compliant, tested unsubscribe path end to end; suite
green; tsc clean.
