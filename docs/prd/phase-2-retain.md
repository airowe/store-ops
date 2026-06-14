# Phase 2 — Retain & Prove

**Goal:** the product keeps the users Phase 1 acquired, and starts generating its
own proof (real customer rank-deltas) so the marketing stops relying solely on
the Heathen self-case-study.

**Trigger to start:** you have paying users and a working weekly digest, and the
question shifts from "can we get users" to "do they stay."

## Scope

### Make the weekly digest excellent (not just present)
Phase 1 ships a digest that works; Phase 2 makes it the thing they'd miss.
- Trend visualization (a sparkline per tracked keyword) in the dashboard, linked
  from the digest.
- "Biggest mover of the week" framing — lead with the one number that matters.
- Smart cadence: don't email when nothing moved more than X; respect attention.

### Capture customer proof (instrument the wins)
- With consent, log anonymized rank-delta wins (term, before→after, days) so the
  landing can show "*real* movement across N apps," not one case study.
- A lightweight "share my win" path for users (their own rank graph, branded).

### Reduce involuntary churn
- Dunning for failed Stripe payments (the webhook already tracks status).
- A "your Autopilot is about to renew — here's what it did this month" touch.

### Onboarding polish (only what reduces drop-off)
- Make first-connect failures legible (bad bundle id, app not found, no reviews
  yet) — clear errors, not dead ends. *Measured by connect-success rate.*

## Acceptance criteria
- Week-4 retention is measurable and improving.
- The landing shows aggregate real-customer movement, not just Heathen.
- Failed-payment churn is recovered, not silent.

## NOT in Phase 2
- Multi-app/agency portfolio (Phase 3). New acquisition channels (Phase 3).
- Heavy analytics/BI. A/B testing infra. These come only if data demands them.
