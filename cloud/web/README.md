# `cloud/web` — TanStack web dashboard (PRD 02+)

The re-platformed dashboard that replaces `cloud/public/app.js` **route by route**
(see [`docs/prd/web-migration`](../../docs/prd/web-migration/00-overview.md)).
Vite + React 19 + **TanStack Router** (SPA) + **TanStack Query**, consuming the
`@shipaso/*` spine.

> **Router vs Start.** The authed shell + routes need Router (routing + loaders +
> Query), not SSR. So this is a Router/Vite SPA. TanStack **Start**'s SSR is
> layered in at **PRD 09** for the public/funnel surfaces, where first paint + SEO
> actually matter.

## What's here (PRD 02 — the shell)
- **Shell**: sticky topbar (logo, theme toggle, env pill, auth-aware header) +
  centered content column, wrapping every route via `<Outlet />`.
- **Auth**: `GET /auth/me` over the shared client (React Query), disabled in the
  no-API demo path so the shell renders offline.
- **Spine wiring**: `@shipaso/api` (client) + `@shipaso/tokens/css` (design
  tokens), aliased in `vite.config.ts` until the monorepo workspace lands.
- **Behavioral core (pure + tested)**: `src/shell/` — `headerState` (mirrors the
  canonical `cloud/scripts/headerState.mjs` spec), `envPill`, and `edgeRoutes`.

## Strangler coexistence
`src/shell/edgeRoutes.ts` is the source of truth for **which paths the new app
owns** vs. proxy to the legacy dashboard. PRD 02 owns only `/_shell/health` — it
changes **no** user-facing routing. Each route PRD adds its path to `OWNED_PATHS`
and the deploy-time edge rule (Cloudflare) reads that list. The edge/deploy wiring
is an ops step, done when a route is ready to take live traffic — not in CI.

## Commands
```bash
npm run dev         # local dev server
npm run typecheck   # tsc --noEmit
npm test            # vitest (shell core + Topbar render)
npm run build       # production build (also the CI integration gate)
```

CI runs typecheck + test + build on every PR (the `web` job in `.github/workflows/ci.yml`).
