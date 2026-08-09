# ShipASO 0.1.1 — Notes for Review

Paste the block below into App Store Connect → the 0.1.1 version → **App Review
Information → Notes**. It is checklist Part 4 of
`resubmit-0.1.1-checklist.md`, written out.

Every claim here was verified against the source or the live API. Two fields are
deliberately left as `<>` placeholders because only a human can supply them —
fill them in before submitting, and do not submit with them unfilled.

---

## The block to paste

```text
Thanks for re-reviewing ShipASO. Version 0.1.1 addresses all four items from the
0.1.0 rejection. Notes on each, then how to reach the purchase screen.

WHAT CHANGED SINCE 0.1.0

1. Guideline 5.2.5 — the app name no longer contains an Apple trademark. It is
   now "ShipASO: Keyword Ranks", subtitle "ASO Audit & Rank Tracker".

2. Guideline 3.1.1 — subscriptions are now sold IN THE APP via StoreKit
   (through RevenueCat). 0.1.0 removed purchasing entirely; that was the wrong
   fix. There are three auto-renewable subscriptions in one group: Indie,
   Startup, and Scale (monthly).

   The website (shipaso.com) sells the same three tiers via Stripe. The app
   NEVER links to web checkout and contains no steering language — this is
   enforced by an automated test that fails our build if such a path is added.
   A user who subscribed on the web sees a read-only "managed on the web"
   status instead of a purchase button, so they are never charged twice.

3. Guideline 2.1(a) — the magic-link sign-in no longer dead-ends. The app now
   declares the shipaso.com associated domain and handles the /auth/m route, so
   tapping the emailed link opens the app and completes sign-in rather than
   loading a 404 in Safari.

4. Guideline 2.3.7 — the price and "free" text that appeared in the app's own
   UI has been removed, and every screenshot in this submission was re-captured
   from the 0.1.1 build.

HOW TO SIGN IN

Sign-in is passwordless. Enter an email on the login screen and tap "Send magic
link", then tap the link in the email to return to the app.

If you prefer not to use an inbox, use this demo account: <DEMO ACCOUNT EMAIL>
A sign-in token for it is: <SIGN-IN TOKEN>
Paste that token into the "Paste magic-link token" field on the login screen and
tap Continue — this signs in without needing email access.

HOW TO REACH THE PURCHASE SCREEN

The paywall is on the tier-gated screens. Either of these reaches it from a
free account:

  • Portfolio tab — gated, renders the paywall directly.
  • Any app → "War room" — same gate.

The purchase screen shows, for each tier: the price per period, that it renews
automatically until cancelled, where to cancel, what the tier includes, and
links to the Terms of Use (EULA) and Privacy Policy. "Restore Purchases" is on
the same screen.

ONE THING THAT LOOKS LIKE A BUG AND IS NOT

ShipASO reports App Store keyword ranks. When a value has not been measured, the
app renders an em dash ("—") rather than a zero or a placeholder number. Empty
dashes on a fresh account are intentional and are the product's core promise:
every number shown is measured, or it is explicitly absent. A new account with
no completed rank check will show several of these.

Thank you — happy to provide anything else that would help.
```

---

## Before you paste

- [ ] **`<DEMO ACCOUNT EMAIL>`** — create the account, then confirm it is on the
      **free** tier. A reviewer signed in on a paid tier sees the read-only
      "managed on the web" state and cannot complete a purchase, which reads as
      a broken paywall.
- [ ] **`<SIGN-IN TOKEN>`** — generate a long-lived token for that account. If
      tokens in this environment expire quickly, delete those two lines and
      leave email sign-in as the only route rather than shipping a token that
      is dead by the time review opens the build.
- [ ] Confirm the three subscription display names in ASC read exactly
      **Indie / Startup / Scale**. The note names them; a mismatch invites a
      metadata question.

## Sources

Written from verified state, not from the campaign docs:

- Name / subtitle — `asc localizations list --app 6787632160 --type app-info`
  (live: "ShipASO: Keyword Ranks" / "ASO Audit & Rank Tracker")
- Gated screens — `mobile/app/(app)/portfolio.tsx:48` and
  `mobile/app/(app)/war-room/[id].tsx:36`, both rendering `TierGate`
- No web-checkout steering — `packages/docpaths/noIapPurchasePath.test.mjs`,
  5/5 passing
- Disclosures on the purchase screen — `mobile/src/components/Paywall.tsx`,
  guarded by the "subscription disclosure" case in `Paywall.test.tsx`
- Web-subscriber read-only state — `Paywall.tsx:51-52`
- Token sign-in affordance — `mobile/app/(public)/login.tsx:97-108`
- Associated domain / `/auth/m` — AASA at shipaso.com returns 200 with
  `content-type: application/json`

## What this note deliberately does NOT claim

The draft says nothing about the sandbox purchase having been exercised, because
at the time of writing it has not been: ASC has zero subscription products and
zero subscription groups, and the Worker has none of the four `REVENUECAT_*`
secrets set. **Do not submit until Gate 1 is done** — a reviewer who opens the
paywall against an empty Offering sees "unavailable", which fails 3.1.1 again on
the same guideline.
