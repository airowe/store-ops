# ShipASO 0.1.1 — App Store resubmit checklist (RevenueCat IAP)

Resubmitting after the **2026-07-29 rejection of 0.1.0** (submission
`a64749cd`, four guidelines — see `rejection-2026-07-29.md`). The big change vs.
0.1.0: the app now **sells subscriptions via in-app purchase (RevenueCat)** rather
than removing purchasing. That is the compliant 3.1.1 fix Apple named, and it
opens a new review surface (3.1.2 / auto-renewable subscriptions) that 0.1.0
never had.

> **Supersedes `submission-prep.md §6`**, which still says "no IAP, purchase on
> the web." That is no longer true. §1–5, 7–8 of `submission-prep.md` (privacy,
> age rating, encryption, the submit sequence) still apply except where updated
> below (App Privacy now has an SDK to declare).

> ⚠️ **Read Schedule 2 of the Apple Developer Program License Agreement before
> the final submit.** The auto-renewable-subscription presentation requirements
> derive from it; only 3.1.2(c) and 5.1.1(i) were confirmable from the public
> guidelines. This checklist covers the standard requirements but is not a
> verbatim Schedule 2 audit.

---

## Part 1 — Close the four 0.1.0 rejections (verify each is actually fixed)

| # | Guideline | Fix | Verify before submit |
|---|---|---|---|
| 1 | **5.2.5** IP | App name → "ShipASO: Keyword Ranks" ("App Store" mark removed) | [ ] Live app name in ASC carries **no** Apple mark ("App Store", "iPhone", …) in name/subtitle. Metadata-only — already live. |
| 2 | **3.1.1** Payments | Purchasing now via **RevenueCat IAP** (#427, #431, #432), replacing the sell-nothing workaround (#423) | [ ] See Part 2 — the whole IAP path must work end-to-end. This is the load-bearing change. |
| 3 | **2.1(a)** Completeness | Assoc. file served from `shipaso.com` + `MAGIC_LINK_BASE` set (#421); `/auth/m` deep-link route so a tapped link isn't a 404 (#425) | [ ] On a **real device**, tap a magic link from Mail → it opens the app and signs in (not Safari, not a 404). [ ] `curl -sI https://shipaso.com/.well-known/apple-app-site-association` → 200 + `application/json`. |
| 4 | **2.3.7** Metadata | "free"/price text removed from the screens captured into screenshots (#422) | [ ] **Re-capture all screenshots from the 0.1.1 build** — the fix is in source; any uploaded image from an older build is stale. No "free"/price text as the app's own on-screen UI. |

---

## Part 2 — The IAP path (new surface; the reviewer failed 0.1.0 on payments)

**Store / RevenueCat config must be live first (Workstream A) or the reviewer
sees a broken purchase screen:**

- [ ] **Paid Applications Agreement active** + banking/tax complete in ASC. *Until
  this is active, `getOfferings()` returns empty → the paywall shows its
  "unavailable" state → a reviewer opening the upgrade screen sees no products.
  This alone fails review.*
- [ ] **3 auto-renewable subscription products** created in ASC (indie / startup /
  scale) under one subscription group, each in **"Ready to Submit"**, with
  localized display name + duration + price, and **attached to the 0.1.1 version**
  (the first submission of a subscription must go **with** the binary).
- [ ] **RevenueCat project** wired: App Store app added, products imported,
  entitlement(s) defined, one Offering assembled and set **current**.
- [ ] **Keys/secrets set** (matches `readiness.ts` — hit `GET /health`, expect
  `revenuecat_webhook_auth` + `revenuecat_products` **ok**):
  - [ ] `REVENUECAT_IOS_KEY` in the EAS build env (`app.config` `extra.revenueCat.ios`).
  - [ ] Worker secrets `REVENUECAT_WEBHOOK_AUTH` + `REVENUECAT_PRODUCT_{INDIE,STARTUP,SCALE}` (product ids that match ASC).
  - [ ] RevenueCat dashboard webhook → `https://api.shipaso.com/billing/revenuecat` with the Authorization value == `REVENUECAT_WEBHOOK_AUTH`.
- [ ] **Terms of Use (EULA)** + **Privacy Policy** URLs return **200** (not 404).
  The paywall renders no link when a URL is unset (`legalUrls.ts`), but Apple
  **requires** both to be present + functional for auto-renewable subs, and a
  link to a 404 is its own rejection (0.1.0 ate a 2.1(a) for a dead link). Set
  the EULA link in ASC (App-level or the standard Apple EULA) too.

**Functional verification on a real device / TestFlight build (cannot be done in
CI):**

- [ ] `getOfferings()` returns the 3 packages; the paywall renders Buy buttons
  (not "unavailable").
- [ ] **Sandbox purchase completes** end-to-end with a sandbox Apple ID → the
  RevenueCat webhook fires → `GET /me` shows the upgraded `tier` (the whole
  reconciliation, tested in `d1.revenuecatIap.spec.ts`, exercised for real).
- [ ] **Restore Purchases** works from the paywall (`paywall-restore`).
- [ ] The **disclosures** show on the purchase screen (#431): price **per period**,
  auto-renewal + where-to-cancel, what the tier **includes**, Terms + Privacy
  links. (Guard: `Paywall.test.tsx` "subscription disclosure".)
- [ ] **No web-checkout steering** anywhere in the app (3.1.3). Guard:
  `packages/docpaths/noIapPurchasePath.test.mjs` (rewritten in #432) —
  `node --test` it stays green.
- [ ] A **web (Stripe) subscriber** who signs in sees the read-only "managed on the
  web" state, **not** a second charge (D1/D2 policy).

---

## Part 3 — App Privacy delta (RevenueCat is now a third-party SDK)

0.1.0's posture was "no third-party SDKs." **That changed** — `react-native-purchases`
now ships in the binary. Update the ASC **App Privacy** questionnaire:

- [ ] **Purchases** → declare **Purchase History** collected, **linked** to the
  user, used for **App Functionality** (entitlement/tier). RevenueCat is the
  processor.
- [ ] **Identifiers** → RevenueCat uses an app-user id (our user id) + an
  anonymous id; declare per RevenueCat's current privacy guidance. **Not used for
  tracking** (no ATT prompt needed as long as nothing is shared for cross-app
  tracking).
- [ ] Everything else unchanged from `submission-prep.md §3` (email for sign-in;
  credentials never persisted; no ads/analytics).
- [ ] Confirm **account deletion** path exists (Apple requires it for apps with
  accounts — `submission-prep.md` / STORE.md §4 flagged this as an open item).

---

## Part 4 — Review notes (write these into the ASC "Notes for Review" field)

- [ ] State plainly: **subscriptions are sold in-app via StoreKit** (RevenueCat).
  The web (shipaso.com) also sells the same tiers via Stripe; the app **never
  links to web checkout**. A user who subscribed on the web sees a read-only
  status, not a purchase button.
- [ ] Provide a **demo / sandbox account** (or a note on how to reach the paywall)
  so the reviewer can complete a purchase — the paywall is on the tier-gated
  screens (Portfolio / locked cards).
- [ ] Note the **2.1(a) fix**: magic-link sign-in now returns to the app via the
  `shipaso.com` associated domain + `/auth/m`.
- [ ] Note the **honesty model** (unmeasured values render "—"/"?"): it is
  intentional, not missing data.

---

## Part 5 — Build & submit sequence (updated from `submission-prep.md §7`)

> ⚠️ **The iOS pipeline is FASTLANE, not EAS** (`mobile/fastlane/Fastfile`,
> #247). `mobile/eas.json` exists and `eas whoami` succeeds, so EAS looks like
> the path — it is not: EAS previously generated orphan signing certs. The
> `beta` lane builds AND uploads the same verified binary; signing is `match`
> (readonly) with ASC API-key auth (no 2FA), and build numbers are
> minute-stamped automatically by the lane.

```bash
# A. Build + upload 0.1.1 to TestFlight in one pass (runs on a Mac with Xcode;
#    needs fastlane/AuthKey_NC235A8728.p8 in place, git-ignored).
#    REVENUECAT_IOS_KEY must be exported: mobile/app.config.ts reads it at
#    `expo prebuild` time — without it the binary ships an empty SDK key and
#    the paywall shows its "unavailable" state (a guaranteed re-rejection).
#    The lane now aborts before prebuild rather than building one of these,
#    so sourcing .env is all that is required.
cd mobile && set -a && . ../.env && set +a && fastlane ios beta
#    Artifact: mobile/builds/ShipASO.ipa; upload_to_testflight does NOT submit
#    for review (deliberate).

# B. In ASC on the 0.1.1 version:
#    - ATTACH the 3 subscription products to this version (first-time subs go WITH the binary)
#    - upload the RE-CAPTURED screenshots (no "free"/price text)
#    - App Privacy: add the Purchases/Identifiers declarations (Part 3)
#    - Age Rating + encryption: unchanged (submission-prep §4–5)
#    - Notes for Review: paste Part 4
#    (version is already 0.1.1 in mobile/app.config.ts; the build number is
#    minute-stamped by the lane, so every build is NEW — no manual bump)

# C. Final "Submit for Review" — a deliberate human click in ASC.
```

---

## Blockers that are yours (external gates)

1. **Workstream A** — Paid Apps Agreement + the 3 subscription products +
   RevenueCat project + all keys/secrets. **Nothing in Part 2 works until this is
   done**; start with the Agreement (longest lead time).
2. **Terms + Privacy pages live** at real URLs (200).
3. **A device / sandbox Apple ID** to run the real purchase + magic-link tests in
   Part 2.
4. **Read Schedule 2** (top of this doc) before the final submit.
5. The **EXPO_TOKEN** repo secret for the CI build (per `submission-prep §8`).

---

## Definition of done (all green before "Submit for Review")

- [ ] `GET /health` → `ready: true`, and both `revenuecat_*` checks **ok**.
- [ ] Sandbox purchase → tier upgrade round-trips on a device.
- [ ] Screenshots re-captured from the 0.1.1 build; no price/"free" text.
- [ ] Magic-link tap returns to the app on a device.
- [ ] `noIapPurchasePath` guard green; mobile + cloud suites green.
- [ ] Review notes written; subscription products attached to the version.
- [ ] Schedule 2 read; Terms + Privacy URLs 200.
