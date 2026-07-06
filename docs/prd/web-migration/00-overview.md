# Web migration — scoping overview

> The web dashboard (`cloud/public/`) is a ~4,000-line hand-rolled vanilla-JS
> SPA. It works and is E2E-tested, but it's accruing **maintainability** debt
> (imperative DOM + hash routing + manual state) and **duplicates** every
> component the Expo app already has. This suite migrates it to **TanStack
> Start** — incrementally, route-by-route, honesty-model intact — while the Expo
> app stays on native. Full narrative: [`../../design/web-migration-plan.md`](../../design/web-migration-plan.md).

## The reframe: from two hand-built UIs to one shared spine

Consistency today is enforced *reactively* — `mobile/src/theme/tokens.test.ts`
fails CI if the ported palette drifts from `styles.css`. That's a smell: the two
surfaces re-implement everything and a test polices the seam. The migration
inverts it: extract a **shared spine** (design tokens, API client + types,
honesty helpers, chart geometry) that both surfaces *import*, then rebuild the
web UI on TanStack Start against that spine. Consistency becomes structural, not
policed.

## Why TanStack Start (not Expo Web)

| Factor | Expo Web (RNW) | **TanStack Start** ✅ |
|---|---|---|
| Reuse of the hand-tuned CSS design system | re-home in RN styles | keep as-is (web-native CSS) |
| SEO / first paint on public surfaces | needs Expo SDK 55/56 SSR (alpha/preview) | mature SSR today |
| Cloudflare fit (API is a Worker, dash is Pages) | static export | official Workers deploy target |
| Reuses TanStack Query + `mobile/src/api` | yes | yes |
| Web/native version coupling | one React/Expo build | web evolves independently |

We're on Expo SDK 51; Expo Web's good SSR/SEO needs 55/56 (alpha/preview). The
paired approach shares logic, not the render tree — the right trade for a lean,
Cloudflare-native, CSS-crafted, SEO-sensitive dashboard.

## The PRDs

| PRD | Scope | Risk | Ships value alone |
|-----|-------|------|-------------------|
| [`01-shared-spine.md`](./01-shared-spine.md) | tokens SoT + `@shipaso/api` + `@shipaso/honesty` (no UI rewrite) | low | **yes** |
| [`02-app-shell.md`](./02-app-shell.md) | TanStack Start app, edge routing, Query + auth, CSS port | med | shell only |
| [`03-settings-route.md`](./03-settings-route.md) | first route migrated (`/settings`) | low | yes |
| [`04-dashboard-route.md`](./04-dashboard-route.md) | app-card grid (`/`) | med | yes |
| [`05-app-detail-route.md`](./05-app-detail-route.md) | `/apps/:id` (audit, coverage, **chart**) | med | yes |
| [`06-war-room-route.md`](./06-war-room-route.md) | `/apps/:id/war-room` (reconcile divergence) | med | yes |
| [`07-run-money-screen.md`](./07-run-money-screen.md) | `/runs/:id` diff + **approval gate** | **high** | yes |
| [`08-charts.md`](./08-charts.md) | uPlot (web) / Victory-XL (native) system | med | yes |
| [`09-public-surfaces.md`](./09-public-surfaces.md) | preview / login / proof + landing | low | yes |

## Sequencing logic

**Spine first, honesty-critical last.** 01 (spine) unblocks everything and is
valuable even if the UI is never rebuilt. 02 stands up the shell. Then routes in
ascending risk: `/settings` (03, small) → `/` (04) → `/apps/:id` (05, proves the
chart layer with 08) → war room (06) → the **money screen** (07) last, once the
pattern is proven and its full E2E is ported. Public surfaces (09) are optional
and deferrable with no user-facing regression.

## Hard principles (carry from the rest of the product)

- **The honesty model is non-negotiable.** unseen ≠ empty ≠ zero; "approved ≠
  shipped"; unchecked = "—" never a guessed number; attribution is correlational.
  Every migrated route must pass the *existing* honesty E2E before traffic flips.
- **The API Worker is never touched.** Both frontends call the same REST API
  throughout; this is a frontend migration only.
- **Per-route reversibility.** Each route cuts over behind an edge rule and rolls
  back with one flip. No big-bang.
- **Playwright is the contract.** "Same behavior" is defined by the E2E suite,
  not by eyeballing.
- **No new product scope.** This is a re-platform, not a redesign. Feature
  changes (light mode, modern charts) ride along only where the plan already
  calls for them.

## Non-goals

- Rewriting or re-architecting the store-ops Worker API.
- Rendering the Expo app to web (Expo Web) — revisitable later for authed
  surfaces once SDK 55/56 SSR is stable; explicitly out of scope here.
- A visual redesign. Ports are pixel-faithful unless a PRD says otherwise.

## Next step

Ship **PRD 01** (shared spine). It's low-risk, independently useful (kills token
drift, unifies the API client, shares the honesty logic), and is the prerequisite
for every route PRD. Nothing else starts until the spine exists.
