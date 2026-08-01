# RevenueCat In-App Purchase Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Two product decisions (below) must be resolved before Task C3 and the paywall copy in Task B3.**

**Goal:** Add native in-app subscriptions to the ShipASO mobile app via the **RevenueCat SDK**, so the app sells the existing paid tiers (indie/startup/scale) through StoreKit / Play Billing. This (1) satisfies the RevenueCat Shipaton 2026 mandatory gate — *"integrate the RevenueCat SDK to power ≥1 in-app purchase"*, (2) re-opens the HAMM and Best Monetization award categories, and (3) is the "implement IAP" fix App Review named for the Guideline 3.1.1 rejection (submission a64749cd), replacing the "sell nothing" workaround shipped in #423.

**Architecture:** RevenueCat sits between the app and the stores; the **server stays the source of truth for `tier`**. The app configures `react-native-purchases` with the magic-link `userId` as the RevenueCat `appUserID`, presents an offering-driven paywall, and lets StoreKit/Billing process the purchase. A **new `/billing/revenuecat` webhook** on the Cloudflare Worker — mirroring the existing ASC `webhookReceiver.ts` — verifies the delivery, maps the entitlement/product to a `Tier`, and calls the existing `setTier()`. Because the app already reads `tier` off the `me` payload and gates every feature on it, once the server tier updates the app unlocks with minimal per-screen change.

```
Mobile (Expo 57 / RN 0.86)                         Cloudflare Worker + D1
  react-native-purchases                             existing Stripe /billing/webhook
  Purchases.logIn(userId) ── StoreKit/Billing ──▶ RevenueCat ──▶ NEW /billing/revenuecat
  paywall (getOfferings → purchasePackage)                              │ setTier()
        ▲ reads tier via GET /me ◀───────────────────────────────────── D1 users.tier
```

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-router, TypeScript (strict); Cloudflare Workers + D1 + Web Crypto; `react-native-purchases` (verify the 8.x line supports Expo 57 / RN 0.86 at install, via its Expo config plugin — the app is managed/CNG, no native dirs checked in).

## Global Constraints

- **Server is source of truth for tier.** The SDK/paywall never grants entitlements locally; it triggers the purchase and refreshes `me`. Tier is only ever written by a verified webhook.
- **Import extensions:** relative imports use a `.js` extension even from `.ts`/`.tsx`.
- **Test naming is per-package:** cloud Worker (`cloud/src`) uses `*.spec.ts` (e.g. `webhookReceiver.spec.ts`); mobile uses colocated `*.test.ts` / `*.test.tsx`. Match the package you touch.
- **Exports:** named exports only; no default (except the Expo `app.config.ts` default).
- **Reuse the existing webhook pattern:** the RevenueCat receiver copies `cloud/src/api/webhookReceiver.ts` — verify signature/auth, dedup by event id, then act. Do not invent a second verification scheme.
- **Reuse the existing tier machinery:** `billing.ts` (`Tier`, `appLimitForTier`, `tierForPriceId`) and `d1.ts` (`setTier`, `getTier`). Add an IAP price→tier map alongside `tierForPriceId`, do not fork tier logic.
- **Honesty invariants preserved:** unmeasured reads still render `—`/`?`; credentials still never persisted on device (`credentials.neverPersisted.test.ts` must stay green).
- **Compliance (Guideline 3.1.3):** with IAP present the app is compliant, but it MUST NOT link or steer users to the web checkout unless the External Purchase Link Entitlement is held. Default: in-app shows the RevenueCat paywall only; no "subscribe on our site" links in the app.
- **Apple requires a "Restore Purchases" affordance** — ship it in settings.

---

## Decisions (RESOLVED 2026-08-01)

- [x] **D1 — Web + IAP coexistence → KEEP BOTH, no in-app links.** Web keeps Stripe; the app adds a RevenueCat paywall. The app MUST NOT link or steer users to the web checkout (Guideline 3.1.3) — no "subscribe on our site" affordance in-app. The paywall must detect an existing active web sub (via `me`) and show a read-only "managed on the web" state instead of offering a purchase.
- [x] **D2 — Both-source reconciliation → HIGHEST ACTIVE TIER WINS.** Effective tier = the max of any active Stripe or RevenueCat entitlement. The paywall surfaces the "managed on the web" state (from D1) so a user with a web sub is never double-charged in-app.

---

## File Structure

**Workstream A — Store & RevenueCat config (no code; gates everything):** App Store Connect + Play Console subscription products, Paid Applications Agreement + tax/banking, RevenueCat project/offering/entitlements, API keys. Tracked as checklist tasks below.

- **Modify** `mobile/package.json` — add `react-native-purchases` (+ config plugin).
- **Modify** `mobile/app.config.ts` — register the config plugin; add the public SDK keys to `extra`.
- **Modify** `mobile/src/auth/AuthProvider.tsx` — `Purchases.configure` + `Purchases.logIn(userId)` on sign-in; `logOut` on sign-out.
- **Create** `mobile/src/components/Paywall.tsx` (+ `Paywall.test.tsx`) — offerings → packages → `purchasePackage`, plus restore.
- **Modify** `mobile/app/(app)/portfolio.tsx` — replace the "sell nothing" copy/gate with the paywall CTA.
- **Modify** `mobile/src/components/LocalizationCard.tsx` — `localization-locked` state opens the paywall.
- **Modify** `mobile/app/(app)/settings.tsx` — Restore Purchases action.
- **Create** `cloud/src/api/revenuecatWebhook.ts` (+ `.spec.ts`) — verified receiver → event→tier → `setTier`.
- **Modify** `cloud/src/index.ts` — route `/billing/revenuecat`; add `REVENUECAT_WEBHOOK_SECRET` to env.
- **Modify** `cloud/src/billing.ts` — `tierForIapProduct(productId): Tier | null`; effective-tier resolution for D2.
- **Modify** `cloud/src/d1.ts` (+ migration) — add `revenuecat_app_user_id`, `iap_product_id`, `iap_period_end` columns.

---

## Tasks

### Workstream A — Store & RevenueCat config
- [ ] **A1.** Create 3 auto-renewable subscription products in App Store Connect (indie/startup/scale) under a subscription group; same in Play Console. (Team ID `7WWYCV9VT8` already set in `eas.json`.)
- [ ] **A2.** Sign the **Paid Applications Agreement** and complete banking/tax in ASC. *(Hard blocker — offerings return empty until active. Do this first.)*
- [ ] **A3.** Create the RevenueCat project, add the App Store + Play apps, import products, define entitlement(s), assemble one Offering. Record public SDK keys (per platform) and the webhook auth token.

### Workstream B — Mobile app
- [ ] **B1.** Add `react-native-purchases` + config plugin (`package.json`, `app.config.ts`); SDK keys into `extra`. Confirm 8.x supports Expo 57 / RN 0.86.
- [ ] **B2.** Wire `Purchases.configure` + `logIn(userId)` / `logOut` into `AuthProvider`; add `addCustomerInfoUpdateListener` → refetch `me`.
- [ ] **B3.** Build `Paywall.tsx` (offerings → purchase → success/error/restore) with tests mocking the SDK. Copy depends on D1/D2.
- [ ] **B4.** Replace the `portfolio.tsx` "sell nothing" gate and the `localization-locked` card with paywall CTAs; add Restore Purchases to `settings.tsx`. Keep honesty invariants green.

### Workstream C — Cloud entitlement sync
- [ ] **C1.** D1 migration: add `revenuecat_app_user_id`, `iap_product_id`, `iap_period_end`; extend the users column list + `setTier` writer.
- [ ] **C2.** `revenuecatWebhook.ts`: verify auth, dedup event id, map `INITIAL_PURCHASE`/`RENEWAL`/`CANCELLATION`/`EXPIRATION` + product → `Tier` via new `tierForIapProduct`, call `setTier`. Route it in `index.ts`. Tests mirror `webhookReceiver.spec.ts`.
- [ ] **C3.** Implement the D2 effective-tier resolution (highest active tier across Stripe + RevenueCat) and test the both-sources case.

### Workstream D — Resubmit
- [ ] **D1.** Ensure the paywall is reachable by App Review (sandbox account note); update screenshots if the paywall is shown.
- [ ] **D2.** Build + submit 0.1.1 via EAS; validate a sandbox purchase end-to-end before submitting.

---

## Risks & sequencing

- **Store config is the calendar-time wildcard, not the code.** A2 (Paid Apps Agreement/tax/banking) and subscription-product review can add days independent of implementation speed. **Start Workstream A today** — one review round-trip is already spent and the Shipaton window closes **2026-09-30**.
- **Managed/CNG workflow:** `react-native-purchases` goes in via its Expo config plugin + EAS build; no manual pods. Verify version compatibility at B1.
- **Double-billing** is the main design hazard — D2 must land before D-resubmit.
- **Sandbox testing** needs a sandbox Apple ID; App Review will run a real sandbox purchase, so B/C must be genuinely working, not stubbed.

## Shipaton fit

One integration closes the mandatory RevenueCat gate, re-qualifies for HAMM / Best Monetization, and is the compliant 3.1.1 fix. **Coordinate with the parallel session handling the rejection** so the "sell nothing" (#423) branch and this IAP work don't ship at cross purposes — the IAP path supersedes the sell-nothing workaround.

**Effort:** ~2–4 focused days of code (app ≈ 1.5–2d, cloud ≈ 1–1.5d) + store-config lead time.
