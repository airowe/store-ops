# PRD 06 — Native macOS / iOS companion surfaces

**Status:** Proposed
**Priority:** P3 (large; post-launch; validate demand first)
**Closes gap:** Appeeky ships a native macOS desktop app (local-first, built-in
terminal) + an iPhone app with Home Screen widgets (MRR/downloads/revenue). We're
web-only.

---

## Problem

Appeeky meets developers on their desktop and their phone; we live in a browser
tab. Their widgets put MRR/downloads/revenue on the Home Screen — ambient,
glanceable. This is a surface/breadth gap. Per the positioning doc, breadth is
their game — so this is explicitly a **post-launch, demand-validated** expansion,
not an early bet.

## Goals (if pursued)

1. A lightweight native companion (start with the cheaper of the two):
   - **macOS menu-bar / desktop app**, or
   - **iOS app with Home Screen widgets** showing the user's audit grade, rank
     movement, and pending approvals.
2. Reuse the existing Worker API as the backend — the native app is a thin client,
   not a re-implementation.
3. Surface the **proof loop** natively: "your push moved keyword X from #18 → #9"
   as a glanceable widget is a *wedge-aligned* native feature (vs Appeeky's
   advice/metrics widgets).

## Non-goals

- Not re-implementing the engine natively — all ASO logic stays in the Worker.
- Not a local-first terminal app (Appeeky's macOS angle) — out of scope; our value
  is the cloud loop, not local tooling.
- No store-push from the native app (human-gated, same as everywhere).

## Proposed design

- Native client (SwiftUI for iOS+macOS via a shared target) talking to the
  existing authed API + a small widget-data endpoint returning the glanceable
  numbers (grade, latest rank delta, pending-approval count).
- Auth: device sign-in against the existing session model; fail-closed.
- Widget content is **honest**: shows real rank deltas and honest nulls/zeros (no
  fabricated "trending up"), consistent with the dashboard.

## Success criteria

- A user can glance at a widget and see their real audit grade + latest *measured*
  rank movement, with the same honesty discipline as the web app.
- The native app adds **zero** ASO logic — pure API client.

## Open questions

- macOS first (closer to the dev's workflow) or iOS widgets first (the ambient
  hook Appeeky leans on)?
- App Store review overhead + maintenance cost vs. a responsive PWA that gets 80%
  of the value for a fraction of the cost. **Seriously consider a PWA before a
  native app.**

## Rough size

**L** (native) / **M** (PWA alternative). Recommend pricing the PWA path first.
