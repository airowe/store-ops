# ShipASO — Product Roadmap (PRDs)

> Codebase name: `store-ops`. Product/brand: **ShipASO**. Live surfaces:
> shipaso.com (landing) · app.shipaso.com (dashboard) · api.shipaso.com (API).

The thesis, in one line: **an autonomous agent that optimizes your App Store /
Play listing, ships it, and proves the rank moved — you just approve.** The free
OSS plugin is the funnel; the hosted agent is the product.

## Operating principle

**Ship a working, no-fluff product that builds excitement — then layer.** Every
phase must leave a *usable, honest* thing in users' hands. We do not build the
fancy tier before the basic one converts. Bias all effort toward Phase 0 → 1.

## The phases at a glance

| Phase | Goal | Done when | Status |
|-------|------|-----------|--------|
| **0 — Funnel works** | The acquisition path doesn't leak | Install works, CTAs resolve, the flow runs end-to-end | ✅ mostly done |
| **1 — Launch-ready** | A no-fluff product people can pay for + a launch that earns the first 100 installs | Pricing on-site, retention email, Show HN shipped, first paying user | 🔜 next |
| **2 — Retain & prove** | The product keeps users + generates its own proof | Weekly "what moved" digest is great, real customer rank-deltas captured | later |
| **3 — Expand** | Multi-app / agency motion + breadth | Fleet tier earns its price, second acquisition channel works | later |
| **4 — Moat & scale** | Harden the data moat + operational scale | Resilient data sourcing, real auth/billing hardening done, ops runbook | later |

## PRD index

- [`phase-0-funnel.md`](./phase-0-funnel.md) — make the funnel not leak *(near done)*
- [`phase-1-launch.md`](./phase-1-launch.md) — **the focus**: ship + launch, no fluff
- [`phase-2-retain.md`](./phase-2-retain.md) — retention + self-generating proof
- [`phase-3-expand.md`](./phase-3-expand.md) — fleet/agency + second channel
- [`phase-4-moat.md`](./phase-4-moat.md) — data resilience + production hardening
- [`mcp-server.md`](./mcp-server.md) — hosted MCP server *(deferred; Phase-3 channel)*
- [`asc-findings/`](./asc-findings/00-overview.md) — turn the captured ASC data
  into scored, actionable audit findings (6-PRD suite: engine → run integration →
  run-page UI → dashboard/unlock → rule catalog)

## Competitive

- [`../competitive/appkittie.md`](../competitive/appkittie.md) — AppKittie read
  (intelligence platform; ASO is one feature). Their paid MCP motivates the
  deferred MCP-server plan above.

## What "no fluff" means here (the bar for Phase 0/1)

Include only what a paying indie dev needs to (a) get value in minutes and (b)
trust it. **Cut**: dashboards-of-dashboards, settings nobody asked for, AI chat
UIs, gamification, onboarding tours, anything that isn't on the path from
"install" to "rank moved, here's proof."

## How we measure (the only metrics that matter early)

1. **Plugin installs** (top of funnel)
2. **Hosted connects** (a connected app = an activated lead)
3. **Free → paid conversion** (the one that proves the model)
4. **Week-4 retention** (proves the recurring value is real, not lock-in)

Everything in these PRDs ladders to one of those four.
