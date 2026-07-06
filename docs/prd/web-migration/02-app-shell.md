# PRD 02 — App shell (TanStack Start + edge coexistence)

> Stand up the TanStack Start application, its Cloudflare Worker deploy, the
> edge-routing that lets it coexist with the legacy `app.js`, and the
> cross-cutting concerns every route needs: auth/session, the TanStack Query
> provider, the ported design-system CSS, and the theme toggle. No user-facing
> route is migrated yet — this is the frame the route PRDs slot into.

## The move
Create `cloud/web/` — a TanStack Start app (Vite) deployed as a Cloudflare
Worker behind `app.shipaso.com`. An edge rule serves migrated **paths** from the
new Worker and proxies everything else to the legacy Pages `app.js`. Real path
routing (`/apps/:id`) replaces hash routing (`#/apps/:id`).

## Deliverables
- `cloud/web/` TanStack Start scaffold (`@cloudflare/vite-plugin`), deploy target
  = Cloudflare Workers, wired to the same `api.shipaso.com` via `@shipaso/api`.
- **Edge router**: a Worker (or Pages `_routes.json` + Worker) that maps
  known-migrated paths → new app, all else → legacy. Config-driven so cutover is
  a one-line change per route.
- **Auth/session**: port the cookie-session flow (`/auth/me`, `/auth/request`,
  `/auth/logout`) and the demo `X-User-Email` stub (local/demo only) into a
  root loader + `useAuth`-equivalent. Header state parity with `headerState()`
  (`signedIn` / `signIn` / `demoStub`) — reuse the existing spec
  (`scripts/headerState.mjs`).
- **Query provider**: `QueryClientProvider` at the root (same `@tanstack/react-query`
  the app already ships), defaults mirrored from `mobile/app/_layout.tsx`
  (`retry: 1`, `staleTime`).
- **Design system**: import `@shipaso/tokens` CSS + the ported `styles.css`; the
  topbar (logo, env pill, theme toggle, "acting as"/auth controls) as a shared
  layout.
- **Freshness/deploy**: replace the bespoke `startFreshnessChecks()` hashed-bundle
  nudge with Start's native asset versioning.

## UI
- Pixel-faithful topbar + `.wrap` content column. Theme toggle persists to the
  shared `store-ops:theme` key (parity with the current web + mobile).
- A 404/unknown-route falls through to the legacy proxy during migration (so a
  not-yet-migrated deep link still works).

## Honesty
- Env pill must stay truthful: `live · <api host>` vs `demo backend`, matching
  `setEnvPill()`. Never show "live" against the mock.

## TDD
- Port `headerState` + `setEnvPill` specs; assert the shell renders each auth
  mode correctly.
- Edge-router unit test: migrated path → new app; unknown path → proxied.
- Smoke E2E: shell loads, topbar + theme toggle work, session bootstraps.

## Acceptance
- New app deploys to Cloudflare Workers behind the same domain; `/__health` or a
  trivial route served by it while `/`, `/apps/*`, `/runs/*`, `/settings` still
  proxy to legacy.
- Auth bootstrap + theme toggle + env pill match legacy behavior.
- Existing legacy E2E suites remain green (nothing user-facing changed).

## Coexistence / rollback
- The edge rule defaults to legacy; the shell is only reached via an explicit,
  non-user path until PRD 03 flips the first real route. Rollback = remove the
  new Worker from the edge map.

## Dependencies
- **PRD 01** (spine). Blocks all route PRDs (03–07, 09).
