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

## Status — Phases 0–6 built & verified headlessly

The full app is code-complete. Every phase's logic and screens are verified with
`tsc --noEmit` + `jest` (jest-expo runs RN component render tests in CI — no
simulator). The remaining work to *deploy* is external (accounts, signing, store
review) and is documented in [`STORE.md`](./STORE.md).

```bash
cd mobile
npm install
npm run typecheck   # tsc --noEmit
npm test            # jest (logic + RN render tests)
```

| Phase | What | Key files |
|---|---|---|
| 0 Foundation | DTOs, API client (Bearer/401/ApiError), theme tokens | `src/types/api.ts`, `src/api/`, `src/theme/` |
| Harness | Expo SDK 51 + expo-router, React Query, jest-expo | `app/_layout.tsx`, `app.config.ts`, `jest.config.js` |
| 1 Auth + dashboard | magic-link→Bearer state machine, dashboard, connect/search | `src/auth/`, `app/(app)/index.tsx`, `ConnectPicker`/`AppCard` |
| 2 Money screen | app/run detail, approval gate (push hidden until approved), fastlane | `app/(app)/{apps,runs}/`, `ApprovalGate`/`ScreenshotGallery`/`CoverageGauge` |
| 3 Credentials | `.p8` + Play sheets, **used once, never stored** | `src/lib/credentials.ts`, `CredentialSheet`, `PlayAuditView` |
| 4 Extras | war room, share-a-win, portfolio, proof, billing→web | `app/(app)/{war-room,portfolio}`, `app/(public)/proof.tsx` |
| 5 Native | push, offline cache (honest stale labels), deep links | `src/notifications/`, `src/lib/{deeplink,queryPersist}.ts` |
| 6 Ship | EAS config, store-readiness | `eas.json`, `app.config.ts`, `STORE.md`, `assets/README.md` |

### Honesty invariants (test-enforced)
- credentials never reach any persistence API (`credentials.neverPersisted.test.ts`)
- push commands hidden until approval; never executed client-side (`ApprovalGate.test.tsx`)
- unmeasured → "—", unknown score → "?", unseen field → UNKNOWN (never 0); cached
  data is never labeled "live"

## External gates (cannot run/verify in this sandbox)

Native EAS build/submit, a simulator/device smoke test, push delivery end-to-end,
and store review — plus the live **server gate** (`/auth/exchange` + universal-link
association files, PR #124) and filling the real Team ID / signing fingerprint.
See [`STORE.md`](./STORE.md).
