# Phase 0 — Make the Funnel Not Leak

**Goal:** the acquisition path works end-to-end with zero dead links. A stranger
can go discover → install → run → connect → see value without hitting a wall.

**Why first:** a broken funnel makes every other investment worthless. This is
plumbing, not product. Get it airtight, then move on.

## Problem (what was broken)

- `/plugin marketplace add airowe/app-marketplace` → repo didn't exist.
- Landing "Get the free plugin" → 404 repo.
- Landing "Try the hosted agent" → old `store-ops-dashboard.pages.dev` URL.
- `aso-offstore-mine` skill shipped but wasn't registered in `plugin.json`.
- README open-core table mis-stated the app limits (said "unlimited"; code
  gates 1/3/50).

## Scope (what Phase 0 covers)

### Done ✅
- [x] `.claude-plugin/marketplace.json` so `/plugin marketplace add airowe/store-ops` resolves.
- [x] README install fixed: `add airowe/store-ops` → `install store-ops@store-ops`.
- [x] Register `aso-offstore-mine` in `plugin.json` (24 skills).
- [x] Repoint all CTAs/URLs: → `app.shipaso.com`, → `github.com/airowe/store-ops`.
- [x] README open-core table corrected to the code-enforced gates + autonomy line.
- [x] One honest hosted nudge in the `store-ops` router output.
- [x] Landing redeployed; CTAs verified live.
- [x] Domains live: shipaso.com, app.shipaso.com, api.shipaso.com (HTTPS, CORS,
      cross-subdomain session cookie).

### Remaining (close Phase 0)
- [ ] **End-to-end install smoke test** by a fresh user (or a clean machine):
      run the exact `/plugin marketplace add` + `/plugin install` and confirm the
      skills load and `/store-ops <app>` runs. *(We fixed the manifest; we have
      not yet observed a real install succeed.)*
- [ ] **Dashboard connect smoke test** from `app.shipaso.com` against
      `api.shipaso.com` in a real browser (magic-link login → connect → run →
      approve), confirming the cross-origin cookie actually rides.
- [ ] **404 / dead-link sweep** of the live landing (every href returns 2xx).
- [ ] **Repo README is launch-grade** (it's the most-viewed page): the Heathen
      case study above the fold, a GIF/asciinema of a real run, the loop diagram,
      one hosted CTA at the bottom.

## Acceptance criteria

A person who has never seen this can, in under 10 minutes and with no help:
1. Install the plugin from the marketplace and run `/store-ops <their app>`.
2. See real rank/audit data about *their own* app.
3. Find their way to `app.shipaso.com` and connect an app (login works, the run
   completes, the approval gate behaves).

## Explicitly NOT in Phase 0

Pricing UX, email capture, the launch itself, any new feature. Phase 0 is
"the existing thing is reachable and works." Nothing more.

## Risks

- The plugin-install path is fixed in config but **unverified by a real install**
  — verify before relying on it for the launch.
- Cloudflare Pages serves the *production* deployment on the custom domain; a
  `wrangler pages deploy` without `--branch main` lands on a preview alias and
  won't update the live site. (Hit this once; documented.)
