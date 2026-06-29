# Phase 6 — Ship PRD (ShipASO mobile)

Parent: `00-implementation-plan.md`. Depends on: Phases 0–5.

## Objective
Get the app from "code-complete + tests green" to **submitted for App Store /
Play review** — EAS build + submit, store assets, and the review-risk pre-flight.

## Scope
- **In:** EAS build/submit profiles; app icons/splash; store listing metadata +
  screenshots; privacy/data-safety disclosures; universal-link association files
  in prod; release checklist.
- **Out:** post-launch ops.

## Files / artifacts
- `mobile/eas.json` (dev/preview/production), `mobile/app.config.ts` (bundle ids,
  version, scheme, associated domains)
- `mobile/assets/{icon,splash,adaptive-icon}.png`
- store metadata (title, subtitle, description, keywords, screenshots) — dogfood:
  draft it with ShipASO itself
- privacy manifest / data-safety form content
- web origin: AASA (`/.well-known/apple-app-site-association`) + Android
  `assetlinks.json` deployed to prod (the Phase 1 gate, productionized)

## Acceptance criteria
- `eas build -p ios|android` produces installable artifacts (internal/TestFlight).
- `eas submit` uploads to App Store Connect / Play Console.
- Universal links resolve in prod (magic link opens the app).
- Maestro e2e green on the built artifact (login→connect→run→approve→handoff).
- Privacy disclosures accurate: **credentials are not collected/stored** (used
  once, in-request); only the session token is stored (Keychain/Keystore).

## External gates (cannot be done from this repo/CI — require the user)
- **Apple Developer + Google Play Console accounts**, an **Expo/EAS account**, and
  signing credentials (App Store Connect API key, Play service account for
  publishing the *app itself* — distinct from a user's ASO service account).
- **IAP vs web-checkout decision** (plan §1c) finalized — gates approval.
- **Server: ship the mobile auth-callback/exchange + prod AASA/assetlinks** (the
  Phase 1 server gate) before public sign-in works.
- Final legal/privacy review of the data-safety form.

## Definition of done
The app is built via EAS, passes the e2e smoke on the artifact, has accurate
store + privacy metadata, and is **submitted for review**. Actual "live on the
store" = review approval, which is out of our hands.

## Honest status note
Everything up to `eas submit` is buildable/automatable; the credentialed build,
the developer accounts, and store review are the user's to provide/operate. This
PRD's "done" is *submitted*, not *approved*.
