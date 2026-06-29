# Phase 0 — Foundation PRD (ShipASO mobile)

Parent: `docs/prd/expo-app/00-implementation-plan.md`. Status: ready to build.

## Objective
Stand up the Expo workspace, the typed API client (Bearer auth), shared types,
the design-token theme, and the test harness — the scaffold every later phase
builds on. **No product screens yet**; this phase is "the app boots, is themed,
can call the API as a logged-out client, and CI is green."

## Scope
- **In:** `mobile/` Expo (managed) + Expo Router app; `packages/shared-types`;
  `api/client.ts` (Bearer from SecureStore, error normalization, 401 hook);
  `theme/tokens.ts` (ported from `public/styles.css :root`); Jest + RNTL setup;
  EAS config skeleton (`eas.json`, `app.config.ts`); a root layout that mounts
  the theme + a `QueryClientProvider`.
- **Out:** auth flow, any real screen, credentials, push.

## Files
- `mobile/package.json`, `mobile/app.config.ts`, `mobile/eas.json`, `mobile/tsconfig.json`
- `mobile/app/_layout.tsx` — providers (theme, React Query), font load, a placeholder index
- `mobile/src/api/client.ts`, `mobile/src/api/errors.ts`
- `mobile/src/theme/tokens.ts`, `mobile/src/theme/index.ts`
- `mobile/src/lib/format.ts`
- `packages/shared-types/{package.json,index.ts}` — initial DTOs: `Me`, `AppRow`,
  `AppListItem`, `ResolveResult`, `Finding`, `FindingsSummary`, `ShotScore`/`FamilyShotScore`,
  `PlayAudit`, `CoverageReport` (copied/narrowed from `cloud/src/engine` public types)
- tests: `mobile/src/api/client.test.ts`, `mobile/src/theme/tokens.test.ts`

## Contracts / reuse
- Base URL from `app.config.ts` `extra.apiBase` (default `https://api.shipaso.com`),
  matching `public/config.js`.
- `client.ts` injects `Authorization: Bearer <token>` from `expo-secure-store`
  (token may be absent in Phase 0 → unauthenticated calls work, e.g. `/proof`).
- `shared-types` mirrors the engine's public shapes; `cloud/` may later import it
  to guarantee no drift (non-blocking for Phase 0).

## Acceptance criteria
- `npx tsc --noEmit` clean in `mobile/` and `packages/shared-types/`.
- `expo start` boots to a themed placeholder (manual check; not CI-gated).
- `client.ts`: a request includes the Bearer header when a token is present and
  omits it when absent; a 401 invokes the injected sign-out callback; non-2xx →
  a normalized `ApiError {status,message}`.
- Theme tokens match the canonical palette (`--bg #07090e`, `--signal #34d399`, …).

## Tests
- `client.test.ts` — Bearer attached/omitted; 401 → sign-out hook; error shape
  (fetch mocked; no network).
- `tokens.test.ts` — palette values + required font families present.

## Dependencies / external gates
- npm deps install (expo, expo-router, @tanstack/react-query, expo-secure-store,
  react-native-svg, reanimated, jest-expo, @testing-library/react-native).
- **Gate (not blocking code):** an Expo account is only needed at Phase 6 (EAS).

## Definition of done
Workspace builds + typechecks, theme + API client unit-tested green, CI runs the
mobile test job. No screens, no auth yet.
