# The two big gates — console runsheet

The only Shipaton work left that code can't do: **Workstream A** (store +
RevenueCat config) and **shipping 0.1.1**. Everything below is a console/device
session for a human; every value is pre-derived from the source so the session
is following, not deciding. Cross-checked against `cloud/src/readiness.ts`,
`cloud/src/billing.ts`, `mobile/app.config.ts`, `mobile/fastlane/Fastfile`, and
`marketing/aso/shipaso/resubmit-0.1.1-checklist.md` (which stays the full
pre-submit checklist — this runsheet is the do-it-now ordering).

**The clock:** the app must be live + downloadable ≥1 week before Sep 30.
Gate 1 starts today because subscription-product review adds calendar days
nothing else can compress. (The Paid Applications Agreement — the usual
longest-lead item — is already in place on this account; see 1a.)

---

## Gate 1 — Workstream A (≈45 min of clicking + wait time)

### 1a. Paid Applications Agreement — already in place (owner-confirmed 2026-08-08)
The agreement is per developer account, not per app, and the owner confirms
it's handled — so this is a 10-second glance, not a task:
- [ ] ASC → Business (Agreements, Tax, Banking): status reads **Active**.
  (Worth the glance because an inactive agreement fails silently as exactly
  the review-killer: `getOfferings()` returns empty → the paywall shows
  "unavailable" → App Review fails 0.1.1 on the spot.)

### 1b. Subscription products in ASC
App Store Connect → ShipASO: Keyword Ranks → Monetization → Subscriptions:
- [ ] Create ONE subscription group: `ShipASO Tiers`.
- [ ] Create 3 auto-renewable subscriptions in it (monthly; prices should match
  the web/Stripe tiers — read them off shipaso.com/pricing.md before entering):

  | Tier | Product ID (use exactly; these strings become the Worker secrets) | Reference name |
  |---|---|---|
  | Indie | `com.shipaso.app.indie.monthly` | ShipASO Indie |
  | Startup | `com.shipaso.app.startup.monthly` | ShipASO Startup |
  | Scale | `com.shipaso.app.scale.monthly` | ShipASO Scale |

- [ ] Each: localized display name + description (the description is shown on
  the paywall — 3.1.2(c)), price, and state **"Ready to Submit"**.
- [ ] Do NOT submit them standalone — they attach to the 0.1.1 version and go
  WITH the binary (first submission of a subscription must).

### 1c. RevenueCat project
dashboard.revenuecat.com:
- [ ] Create project **ShipASO** → add the App Store app (bundle id
  `com.shipaso.app`), connect with an ASC API key when prompted.
- [ ] Import the 3 products from 1b.
- [ ] Create three entitlements — `indie`, `startup`, `scale` — one per tier,
  each attached to its product. (Not a single shared "pro": the server maps
  product→tier 1:1 in `cloud/src/billing.ts`, and the entitlement layout
  should read the same way.)
- [ ] Create one Offering (`default`, set **current**) with the three packages.
- [ ] Copy the **iOS public SDK key** (`appl_…`) — this is `REVENUECAT_IOS_KEY`
  for the build in Gate 2.
- [ ] Project settings → Webhooks: URL `https://api.shipaso.com/billing/revenuecat`,
  Authorization header value = the secret you set in 1d (generate it now:
  `openssl rand -hex 32`).

### 1d. Worker secrets
From `cloud/` on any machine with wrangler auth:
```bash
npx wrangler secret put REVENUECAT_WEBHOOK_AUTH     # the value from 1c's webhook config
npx wrangler secret put REVENUECAT_PRODUCT_INDIE    # com.shipaso.app.indie.monthly
npx wrangler secret put REVENUECAT_PRODUCT_STARTUP  # com.shipaso.app.startup.monthly
npx wrangler secret put REVENUECAT_PRODUCT_SCALE    # com.shipaso.app.scale.monthly
```
- [ ] Verify by name: `npx wrangler secret list | grep REVENUECAT` (check by
  name, not by scrolling — that's how a past incident started).
- [ ] **Prove it:** `curl -s https://api.shipaso.com/health` → both
  `revenuecat_webhook_auth` and `revenuecat_products` read **ok**.

### 1e. Legal URLs (rejection-class if dead)
- [ ] Terms of Use (EULA) + Privacy Policy URLs return **200** (a 404'd link
  already cost 0.1.0 a 2.1(a)). Set the EULA in ASC too (app-level or the
  standard Apple EULA).

---

## Gate 2 — Ship 0.1.1 (Mac + device day)

Version is already **0.1.1** in `mobile/app.config.ts`; build numbers are
minute-stamped by the lane. The full pre-submit detail lives in
`marketing/aso/shipaso/resubmit-0.1.1-checklist.md` — this is the ordering:

- [ ] **Build + upload** (Mac with Xcode; `fastlane/AuthKey_NC235A8728.p8` in
  place): `cd mobile && REVENUECAT_IOS_KEY="appl_…" bundle exec fastlane ios beta`
  — the env var is read at `expo prebuild` time; forgetting it ships an empty
  SDK key and a dead paywall.
- [ ] **TestFlight on a real device** — the four rejection fixes + the IAP path
  (checklist Parts 1–2): magic link opens the app; `getOfferings()` shows 3
  packages; a **sandbox purchase round-trips** (buy → webhook → `GET /me` shows
  the tier); Restore Purchases works; a web-Stripe account sees "managed on the
  web", not a Buy button.
- [ ] **Re-capture ALL screenshots from the 0.1.1 build** (the 2.3.7 fix is in
  source; any old image is stale) — no price/"free" text.
- [ ] ASC: attach the 3 products to the 0.1.1 version · upload screenshots ·
  App Privacy delta (checklist Part 3: Purchases + Identifiers, RevenueCat SDK
  now in the binary) · Notes for Review (checklist Part 4, incl. sandbox
  account) · read **Schedule 2** (checklist top note).
- [ ] **Submit for Review** — the deliberate human click.
- [ ] The moment it's live: journal the launch as a story beat
  (`docs/landing/journey/feed.json`), post it (playbook beat "0.1.1 live"),
  and put the store link into `docs/shipaton/devpost-draft.md`.

---

## Definition of done for both gates

- [ ] `GET /health` → both `revenuecat_*` checks ok (Gate 1 wired).
- [ ] Sandbox purchase → tier upgrade proven on a device (Gate 2 verified).
- [ ] 0.1.1 **live and downloadable** — the Shipaton hard gate — with ≥1 week
  of margin before Sep 30.
