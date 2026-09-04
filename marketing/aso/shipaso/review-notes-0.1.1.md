# ShipASO 0.1.1 — Notes for Review

Paste the block below into App Store Connect → the 0.1.1 version → **App Review
Information → Notes**. It is checklist Part 4 of
`resubmit-0.1.1-checklist.md`, written out.

Every claim here was verified against the source or the live API.

**`<REVIEW_TOKEN>` is a placeholder and MUST be replaced before submitting.**
Mint the real value with:

```bash
set -a && . .env && set +a          # SESSION_SECRET + REVIEW_ACCOUNT_EMAIL
npx tsx cloud/scripts/mint-review-token.mts
```

Paste the token it prints into the block below **in App Store Connect only**.
It is a bearer credential that mints a session for the review account for 90
days, so it does not belong in this repository — this file carries the
placeholder, never the token.

> **Why this section was rewritten (2026-09-04).** 0.1.1 was rejected on
> 2026-08-24 under Guideline 2.1(a): "the 'Connect' button was not responsive
> after sign in" (iPad Air 11-inch, iPadOS 26.6). The previous version of this
> note told the reviewer to tap "Send magic link" and open the emailed link —
> but the link goes to a mailbox App Review cannot read, and the note said a
> token was *deliberately* omitted because magic tokens expire in 15 minutes.
> The reviewer had no way to sign in and reported the login screen's controls
> as unresponsive.
>
> `POST /auth/review-exchange` and the "Have a sign-in token?" card were built
> for exactly this (see `mobile/app/(public)/login.tsx:97-108`, whose comment
> records the same failure), and mint a 90-day token that survives review. The
> mechanism existed; the note never carried the token. That is now fixed.

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
   declares both the shipaso.com and app.shipaso.com associated domains and
   handles the /auth/m route, so tapping the emailed link opens the app and
   completes sign-in rather than loading a page in Safari.

4. Guideline 2.3.7 — the price and "free" text that appeared in the app's own
   UI has been removed, and every screenshot in this submission was re-captured
   from the 0.1.1 build.

HOW TO SIGN IN — NO EMAIL REQUIRED

You do not need to receive any email to sign in. Use the sign-in token below.

  1. Launch the app. On the login screen, scroll to the third card:
     "Have a sign-in token?"
  2. Paste this token into the "Paste sign-in token" field:

     <REVIEW_TOKEN>

  3. Tap "Continue". You are signed in immediately as the demo account
     (adaminsley+shipaso-review@gmail.com) — no email, no waiting.

This token is valid for 90 days and is provided specifically for App Review.

The account is on the FREE tier, which is what you want: the purchase screen
only appears for a free account (see below).

Note on the other sign-in option: the "Send magic link" card above sends a
link to a mailbox you cannot open, so please ignore it and use the token
instead. Tapping "Send magic link" without an email address entered does
nothing by design — the button stays disabled until a valid address is typed.

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

- [ ] **`<REVIEW_TOKEN>` is replaced with a freshly minted token.** This is the
      one thing that rejected 0.1.1 on 2026-08-24. Submitting with the
      placeholder unfilled strands the reviewer exactly as before.
- [ ] **The token was minted against the DEPLOYED `SESSION_SECRET`.** The mint
      script verifies the token it prints, but it cannot know whether the
      secret matches production. A token signed with a stale secret fails
      `/auth/review-exchange` and reads to the reviewer as another dead button.
      `SESSION_SECRET` was rotated on 2026-09-04; any token minted before that
      is dead.
- [ ] **Prove it end-to-end before submitting:** paste the token into the
      "Have a sign-in token?" field on a real build and confirm it signs in.
      Do not submit on the assumption that it works.

Two more things to re-verify at submit time, because both drift:

- [ ] **`adaminsley+shipaso-review@gmail.com` is still on the FREE tier.** This
      is load-bearing: a reviewer on a paid tier hits the web-subscriber
      read-only branch (`Paywall.tsx:51-52`), sees no purchase button, and reads
      it as the same "nothing purchasable" 3.1.1 failure that rejected 0.1.0.
      Verified free-tier on 2026-08-10 by reaching the paywall with it.
- [ ] The review account still exists and is on the free tier. The mailbox no
      longer matters for review: the reviewer signs in with the pasted token,
      not with a magic link. (Magic tokens still live 15 minutes —
      `MAGIC_LINK_TTL_SECONDS`, api/index.ts:294 — which is exactly why the
      review path uses the 90-day review token instead.)
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
it still has not been.

Gate 1 is now done — re-verified 2026-09-04:

| Item | State | How it was checked |
|---|---|---|
| Subscription group `ShipASO Tiers` (22297926) | exists | `asc subscriptions groups list --app 6787632160` |
| `com.shipaso.app.{indie,startup,scale}.monthly` | all `READY_TO_SUBMIT` | `asc subscriptions list --group-id 22297926` |
| 4 × `REVENUECAT_*` Worker secrets | all set | `wrangler secret list \| grep REVENUECAT` |
| Webhook live in the deployed Worker | 401, not 503 | unauthenticated `POST /billing/revenuecat` |

The webhook check is the meaningful one: an unset `REVENUECAT_WEBHOOK_AUTH`
makes that route answer 503, so a 401 proves the secret is live in production
and not merely registered.

What remains unproven is the round trip — buy in sandbox on a device, webhook
fires, `GET /me` shows the new tier. **App Review has never seen the paywall.**
Both prior submissions were rejected at sign-in, and in the 2026-08-24
submission the three subscription items were still `READY_FOR_REVIEW`, never
evaluated. The IAP that the RevenueCat integration exists to power has not yet
been exercised by anyone but us.
