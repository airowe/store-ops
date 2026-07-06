# PRD 01 — Shared spine (tokens · API · honesty)

> Extract the three things both surfaces must agree on into framework-agnostic,
> pure-TS packages **before** any UI is rebuilt: the design tokens, the API
> client + types, and the honesty/format helpers. Zero UI rewrite, fully
> reversible, and valuable on its own (it retires the reactive
> `tokens.test.ts` drift-policing with a real source of truth).

## The move
Today `mobile/src/api`, `mobile/src/types/api.ts`, `mobile/src/lib/format.ts`,
and `mobile/src/theme/tokens.ts` are clean TS but **native-only**; the web
re-implements all of it imperatively in `app.js`. Lift them into shared packages
that the Expo app and the future TanStack Start app both consume. The web keeps
running on `app.js` unchanged during this PRD — the spine is additive.

## Deliverables

### 1. `@shipaso/tokens` — design source of truth
```
packages/tokens/
  tokens.json         # palette (dark+light), fonts, radius, fontSize, spacing
  build.ts            # generates the two artifacts below
  dist/tokens.css     # :root + :root[data-theme="light"] custom properties
  dist/tokens.ts      # typed `palette`, `lightPalette`, `paletteFor`, scales
```
- `tokens.json` becomes canonical; `styles.css :root` and
  `mobile/src/theme/tokens.ts` are **generated**, not hand-maintained.
- Light mode (already added to both surfaces) moves here so it's defined once.

### 2. `@shipaso/api` — REST client + types
- Lift `mobile/src/api/{client,endpoints,errors}.ts` + `types/api.ts` verbatim.
- Client is transport-agnostic (inject `fetch` + auth header strategy) so native
  (SecureStore session) and web (cookie session) each supply their own auth.
- Endpoints unchanged: `/auth/me`, `/apps`, `/apps/:id`, `/apps/:id/ranks`,
  `/apps/:id/deltas`, `/apps/:id/war-room`, `/apps/:id/run`, `/preview`,
  `/account/*`, `/github/connect`, …

### 3. `@shipaso/honesty` — pure logic + geometry
- Lift `format.ts` (`formatRank`, `humanizeStatus`, `timeAgo`) and the
  delta/direction, coverage-classification, and `buildSparkGeometry` helpers.
- These encode the non-negotiable rules (unseen/empty/zero, "approved ≠
  shipped", correlational attribution). One definition → both surfaces enforce
  identically.

## Repo shape
- Introduce a workspace (`pnpm`/`npm` workspaces) rooting `packages/*`, with
  `mobile/` and the new `cloud/web/` (PRD 02) as consumers. `cloud/` (the Worker
  API) may consume `@shipaso/api` *types* to guarantee client/server type parity.

## Honesty
- The extraction is **behavior-preserving**: no rule changes, only relocation.
  `@shipaso/honesty` is where the rules now live, documented as load-bearing.

## TDD
- Move the existing `format.test.ts`, `tokens.test.ts`, `Sparkline.test.tsx`
  (geometry) into the packages; they must pass unchanged.
- Add a `tokens.css ⇄ tokens.ts` parity test (generated artifacts agree) —
  replacing the cross-repo `tokens.test.ts` regex with an in-package check.
- Contract test: `@shipaso/api` types compile against a captured API response
  fixture per endpoint.

## Acceptance
- `mobile/` builds + all its tests pass importing from the shared packages
  (proves the lift is non-breaking) — the phone is the canary.
- `styles.css` and the RN tokens are generated from `tokens.json`; editing the
  JSON updates both.
- No change to the live web dashboard (`app.js` untouched) or the API.

## Coexistence / rollback
- Purely additive. If the migration is paused, these packages still deprecate the
  duplicated native code and the drift test — net positive with the UI untouched.

## Dependencies
- None. This PRD is the prerequisite for **all** others.
