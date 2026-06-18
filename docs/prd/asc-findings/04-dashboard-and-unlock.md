# PRD 04 — Dashboard badge + ASC unlock CTA

> The funnel/upsell polish: hint value before a run is opened, and make
> connecting ASC feel like a reward. Depends on PRD 02 + 03.

## 1. Dashboard app-card finding badge
On each app card in the dashboard list (`public/app.js`, the app-card render),
show a small badge derived from the latest run's `findingsSummary`:
- "3 fixes available" (or "1 critical · 2 warnings" if any critical),
- green "Looking good" when zero actionable findings,
- nothing/neutral when the app has no run yet.
This lets the list view advertise value before the user opens a run — pulls them
into the audit.

Data: the app-list endpoint already returns a per-app run summary
(`rankSummary`/latest run). Add `findingsSummary` to that summary (small; counts
only) so the card can render the badge without fetching each run.

## 2. ASC unlock CTA (the reward framing)
On a **no-key run's** audit card (PRD 03), below the thin findings, render a CTA
built from the `asc_unlock` finding (PRD 01):
- Headline: "Unlock your full audit" / "Connect App Store Connect to see
  screenshots, preview video, privacy policy, category, and localization gaps."
- Lists (statically) the surfaces a key unlocks, so the user knows what they're
  missing.
- The CTA expands the existing ASC run panel (or scrolls to it) — reuse the
  primary ASC run flow (#31); don't build a new credential surface.

This makes the ASC connection feel like unlocking value, not a chore — and it's an
honest, in-context upsell toward the hosted/autopilot product.

## 3. (Optional, flag-gated) preview teaser
The logged-out `/preview` could mention "connect ASC after signup for the full
audit" — only if it doesn't clutter the funnel. Defer unless trivial.

## TDD (E2E)
- An app with a findings-bearing latest run shows the count badge on its dashboard
  card; a clean app shows "Looking good".
- A no-key run's audit card shows the unlock CTA; clicking it surfaces the ASC run
  panel.

## Acceptance
- Dashboard cards advertise findings; the no-key path has a clear, rewarding
  unlock CTA wired to the existing ASC flow.
- E2E green.

## Out of scope
- Billing/checkout changes. The CTA points at the ASC run flow, not a paywall.
