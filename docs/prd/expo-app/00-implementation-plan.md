# ShipASO mobile (Expo) — implementation plan

Status: **proposal / not yet built**. File-by-file plan, not code.

Goal: an Expo (React Native) app that **replicates the web dashboard's behavior** —
the same prepare → approve → (hand-off) → prove loop — against the **same Worker
API** (`https://api.shipaso.com`). The mobile app is a **client of the existing
API**; it does not re-implement the ASO engine. Everything the web does, the
phone does, with the product's identity intact: honest data (real numbers or an
explicit "unmeasured"/lock — never fabricated), no auto-push to a live store, and
the same credential posture (`.p8` / Play service-account used once, never stored).

The web app is a 4-screen vanilla-JS SPA (`cloud/public/app.js`): a logged-out
**preview**, a **dashboard** (apps list + connect/search), an **app detail**
view, and a **run detail** ("the money screen"). This plan maps each to a native
screen and calls out the few decisions that gate the build.

---

## 1. Gating decisions (resolve these first)

### 1a. Auth on mobile — magic link → **Bearer session token** (the crux)
The web uses passwordless magic-link → a **signed session cookie**. Cookies are a
poor fit for a native app, but the API already supports the alternative:
`requireUser` accepts **`Authorization: Bearer <session-token>`** — "the same
signed session token, just carried in a header" (`api/index.ts:432-456`). So the
mobile app stores that token and sends it as a Bearer header. No cookies, no CORS
(native fetch is not subject to CORS).

The one gap: `GET /auth/callback` today **sets a cookie and redirects** to the web
dashboard. For mobile we need the token delivered to the app. Recommended flow:

1. App → `POST /auth/request {email}` (unchanged) — "we sent you a link."
2. The magic link is a **universal/app link** (`https://shipaso.com/auth/m?token=…`
   with an Apple App Site Association + Android assetlinks, or a `shipaso://`
   scheme fallback) that opens the **app**, not the web.
3. The app extracts the magic-link token and calls a **mobile callback** that
   returns the session token as JSON instead of setting a cookie. Smallest server
   change: have `GET /auth/callback` return `{ token }` JSON when it sees
   `Accept: application/json` (or add `POST /auth/exchange {token} → {session}`).
   This reuses all the existing magic-link crypto in `src/auth.ts`.
4. App stores the session token in **`expo-secure-store`** (Keychain / Keystore),
   sends it as `Authorization: Bearer` on every request, and boots via
   `GET /auth/me`.

> **Server work this requires (small, one-time):** a JSON/mobile mode on the auth
> callback (or a `/auth/exchange` route) + universal-link association files served
> from the web/Pages origin. Everything else (`requireUser` Bearer path) already
> exists.

### 1b. Code sharing — share **types**, not the engine
The engine (`cloud/src/engine/`) runs server-side; the phone consumes its JSON
output. Don't ship the engine to the device. **Do** share the response/DTO types
so the app and API can't drift: extract the public result shapes (`AgentResult`,
`Finding`, `ShotScore`/`FamilyShotScore`, `PlayAudit`, `CoverageReport`,
`ResolveResult`, the `/auth/me` shape, etc.) into a small `packages/shared-types`
workspace package imported by both `cloud/` and the new `mobile/`. (Alternative:
generate types from the API; a hand-maintained shared package is lighter given the
surface is small and stable.)

### 1c. Billing — route subscriptions to the web (avoid IAP friction)
The web sells tiers via **Stripe Checkout** (`POST /billing/checkout → {url}`).
Apple/Google require **in-app purchase** for digital subscriptions consumed in the
app, and Stripe-in-a-webview risks rejection. Recommended: keep paywalled
*purchasing* on the **web** — the app opens the Checkout URL in the system browser
(`expo-web-browser`) for an existing account, and shows tier state read from
`/auth/me`/`/portfolio`. Treat "buy in-app via IAP" as a later, separate track
(it changes revenue plumbing). **Flag for product/legal sign-off before store
submission** — this is the most common reason an app like this gets rejected.

### 1d. Expo Router (file-based) mirroring the SPA routes
Use **Expo Router** so the file tree maps 1:1 to the web's hash routes and we get
deep links for free (needed for 1a). Managed workflow + **EAS Build**.

---

## 2. Screen map (web SPA → native)

| Web (`app.js`) | Native screen (Expo Router) | Notes |
|---|---|---|
| `previewView()` (logged-out, live backend) | `app/(public)/preview.tsx` | try-before-signup: a real `/preview` audit + rank teaser; "Connect & run" gates signup |
| login (email field → "check your email") | `app/(public)/login.tsx` + deep-link handler | §1a |
| `viewDashboard()` | `app/(app)/index.tsx` | apps list + connect/search picker (paging), empty state |
| connect/search picker | component within dashboard | `POST /resolve` → candidates; "Show more" paging + infinite scroll |
| `viewApp(id)` | `app/(app)/apps/[id].tsx` | rank-movement card, trend sparkline, runs list, **ASC run panel**, **Play audit panel**, disconnect, war-room link, share-a-win |
| `viewRun(id)` | `app/(app)/runs/[id].tsx` | the money screen: proposal diff, findings, coverage gauge, screenshot gallery + levers, keyword gaps/opportunities, **approval gate → push commands**, localization expansion, fastlane zip, GitHub PR |
| war room | `app/(app)/apps/[id]/war-room.tsx` | head-to-head grid (Scale-tier) |
| portfolio (Scale) | `app/(app)/portfolio.tsx` | roll-up across apps |
| proof (public) | `app/(public)/proof.tsx` | anonymized aggregate `GET /proof` |

---

## 3. Architecture / tech stack

- **Expo (managed) + Expo Router** — file-based nav + deep links.
- **TanStack Query (React Query)** — server-state cache, retries, optimistic
  updates for approve/reject; mirrors the web's per-screen fetch model.
- **`expo-secure-store`** — the session token only (Keychain/Keystore).
- **`expo-document-picker` + `expo-file-system`** — read a `.p8` / service-account
  `.json` for the credential flows (see §5). Read into memory, sent once.
- **`expo-linking`** — magic-link universal/app links (§1a).
- **`expo-web-browser`** — Stripe Checkout + external "fix this" skill linkouts.
- **`react-native-reanimated`** — the rank count-up tweens + flashes (the web's
  `rankPop`/`rankFlash`), honoring `prefers-reduced-motion` (Reduce Motion).
- **`react-native-svg`** — the trend sparkline and the share card (fetch the
  server SVG from `/apps/:id/share-card.svg` and render/share it).
- **`expo-notifications`** (Phase 5) — push when a run finishes / awaits approval.
- **TypeScript strict, ESM**; lint/test parity with `cloud/`.

### Core modules (`mobile/src/`)
- `api/client.ts` — typed fetch wrapper: base `https://api.shipaso.com`, injects
  `Authorization: Bearer <token>` from SecureStore, normalizes errors, 401 → sign-out.
  Mirrors `app.js`'s `api()` but Bearer instead of cookies.
- `api/endpoints.ts` — one function per route (`resolve`, `connectApp`, `listApps`,
  `getApp`, `getRanks`, `getRun`, `decideRun`, `runAsc`, `auditPlay`, `verifyPlay`,
  `pushCommands`, `proof`, `portfolio`, `me`, `authRequest`, `authExchange`),
  typed via `shared-types`.
- `auth/session.ts` — token store, boot (`/auth/me`), deep-link token capture, sign-out.
- `theme/tokens.ts` — port the design tokens from `public/styles.css` `:root`
  (the canonical palette `--bg #07090e`, `--signal #34d399`, `--bad`, `--warn`,
  fonts JetBrains Mono / Space Grotesk / Fraunces) into a typed RN theme, so the
  app is visually the same product.
- `components/` — `RankMovementRow`, `Sparkline`, `FindingCard`, `CoverageGauge`,
  `ScreenshotGallery`, `LeverList`, `SurfaceLock`, `ApprovalGate`, `ConnectPicker`,
  `CredentialSheet` (§5). Each renders server data verbatim — **no client-side ASO
  computation**.

---

## 4. Feature parity checklist (all consume existing API/responses)

- **Dashboard**: list apps + latest run status (`GET /apps`); connect by
  name/URL/id (`POST /resolve` → candidates → `POST /apps`); ambiguous → picker;
  empty state.
- **Rank movement** (`GET /apps/:id/deltas`): per-keyword prev→cur with the
  count-up + direction chip (Reanimated). Honesty: single-snapshot keywords show
  `new`/current with **no fabricated count-up**; unchecked = "—".
- **Rank trend** sparkline (`GET /apps/:id/ranks`).
- **Run/audit** (`GET /runs/:id`): findings (severity×impact, sorted server-side),
  coverage gauge + waste, screenshot **gallery** (real URLs) + quantified
  **levers**, keyword **gaps**/**opportunities** (competitor-attributed, honest
  copy), reviews sentiment.
- **Approval gate**: push commands hidden until `POST /runs/:id/approve` →
  reveals the **handoff commands** (we hand off, never execute). Reject path.
- **Fastlane handoff**: download `GET /runs/:id/fastlane.zip` (incl. the gated
  Android `supply` tree) via `expo-file-system` + share sheet; optional GitHub PR.
- **ASC read-and-improve** (`POST /apps/:id/run-asc`) and **Play own-app audit**
  (`POST /apps/:id/audit-play`, `POST /play/verify`) — §5.
- **War room**, **share-a-win** card, **portfolio**, **proof**.
- **Honesty surfaces rendered faithfully**: `?` screenshot grade = "couldn't read
  from public data"; `SurfaceLock`s = capability gaps with "connect to unlock"
  (never a deficiency); `null`/unmeasured fields shown as unmeasured, never 0.

---

## 5. Credential flows on mobile (security-sensitive — mirror the web posture)

The web sends the `.p8` / Play service-account **in the request, used once, never
persisted** (`ascJwt`/`googleAuth` posture; the `/play/verify` + `/apps/:id/audit-play`
routes added in PR #120, SSRF-guarded in #121). The mobile `CredentialSheet` must
keep that contract:

- Enter via **paste** or **document picker** (`expo-document-picker` →
  `expo-file-system.readAsStringAsync`). Read into a component-local variable only.
- Send once over HTTPS Bearer to the existing route. **Never** write the `.p8` /
  service-account JSON to `expo-secure-store`, AsyncStorage, logs, or analytics.
  (Only the *session token* is persisted — never store credentials.)
- Mirror the web's in-memory-for-the-session reuse (`ascCredsMemory`) at most;
  drop it on navigation. Default to one-shot.
- Honest result rendering: `/play/verify` `{ok,reason}`; audit returns the listing
  with the short description present + `reliable:true` (no locks).
- Server already enforces: read-only (never commits/publishes), `token_uri`
  restricted to googleapis.com, key never leaves the Worker, errors key-free.

**Platform note:** on iOS, pasting a private key is fine; the document picker
gives a one-shot file read. Disable screenshot/anti-leak niceties are optional;
the binding contract is "never persist on device."

---

## 6. Honesty & product-identity guardrails (carried to mobile)

1. **Never fabricate.** The app renders only what the API returns; it computes no
   ASO numbers locally. Unmeasured → an explicit "unmeasured"/lock, never 0 or a
   guess (the same discipline as the web; the copy ships from the engine).
2. **No store push.** The app surfaces **handoff commands** + the fastlane zip
   behind the approval gate; it never executes a store push. The Play path is
   read-only (never commits).
3. **Credentials never stored on device** (§5). Only the session token is.
4. **Reduce-Motion respected** for the rank animations (parity with the web's
   `prefers-reduced-motion`).

These become **test invariants** (§8), exactly as on the web.

---

## 7. File-by-file (new `mobile/` workspace)

```
mobile/
  app/
    _layout.tsx                  // root: theme, QueryClient, auth boot, deep-link listener
    (public)/login.tsx          // email → /auth/request; "check your email"
    (public)/preview.tsx        // logged-out try-before-signup (/preview)
    (public)/proof.tsx
    (app)/_layout.tsx           // requires session (redirect to login if /auth/me unauthed)
    (app)/index.tsx             // dashboard: apps list + ConnectPicker
    (app)/apps/[id].tsx         // app detail
    (app)/apps/[id]/war-room.tsx
    (app)/runs/[id].tsx         // run detail (money screen)
    (app)/portfolio.tsx
  src/
    api/{client,endpoints,errors}.ts
    auth/session.ts
    theme/tokens.ts
    components/{RankMovementRow,Sparkline,FindingCard,CoverageGauge,
                ScreenshotGallery,LeverList,SurfaceLock,ApprovalGate,
                ConnectPicker,CredentialSheet,Interstitial}.tsx
    lib/{format,motion}.ts
  app.config.ts                 // scheme: "shipaso", universal links, EAS
  eas.json
packages/shared-types/          // DTOs shared with cloud/ (§1b)
```

---

## 8. Test plan

- **Unit/component** — Jest + `@testing-library/react-native`: each component
  renders server fixtures faithfully (findings sort, `?`-grade empty state, locks
  as capability gaps, unmeasured≠0, approval gate hides push commands until
  approved). Reuse the web's `mock.js` contract as typed fixtures so web + mobile
  assert the **same honesty invariants**.
- **API client** — Bearer header attached; 401 → sign-out; error normalization.
- **Auth/deep-link** — magic-link token capture → SecureStore → `/auth/me` boot.
- **Credential contract** — a test asserts the `.p8`/service-account value is
  **never written** to any persistent store (spy on SecureStore/FS/AsyncStorage).
- **E2E** — **Maestro** flows (lighter than Detox on Expo): login (stubbed link),
  connect an app, open a run, approve → see handoff, run a Play audit (mock).
  Drive against a mock API server (the `mock.js` contract) — no live network.

---

## 9. Build / release (it's an app — it ships through the stores)

- **EAS Build** (iOS + Android) + **EAS Submit**. Dev/preview/prod profiles in
  `eas.json`; `app.config.ts` reads `API_BASE` per profile (default
  `https://api.shipaso.com`, overridable for staging — parity with `config.js`).
- Universal links: Apple App Site Association + Android `assetlinks.json` served
  from the web origin (for §1a). Custom scheme `shipaso://` as fallback.
- **Store-listing meta:** ShipASO can audit its *own* listings once shipped — a
  nice dogfood, but out of scope here.
- **Review-risk pre-flight:** resolve §1c (IAP vs web checkout) before submitting.

---

## 10. Phased rollout

| Phase | Deliverable | Server work |
|---|---|---|
| **0 — Foundation** | Expo + Router + theme tokens, `api/client` (Bearer), QueryClient, `shared-types` | — |
| **1 — Auth + dashboard** | magic-link deep link → SecureStore, `/auth/me` boot, apps list, connect/search picker, preview | auth JSON/mobile callback + link association (§1a) |
| **2 — Read money screen** | app detail (rank movement, sparkline, runs) + run detail (findings, coverage, gallery, gaps) + approval gate + fastlane zip | — |
| **3 — Credentials** | ASC run + Play verify/audit via `CredentialSheet` (one-shot, never stored) | — (routes exist) |
| **4 — Extras** | war room, share-a-win, portfolio, proof, billing linkout | — |
| **5 — Native** | push notifications (run ready / awaiting approval), offline cache, refined deep links | a push-register + notify hook (optional) |
| **6 — Ship** | Maestro e2e green, EAS build + submit, IAP/legal sign-off | association files in prod |

Phases 0–2 deliver a usable read-only app on day one (the highest-value loop:
see ranks → open a run → approve → get the handoff). 3+ layer on the
credentialed and native capabilities.

---

## Summary of what's NEW vs reused

- **Reused as-is:** the entire Worker API + engine, the honesty model, the
  credential routes, the design tokens, the mock contract.
- **New, small, server-side:** a mobile auth-callback/exchange that returns the
  session token as JSON, + universal-link association files. (Everything else —
  the Bearer auth path — already exists.)
- **New, client-side:** the Expo app itself (screens + components + api client),
  a `shared-types` package, and the mobile credential sheet that upholds the
  "used once, never stored" contract.

The phone is a faithful client of the same honest loop — not a second engine.
