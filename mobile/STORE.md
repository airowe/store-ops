# Shipping ShipASO mobile to the App Store & Google Play

The app is **code-complete and verified headlessly** (`npm run typecheck` + `npm test`
green). What remains to be *deployable* is the set of steps that require real
developer accounts, signing identities, and store review — none of which can run
or be verified in CI/this sandbox. This is the runbook.

## 0. Prerequisites (the external gates)

| Gate | Needed for | Where |
|---|---|---|
| Expo (EAS) account + `EAS_PROJECT_ID` | `eas build` / `eas submit` | expo.dev → set `extra.eas.projectId` (or env) |
| Apple Developer Program ($99/yr) | iOS signing, App Store | developer.apple.com |
| Apple **Team ID** + ASC **app id** | AASA file + `eas.json` submit | Membership / App Store Connect |
| Google Play Developer ($25) | Android signing, Play | play.google.com/console |
| Play **release signing SHA-256** | `assetlinks.json` | Play App Signing → App integrity |
| Server: `/auth/exchange` + association files live | magic-link sign-in on device | PR #124 (this repo) deployed to `shipaso.com` |

## 1. Fill the placeholders

1. **Association files** (`cloud/public/.well-known/`, from PR #124): replace
   `TEAMID` and `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT`, then deploy
   Pages. Verify per `cloud/public/.well-known/README.md`. The identifiers MUST
   equal `APP_IDENTIFIER` in `app.config.ts` (a test pins the internal copies).
2. **`eas.json` → submit.production**: real `appleId` / `ascAppId` / `appleTeamId`;
   provide the Play service-account via the `GOOGLE_SERVICE_ACCOUNT_KEY` EAS secret
   (never commit it).
3. **`extra.eas.projectId`** in `app.config.ts` (or `EAS_PROJECT_ID`).
4. **Binary assets** per `assets/README.md`, then reference them in `app.config.ts`.

## 2. Build & submit

```bash
cd mobile
npx eas-cli build --platform all --profile production
npx eas-cli submit --platform ios --profile production
npx eas-cli submit --platform android --profile production
```

## 3. Data safety / privacy answers (consistent with the product)

The app's privacy posture is deliberately small — answer the store questionnaires
to match:

- **Account / email**: collected for sign-in (magic link). Linked to the user.
- **No tracking, no ads, no analytics SDKs.**
- **Credentials (`.p8` / Play service-account)**: entered to run an audit, sent
  once over HTTPS, **never stored on the device** (enforced by
  `credentials.neverPersisted.test.ts`) and never persisted server-side. Declare
  as *not collected/stored* — they are transient inputs.
- **On-device storage**: only the session token (Keychain/Keystore) + a cached
  copy of last-seen listing data (labeled "cached", never "live").
- **iOS encryption**: `ITSAppUsesNonExemptEncryption = false` (HTTPS only).
- **Purchases**: handled on the **web** (Stripe Checkout opened in the system
  browser) — no IAP. ⚠️ Confirm this is acceptable for review (plan §1c); if Apple
  pushes back on "digital goods", the fallback is to gate purchasing entirely
  off-app and present tier state read-only.

## 4. Review-risk checklist (the honesty model helps here)

- No auto-push to a live store — the app only hands off commands/zip; nothing
  mutates a listing. (Avoids "does unexpected things" rejections.)
- No fabricated data — unmeasured reads show "—"/"?"/"unmeasured", so reviewers
  never see misleading metrics.
- Account deletion / sign-out present (sign-out drops the token; account deletion
  is a server concern — ensure a path exists before submission if required).

## What is verified here vs. what needs a device

- **Verified in CI**: types, all component/logic behavior (incl. honesty
  invariants and the never-persist-credentials invariant), config consistency.
- **Needs an Expo/device environment** (cannot run here): the native build, a
  simulator/device smoke test, push delivery end-to-end, and store review.
