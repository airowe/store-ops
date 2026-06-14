# Phase 4 — Moat & Scale

**Goal:** harden the data-sourcing moat and the operational/production posture so
the product is resilient at scale. This is the "don't get caught flat-footed"
phase — most of it is insurance, sequenced only as real scale demands it.

**Trigger to start:** real revenue and enough users that an outage or a data-
source break is a business event, not a side-project hiccup.

## Scope

### Data-source resilience (the actual moat)
The whole free-rank-check value rides on the public iTunes Search API. We already
hit Apple's 403 from Cloudflare egress and solved it with TinyFish. Phase 4:
- Multi-source / fallback for rank + competitor data (TinyFish + direct + a
  second proxy), with health checks and alerts when a source degrades.
- Cache + rate-limit discipline so we never hammer Apple/Google.
- A documented playbook for "Apple changed the endpoint" (it's a when, not an if).

### Production hardening of auth + billing
Launch-acceptable today (test-mode Stripe, magic-link, APP_ENV=demo header
fallback). For scale:
- Flip `APP_ENV` to production (disable the X-User-Email demo fallback;
  require real session cookies) — and verify nothing depends on the stub.
- Stripe live mode + real products/prices + verified webhook in production.
- Rotate all setup-time keys; secret hygiene review.
- Real email vendor on the brand domain (`login@shipaso.com` once shipaso.com is
  verified in the email provider).
- Rate limiting / abuse protection on the public API endpoints.

### Operational scale
- Observability: error tracking, the cron's per-run report surfaced (it already
  produces a `CronReport`), alerting on failed sweeps.
- D1 growth plan (snapshots accumulate weekly per app — retention/rollup policy).
- A runbook: deploy, rollback, incident response.

## Acceptance criteria
- A single data-source failure degrades gracefully, with an alert, not an outage.
- Production auth/billing is real (no demo fallbacks in the paid path), keys
  rotated, secrets clean.
- There's a runbook and basic observability; a failed cron pings a human.

## NOT in Phase 4
- Anything user-facing that isn't forced by scale. This phase is plumbing and
  insurance; it should be invisible to users when done right.
