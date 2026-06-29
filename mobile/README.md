# ShipASO mobile (Expo)

A React Native (Expo) client of the existing Worker API (`https://api.shipaso.com`).
It **replicates the web dashboard's behavior** — the prepare → approve → (hand-off)
→ prove loop — against the same API. It does **not** re-implement the ASO engine;
it consumes the engine's JSON. Product identity is preserved: honest data (real
numbers or an explicit "unmeasured"/lock — never fabricated), no auto-push to a
live store, and the same credential posture (`.p8` / Play service-account used
once, never stored on device — only the session token is persisted).

Plan: `docs/prd/expo-app/00-implementation-plan.md` and per-phase PRDs
(`phase-0` … `phase-6`).

## Status — Phase 0 (foundation)

This directory currently holds the **portable, Expo-free core** that every later
phase builds on, plus its tests. It is fully verifiable in CI with `tsc` + `vitest`
(no React Native toolchain required):

- `src/types/api.ts` — DTOs mirroring the engine's public shapes (`Me`,
  `AppListItem`, `ResolveResult`, `Finding`/`FindingsSummary`,
  `ShotScore`/`FamilyShotScore`, `PlayAudit`, `CoverageReport`, …).
- `src/api/client.ts` + `src/api/errors.ts` — the typed API client: injected
  `fetch` + token provider + `onUnauthorized` hook; Bearer auth; normalized
  `ApiError`. No Expo/RN dependency, so it unit-tests in plain Node.
- `src/theme/tokens.ts` — the design tokens, ported 1:1 from
  `cloud/public/styles.css :root` (a test pins them to the web so a palette
  change there fails CI).

```bash
cd mobile
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## What is NOT yet here (and needs an Expo-capable environment)

The RN screens, Expo Router tree, native modules (SecureStore, document-picker,
notifications), and the EAS build/submit config land in Phases 1–6. Those require
an Expo/React Native toolchain (and, at Phase 6, an Expo account + Apple/Google
developer accounts + store review) that this sandbox cannot run or verify. The
Phase-0 core above is the seam those phases plug into — the API client and types
they import are already tested.

A small **server gate** also precedes the auth phase: a JSON/mobile mode on the
auth callback (or `/auth/exchange`) plus universal-link association files
(AASA / assetlinks). See plan §1a.
