# ShipASO marketing landing page — design

**Date:** 2026-07-15
**Status:** approved (design), pending implementation plan
**Surface:** `cloud/web` (TanStack Router + Vite web app)

## Problem

`/` currently renders the authed `DashboardView`. A cold visitor from an
acquisition campaign lands there logged-out and sees a thin "Sign in to see your
apps — or audit any listing first" screen. It is honest and functional, but it is
a *front door*, not a *value proposition*. As ShipASO pushes toward customer
acquisition (warm and cold traffic, mix uncertain), the root needs to work as a
real cold-traffic entry point without abandoning the product's defining
anti-hype voice.

## Goals

- A real marketing landing page at `/` that works for cold traffic.
- Lead with the product's actual value — a **live, inline listing audit** — not a
  described claim. The audit result is real data, shown on the page.
- Preserve the honest voice end-to-end: no inflated grades, no fake proof, no
  invented urgency or testimonials.
- Reuse the existing design system (tokens, `.card`, `.btn.primary`, `.stat`,
  motion tokens) — no parallel styling.
- Keep the try-before-signup funnel intact: signup gated at value, never a cold
  login wall.

## Non-goals (v1 — explicit YAGNI)

- No A/B testing harness, no analytics event instrumentation.
- No FAQ or feature-grid sections.
- No new design tokens or colors.
- No SEO/meta overhaul (can follow later).
- No auth-conditional redirect at `/` (see Routing).

## Routing

| Path | Before | After |
|---|---|---|
| `/` | authed `DashboardRoute` | public `LandingRoute` (everyone, unconditional) |
| `/dashboard` | — | `DashboardRoute` (unchanged internally) |

- `/` is a **pure public view for everyone** — no session check, no redirect.
  Signed-in users see the landing at `/` too and reach their dashboard by
  navigating (topbar logo/link, or a landing CTA).
- `edgeRoutes.ts` `OWNED_PATHS`: `/` is already owned; **add `/dashboard`** so the
  new UI serves it (strangler edge map).
- Topbar: logo and an auth-aware nav link point to `/dashboard` when signed in.

Rationale for unconditional `/` (not smart-redirect): one URL to point every ad
at, the landing route stays a pure public component with no auth branching, and
the dashboard has a stable canonical path.

## Shared audit refactor (improve-as-you-go)

Approach A: the hero contains the **actual audit**, not a link to it. To avoid
duplicating audit logic between the hero and `/preview`, extract the shared
widget:

- **New `features/public/ListingAudit.tsx`** — self-contained:
  - *What it does:* audit any listing on real data, render the honest result.
  - *How you use it:* `<ListingAudit client={client} onSignIn={() => …} />`.
  - *Depends on:* `preview()` from `@shipaso/api` only.
  - Owns its own state (query, candidates, result, note) via the `preview()`
    mutation — moved intact from `PreviewView`, including the 404-as-throw
    `onError` handling and the "clear stale note on new request" fix.
- **`PreviewView` becomes a thin wrapper:** its heading/subcopy + `<ListingAudit>`.
- **`LandingView` hero embeds the same `<ListingAudit>`.**
- One audit implementation, two mount points. All existing `data-testid`s
  (`preview-query`, `preview-search`, `preview-result`, `preview-grade`,
  `preview-note`, `pcand-*`, `preview-signin`, …) are preserved so dependent
  unit/E2E tests keep working through `ListingAudit`.

## Page content & layout

`LandingView` renders inside the existing shell (topbar + `.wrap` column). Four
sections, top to bottom:

1. **Hero** — value prop + live audit.
   - Headline (draft, not load-bearing): "Know exactly where your app ranks —
     then fix it."
   - Subhead (draft): "ShipASO audits your App Store listing on real keyword
     data, proposes the fix, and runs it — your credentials never leave your
     machine."
   - **Embedded `<ListingAudit>`** — the audit input is *in* the hero. Type an
     app → real grade, no signup. This is the primary CTA (audit-primary).
   - Secondary: quiet "Already have apps connected? **Sign in**" → `/login`.

2. **How it works** — 3 steps, plain language, `.card`/`.grid`:
   - **Audit** — see your real keyword ranks, no signup.
   - **Approve** — you decide; nothing auto-ships.
   - **Run** — the fix is pushed; credentials stay on your machine.

3. **Proof strip** — real aggregate wins from `getProof()`, **graceful empty
   state**. If measured data exists, show `.stat` tiles (total wins, best
   improvement, …). If thin/zero/401, show an honest line — "Connect an app to
   start measuring real wins" — never a fabricated number. Same posture as
   `/proof`.

4. **Close** — restate the trust line ("your credentials, your machine — nothing
   simulated") and repeat the audit + sign-in CTAs so a scrolled visitor need not
   scroll back up.

**Style:** pure reuse — `.card`, `.btn.primary`, `.grade`, `.stat`, `.muted`,
display/mono fonts, `--signal` accent, existing `@starting-style` +
`prefers-reduced-motion`. Looks native immediately.

**Voice:** declarative, anti-hype, concrete. No "10x", no fake urgency, no
invented testimonials.

## Data flow

- `LandingView` — public, renders for everyone, no auth required.
- `<ListingAudit>` — owns local state via the `preview()` mutation. No global
  state.
- Proof strip — `useQuery(["proof"], getProof)`. On a public page a logged-out
  visitor's `/proof` may 401, so **empty/error is the expected path**, rendered as
  the honest "connect an app" line, not an error.

## Error handling

- Audit failures: the existing `onError`/`fail` path (404-as-throw → surface the
  server's human-readable message) moves into `ListingAudit` unchanged.
- Proof failures: swallowed into the graceful empty state — never a red error on
  the acquisition surface.
- Invariant: nothing on this page can show a lie — no fabricated grade, no fake
  proof number, no infinite "loading".

## Testing

Matches repo convention (colocated `*.test.tsx` + Playwright E2E):

- **`ListingAudit.test.tsx`** — audit unit tests move here (renders result,
  no-match note, candidate pick). Existing `data-testid`s preserved.
- **`LandingView.test.tsx`** (new) — hero + CTAs render; proof strip shows stat
  tiles when data present and the honest empty line when proof errors/empty;
  sign-in link points to `/login`.
- **`edgeRoutes.test.ts`** — add: `/` → new UI; `/dashboard` → new UI (owned).
- **E2E** — extend the happy-path spec (gated by #212): `/` renders the landing
  hero + audit input, an inline audit returns a real grade, and the dashboard is
  reachable at `/dashboard`. This acquisition path should be gated.

## Files touched

- `cloud/web/src/router.tsx` — landing at `/`, dashboard at `/dashboard`.
- `cloud/web/src/shell/edgeRoutes.ts` — add `/dashboard` to `OWNED_PATHS`.
- `cloud/web/src/features/public/LandingView.tsx` — **new**.
- `cloud/web/src/features/public/ListingAudit.tsx` — **new** (extracted).
- `cloud/web/src/features/public/PreviewView.tsx` — thin wrapper over `ListingAudit`.
- `cloud/web/src/shell/Topbar.tsx` — auth-aware dashboard link.
- `cloud/web/src/app.css` — minor landing layout (reusing tokens; no new system).
- Tests: `LandingView.test.tsx`, `ListingAudit.test.tsx`, `edgeRoutes.test.ts`,
  the web E2E spec.
