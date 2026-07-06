# Web migration plan — vanilla dashboard → TanStack Start

_Status: **proposal**. No code committed against it yet. Companion to
[`ui-review.md`](./ui-review.md)._

## Why

The web dashboard (`cloud/public/`) is a ~4,000-line hand-rolled vanilla-JS SPA
(`app.js`) with a hand-crafted CSS design system. It works, it's E2E-tested, and
it encodes a subtle **honesty model** (unseen ≠ empty ≠ zero, "as of"
provenance, never fabricate a rank). The costs it's accruing are **web
maintainability** (manual DOM + hash routing + imperative state) and
**cross-surface duplication** (every component re-implemented vs. the Expo app).

The goal is consistency + maintainability **without** a big-bang rewrite of an
honesty-critical surface.

## Decision: TanStack Start for web, keep Expo for native

Two "rewrite in React" targets were evaluated (see `ui-review.md` §charts thread
for the long form):

| Factor | Expo Web (react-native-web) | **TanStack Start** ✅ |
|---|---|---|
| Literal component reuse with native | ✅ one render tree | ⚠️ tokens/data/logic, not components |
| Keep the hand-tuned CSS design system | ❌ re-home in RN styles | ✅ as-is (web-native CSS) |
| SEO / first paint on public surfaces | ⚠️ needs Expo SDK 55/56 SSR (alpha/preview) | ✅ mature SSR today |
| Cloudflare fit (API is a Worker, dash is Pages) | ⚠️ static export | ✅ official Workers deploy target |
| Reuses existing TanStack Query + `mobile/src/api` | ✅ | ✅ |
| Web/native version coupling | ❌ locked to one React/Expo build | ✅ web evolves independently |

We're on **Expo SDK 51 / RN 0.74 / React 18**; Expo Web's good SSR/SEO story
needs SDK 55/56 (alpha/preview). TanStack Start is RC, API-stable, and deploys
first-class to Cloudflare Workers — matching what this codebase already is.
**Consistency comes from a shared spine (tokens + types + API client + honesty
helpers + Query), not a shared render tree.**

## Architecture during migration (strangler)

```
                        ┌────────────────────────────────────────────┐
   app.shipaso.com ───► │  edge router (Worker route / proxy)         │
                        │   • migrated paths  → TanStack Start Worker  │
                        │   • everything else → legacy Pages (app.js)  │
                        └────────────────────────────────────────────┘
                                   │                        │
                        TanStack Start (Vite)        cloud/public/app.js
                                   │                        │
                                   └──────► same store-ops Worker API ◄──┘
                                          (UNCHANGED throughout)
```

- The **API Worker is never touched** — both frontends call the same REST API.
- Legacy is **hash-routed** (`#/apps/:id`); the new app is **path-routed**
  (`/apps/:id`). Distinct URL shapes let the two coexist cleanly; moving to real
  paths is itself an SEO/shareability win.
- Cutover is **per route**: flip that path's edge rule to the new Worker; roll
  back by flipping it back. No global switch.

## Route & view inventory (pulled from `app.js`)

The `route()` dispatcher + `view*` renderers, mapped to the Expo screens and
flagged for risk. "Honesty-critical" = renders states governed by the
never-fabricate rules and guarded by dedicated E2E.

| Web route / view (`app.js`) | Renders | Mobile equivalent | Honesty-critical | Risk |
|---|---|---|---|---|
| `viewSettings()` → `#/settings` | comms prefs, rank cadence, stored keys, sign-out | `(app)/settings` | no | **low** |
| `viewDashboard()` → `#/` | app-card grid, finding-count badges, lead rank, "run now" | `(app)/index` | partial (unmeasured rank = "—") | **med** |
| `viewApp(id, query)` → `#/apps/:id` | identity, **rank sparkline** + `#62` annotations, listing audit (findings/grade), **coverage gauge**, screenshot gallery/levers, opportunities, keyword table, localization | `(app)/apps/[id]` | **yes** (unseen/empty/zero, audit grades) | **med-high** |
| `viewRun(id)` → `#/runs/:id` | **the money screen**: PR-style diff (current→proposed), editable proposal, char budgets, **approval gate** (irreversible push), fastlane handoff, raw cmds, **war-room card**, competitors, Play audit | `(app)/runs/[id]` (+ `(app)/war-room/[id]`) | **yes, maximal** (approval semantics, "approved ≠ shipped") | **high** |
| `warRoomCard()` (inside `viewRun`) | head-to-head grid, competitor selector, trend pulses | `(app)/war-room/[id]` (separate route) | **yes** (unchecked = "—", no fabricated count-up) | med |
| `previewView()` (logged-out, live API) | try-before-signup search + preview audit | `(public)` preview | no | low |
| `loginView()` | magic-link sign-in | `(public)` login | no | low |

**Divergence to reconcile:** war room is an embedded card on the web **run**
view but a standalone **route** on mobile. The shared route tree should pick one
convention (recommend the mobile split: `/apps/:id/war-room`) so both surfaces
navigate the same way.

## Phases

### Phase 0 — Extract the shared spine (no UI rewrite; reversible; valuable alone)
1. **Token source of truth** — one JSON/TS generating both the web CSS custom
   properties and the RN tokens. Kills palette drift permanently (today enforced
   reactively by `tokens.test.ts`) and is where light mode lives for both.
2. **`@shipaso/api`** — lift `mobile/src/api` + `types/api.ts` (already clean TS)
   into a shared package; the web stops hand-rolling `fetch` in `app.js`.
3. **`@shipaso/honesty`** — pure helpers: `formatRank`, delta/direction logic,
   coverage rules, `buildSparkGeometry`. Shared → both surfaces enforce
   *identical* honesty invariants. Highest correctness value.

### Phase 1 — Shell
- TanStack Start app deployed as a new Cloudflare Worker behind the same domain;
  edge rule serves migrated paths, proxies the rest to legacy.
- Wire TanStack Query + the shared `@shipaso/api` client + the token CSS.
- Port the design-system CSS verbatim (it's already framework-agnostic).

### Phase 2 — Migrate route-by-route (low-risk → honesty-critical last)

| # | Route | Rationale | Risk |
|---|---|---|---|
| 1 | `/settings` | small; proves auth + forms + shell + theme toggle end-to-end | low |
| 2 | `/` dashboard | proves data layer + cards + finding badges | med |
| 3 | `/apps/:id` | proves the **chart** foundation (uPlot sparkline, coverage gauge) | med |
| 4 | `/apps/:id/war-room` | reconcile the route divergence; multi-series chart | med |
| 5 | `/runs/:id` (money screen) | approval + irreversible-push gating; **last**, pattern proven, max E2E | high |
| 6 | preview / login / proof | keep lean static HTML **or** move into Start SSR | low |

### Phase 3 — Charts
- Web charts land on **uPlot** (Canvas 2D, <50KB, framework-agnostic) fed by the
  shared `buildSparkGeometry`; native stays on **Victory Native XL** (Skia). The
  paired stack keeps the dashboard lean while giving native GPU performance.

### Phase 4 — Public surfaces
- Decide whether preview/login/proof (and `docs/landing`) stay as hand-tuned
  static HTML (best first paint) or move into Start's SSR (good at this, unifies
  the codebase). Lowest priority; no user-facing regression risk if deferred.

## Guardrails — Playwright is the contract
The existing E2E suites (`cloud/tests/e2e/`) pin the honesty model
(`--bad` critical treatment, "unchecked stays `—`", "no fabricated count-up",
"as of" provenance, "approved ≠ shipped"). For **each** route: point its E2E at
the new implementation and get it green **before** flipping that path's traffic.
The suite is the definition of "behaves the same," especially for routes 3–5.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Honesty-model regressions on the money screen | Migrate it **last**; port its full E2E first; keep the legacy route one edge-flip away |
| TanStack Start is RC (not 1.0) | API is stable; pin versions; the spine (Phase 0) is framework-agnostic and survives a pivot |
| Losing the "no build step" property | Accepted, scoped trade for maintainability; Cloudflare Vite plugin keeps deploy one command |
| Scope creep into a big-bang | Phase 0 ships value with zero UI rewrite; every Phase-2 route is independently shippable/reversible |
| Landing page drifts from the app design | Token source of truth (Phase 0) feeds both; move landing in Phase 4 if desired |

## Rollback
Per route: revert the edge rule to legacy `app.js`. Phase 0 packages are additive
and independently useful even if the UI migration is paused indefinitely.

## Open decisions (need a human call)
1. War-room convention: embedded card vs. standalone route (recommend standalone,
   matching mobile).
2. Public surfaces: keep static HTML vs. fold into Start SSR.
3. Whether to also render the Expo app to web later (Expo Web) for the *authed*
   surfaces once SDK 55/56 SSR is stable — not mutually exclusive with this plan.
