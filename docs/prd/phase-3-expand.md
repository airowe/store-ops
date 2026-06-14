# Phase 3 — Expand (Fleet + Second Channel)

**Goal:** earn the Fleet tier's price for multi-app devs and agencies, and prove
a second acquisition channel beyond the launch spike + the plugin.

**Trigger to start:** Autopilot retains, and you're seeing multi-app users hit
the 3-app limit (the natural Fleet pull) — demand-led, not built-on-spec.

## Scope

### Fleet tier earns its keep ($149/mo, 50 apps)
- Portfolio view: all connected apps, their grades, and pending approvals in one
  place (the cron already runs across all of them).
- Bulk approve / per-app digest roll-up.
- Multi-locale runs surfaced cleanly (the engine supports locales; the UI
  doesn't expose the portfolio of them yet).
- Per-client grouping for agencies (an agency manages app sets per client).

### A second acquisition channel
The plugin + launch is channel #1. Validate one more, demand-led:
- **Content/SEO** — the free rank-check is link-bait. Publish the searches your
  buyer makes ("App Store Connect keyword field character limit," "check your
  app's organic rank free"), each ending in the tool.
- **OR** a Claude Code plugin-directory / "awesome-list" presence push.
- Pick one, instrument it, only scale what converts.

### Pricing experiments (now that there's volume)
- The A/B test infra exists conceptually in OFFER.md's MRR story; only build it
  when there are enough conversions to read a result.

## Acceptance criteria
- A multi-app dev / agency pays for Fleet and uses the portfolio.
- One non-launch channel produces installs at a sane cost.

## NOT in Phase 3
- Full production-grade auth/billing hardening (Phase 4) unless a real customer
  blocks on it. Enterprise/SSO. White-label. These are far-future.
