# Launch-list broadcast tool — design

**Date:** 2026-07-16
**Status:** approved (design), pending implementation plan
**Surface:** `cloud/` (Cloudflare Worker + D1), `cloud/web/` (owner-only page), `packages/api`

## Problem

The landing page captures launch-list emails into the D1 `subscribers` table
(`POST /subscribe`), but there is **no way to send anything to that list** and no
way to even view it except raw SQL. The product has production-grade email infra
(`EmailSender`: Brevo preferred, Resend fallback) used for magic links + digests,
but nothing connects the list to it. This builds the missing broadcast tool.

## Constraints (discovered in the codebase)

- **Subscribers are not users.** `subscribers(id, email, source, created_at)` —
  no account, no `email_digest` pref. The existing user-based unsubscribe (flips
  `email_digest`) does not apply; the list needs its own suppression.
- **Reuse, don't reinvent:** `EmailSender.send({to,subject,html,text,headers})`,
  the `mintUnsubToken`/`verifyUnsubToken` HMAC pattern, and the `/email/unsubscribe`
  GET-confirm/POST-flip route shape.
- **Owner auth:** no admin-role system. Mirror the RLHF export's secret-token
  gate — a `BROADCAST_TOKEN` env var + `x-broadcast-token` header, **degrade
  closed** (403) when unset or mismatched.
- **Worker execution limits:** no Cloudflare Queue binding today. A large list
  cannot be sent in one request (CPU + subrequest caps). Send in the background
  via `ctx.waitUntil` in rate-limited chunks.
- **Compliance:** bulk email requires one-click `List-Unsubscribe` (RFC 8058) +
  suppression of unsubscribed addresses.

## Data model

Migration on `subscribers`:
- Add `unsubscribed_at TEXT` — null = active, timestamp = suppressed.

New `broadcasts` audit table:
```sql
CREATE TABLE IF NOT EXISTS broadcasts (
  id              TEXT PRIMARY KEY,               -- uuid
  subject         TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,               -- active subscribers at send time
  sender          TEXT,                           -- who triggered (for audit)
  sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Rationale: a send is a recorded event (audit + visibility into partial sends),
not fire-and-forget.

New `d1.ts` helpers:
- `activeSubscribers(db): Promise<{ email: string }[]>` — `WHERE unsubscribed_at IS NULL`.
- `subscriberCounts(db): Promise<{ active: number; unsubscribed: number }>`.
- `unsubscribeSubscriber(db, email): Promise<void>` — `UPDATE subscribers SET
  unsubscribed_at = datetime('now') WHERE email = ?` (non-creating, idempotent).
- `recordBroadcast(db, {subject, recipientCount, sender}): Promise<string>` — insert, return id.

## Unsubscribe flow

- New token audience `"list-unsub"` via the existing `mintUnsubToken`/`verifyUnsubToken`
  pattern — audience-separated so a list-unsub token can never verify as a
  session, digest-unsub, or magic-link token.
- Every broadcast email carries:
  - a `List-Unsubscribe` header (one-click, RFC 8058) + `List-Unsubscribe-Post`,
  - a visible footer link.
  Both point at the same token URL.
- Routes (mirror `/email/unsubscribe`):
  - `GET /list/unsubscribe?token=…` — confirm page, **never mutates**.
  - `POST /list/unsubscribe?token=…` — the flip → `unsubscribeSubscriber`. Idempotent.

## Owner auth

`requireBroadcastToken(req, env)`: compares `x-broadcast-token` to
`env.BROADCAST_TOKEN`. Unset or mismatch → `HttpError(403)`. Applied to every
`/broadcast/*` endpoint. (`/list/unsubscribe` is token-in-URL, public — like the
existing unsubscribe route.)

## Endpoints (all `/broadcast/*` owner-gated)

- `GET /broadcast/subscribers` → `{ active: N, unsubscribed: M }`. Counts only —
  never returns addresses to the browser.
- `POST /broadcast/test` `{ subject, markdown, to }` → renders + sends exactly
  **one** email to `to`. The mandatory preview.
- `POST /broadcast/send` `{ subject, markdown, confirm: true }`:
  1. Validate token + `confirm === true` (else 400).
  2. `recordBroadcast` audit row.
  3. Query `activeSubscribers`.
  4. Return `{ ok: true, queued: N }` **immediately**.
  5. `ctx.waitUntil`: send in chunks (CHUNK = 20) via `EmailSender.send`, each
     with its per-recipient `List-Unsubscribe` header + token; small delay
     between chunks. Per-email failure caught + logged; run continues.
     `log()` the sent-vs-total so a `ctx.waitUntil` truncation is visible.

## Content rendering

Author **markdown**; a small `renderBroadcast(subject, markdown)` →
`{ html, text }` for `EmailMessage`. Reuse an existing markdown converter if one
is present; else a minimal one (headings, links, paragraphs, lists). The same
renderer feeds the UI preview so preview == sent.

## UI — owner-only `/broadcast` page

Added to `edgeRoutes.OWNED_PATHS`. Reuses existing card/btn/txt styling.
- **Token gate:** paste `BROADCAST_TOKEN` (component state only — never
  persisted / never localStorage). All calls send it as `x-broadcast-token`.
  403 → "Not authorized" (no detail leak).
- **Compose:** subject input + markdown textarea + live rendered preview pane.
- **Recipient count:** "N active subscribers" from `GET /broadcast/subscribers`.
- **Two-step send:** "Send test to me" (→ `/broadcast/test`) enabled first; the
  real "Send to N subscribers" requires an explicit confirm checkbox
  ("I've previewed the test") + disables while pending.

## Data flow

Page → owner-gated endpoints → D1 (`subscribers`, `broadcasts`) + `EmailSender`.
The browser only ever receives counts + send results — never subscriber addresses.

## Error handling

- Owner token wrong/unset → 403 everywhere (degrade closed).
- Per-email send failure → caught, logged, run continues; audit row + returned
  count make partial sends visible.
- Empty subject / empty markdown → 400 before any send.
- Double-submit guard (disable send while pending).
- `ctx.waitUntil` truncation on a very large list → logged sent/total count;
  documented upgrade path to Cloudflare Queues.

## Testing

- **Pure units:** `renderBroadcast` (md → html+text); `list-unsub` token
  mint/verify round-trip + audience separation (rejects a session/digest token);
  `activeSubscribers` excludes `unsubscribed_at`-set rows.
- **Handler tests** (drive `handleApi` with mock `Env` + fake DB, per
  `authCallback.spec.ts`): 403 without token; `/broadcast/test` sends exactly
  one; `/broadcast/send` requires `confirm`, inserts audit row, skips suppressed
  rows; `/list/unsubscribe` GET never mutates, POST flips idempotently.
- **Component test:** token-gated render; preview matches renderer; send disabled
  until confirm.
- **No live email:** inject a fake `EmailSender` recording calls.

## Prerequisite: thread `ctx` into `handleApi`

The fetch handler currently discards the execution context
(`async fetch(request, env, _ctx) { return handleApi(request, env) }` in
`cloud/src/index.ts`), so `ctx.waitUntil` is **not reachable** in route handlers
today. The send engine needs it. First change: pass `ctx` through —
`handleApi(request, env, ctx)` — and thread it to `previewApp`-style handlers
that need background work (only `/broadcast/send` uses it). Every other handler
ignores the new arg, so this is additive and low-risk. A focused test asserts
`/broadcast/send` calls `ctx.waitUntil`.

## Files touched

- `cloud/src/index.ts` — pass `ctx` into `handleApi`.
- `cloud/src/api/index.ts` — `handleApi` signature takes `ctx`; thread to the send handler.
- `cloud/schema.sql` — `subscribers.unsubscribed_at`, `broadcasts` table (+ migration note).
- `cloud/src/d1.ts` — `activeSubscribers`, `subscriberCounts`, `unsubscribeSubscriber`, `recordBroadcast`.
- `cloud/src/auth.ts` — `list-unsub` token audience (extend mint/verify).
- `cloud/src/broadcast.ts` — **new**: `renderBroadcast`, the chunked send engine.
- `cloud/src/api/index.ts` — `requireBroadcastToken`; `/broadcast/*` + `/list/unsubscribe` routes.
- `packages/api` — client fns: `broadcastCounts`, `broadcastTest`, `broadcastSend` (all take the owner token).
- `cloud/web/src/features/broadcast/BroadcastView.tsx` — **new** page.
- `cloud/web/src/routes/*`, `router.tsx`, `shell/edgeRoutes.ts` — wire `/broadcast`.
- Tests colocated per file above.

## Out of scope (YAGNI)

No scheduling, drafts, segments, open/click tracking, Cloudflare Queue (upgrade
path documented), rich-text editor (markdown only), or multiple lists.
