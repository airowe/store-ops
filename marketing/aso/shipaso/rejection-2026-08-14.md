# Rejection — ShipASO: Keyword Ranks 0.1.1 (2026-08-14)

Submission `8d82affb-5cfa-4578-a4d0-f0c4d718298c` · reviewed on iPhone 17 Pro Max
and iPad Air 11-inch (M3), iOS/iPadOS 26.6 · build 0.1.1 (202608101517).

## Cited

- **Primary: Guideline 2.1(a) — Performance: App Completeness** (reasonCode
  `2.1.0`), 2026-08-14. This is the live blocker.
- Secondary (already resolved): **Guideline 3 — Business: Preamble** (reasonCode
  `3.0.0`), 2026-08-10 — an automated price-confirmation hold on Scale at
  $65.00/mo against a $39.99 threshold. Answered 2026-08-11; review proceeded.
  No action needed.

## Rule

Apple's 2.1 App Completeness text — quoted from the reviewer's own message
rather than the public guidelines page, since that is what we are answering:

> The app still exhibited one or more bugs that would negatively impact users.

The reviewer's specific bug description:

> We were unable to access the app after entering the provided email address.

Exact current wording of the public 2.1 section is not confirmed here — see
https://developer.apple.com/app-store/review/guidelines/#performance

## Likely trigger

The app uses **passwordless magic-link sign-in**. The reviewer entered
`adaminsley+shipaso-review@gmail.com`, landed on the "a sign-in link is on its
way — open it on this device" screen (their attached screenshot,
`Screenshot-0814-102903.png`, device clock **19:29 Thu 13 Aug**), and stopped.

**The email was delivered.** A sign-in link went to that exact address at
**2026-08-14 02:24:18 UTC = 19:24 PDT Aug 13** — five minutes before the
reviewer's screenshot. It was in the inbox while they were looking at the
waiting screen.

So this is not a delivery failure. The failure is that **the reviewer had no
access to the inbox.** `adaminsley+shipaso-review@gmail.com` is a plus-address
on a private Gmail account. Nothing in the review notes could have given them
the link, and the link **expires in 15 minutes** — so even a forwarded credential
would likely have gone stale mid-review.

Two aggravating factors:

1. **Sender domain is `login@snagg.meme`** — unrelated to ShipASO, an unusual TLD,
   and a plausible spam-filter and trust problem regardless of the access issue.
   (`RESEND_FROM` in the deployed worker.)
2. **The screenshot shows a "Have a sign-in token? (dev)" field** shipped in the
   reviewed build — a dev affordance visible in production, which is itself
   2.1-adjacent surface area.

## Recommended path — fix & resubmit (your call)

Appeal is weak here. The reviewer's account of what they observed is **accurate**:
they entered the email and could not get in. Arguing the email "was delivered" is
technically true and practically irrelevant — it was delivered somewhere they
could not read. An appeal asks Apple to re-run a test that will fail identically.

The fix is a review path that does not depend on an inbox. Options, roughly in
order of how well they hold up in review:

- **A demo account with a fixed credential** documented in App Review notes —
  the conventional answer, and what reviewers expect.
- **A review bypass code** accepted at sign-in for one known address, gated to
  that address.
- The existing `(dev)` token field, **only** if a valid non-expiring token is
  supplied in the review notes — but shipping a dev-labelled field to production
  invites its own scrutiny. Prefer removing it and doing one of the above.

Also worth fixing before resubmission regardless of path: the `login@snagg.meme`
sender domain, and the empty `whatsNew` for en-US that `asc review doctor` flags.

This is a starting recommendation — you know the build and the history.

## Draft — fix & resubmit

> Hello,
>
> Thank you for the detailed report and the screenshot — they identified the
> problem precisely.
>
> ShipASO uses passwordless email sign-in. When your reviewer entered the address
> we provided, the app sent a sign-in link to that mailbox. Because that mailbox
> is not one App Review can open, there was no way to complete sign-in from the
> review device. The waiting screen in your screenshot is the app behaving as
> designed, but the design left the reviewer with no way forward. That was our
> oversight, not a defect your reviewer could have worked around.
>
> In build [BUILD NUMBER] we have [DESCRIBE THE FIX — e.g. "added a demo account
> that signs in directly with a fixed password, with no email step"].
>
> Credentials for review:
> - [SIGN-IN METHOD AND CREDENTIALS]
> - [ANY ADDITIONAL STEPS]
>
> We have verified this on [DEVICES TESTED] running [OS VERSIONS], installing
> fresh as your guidance describes.
>
> [IF APPLICABLE: We have also changed the sign-in sender domain to
> [NEW DOMAIN] so the message is clearly attributable to ShipASO.]
>
> Please let us know if anything else would help.

## Draft — appeal (not recommended; use only if the fix path is wrong)

> Hello,
>
> We would like to provide additional context on the 2.1(a) citation for
> submission 8d82affb-5cfa-4578-a4d0-f0c4d718298c.
>
> [STATE THE FACTUAL BASIS — note that our position is that the sign-in email was
> delivered at 19:24 local on August 13, approximately five minutes before the
> attached screenshot was taken.]
>
> [EXPLAIN WHY YOU BELIEVE THE REVIEWER COULD HAVE COMPLETED SIGN-IN — this is
> the load-bearing claim, and it is the weak point: the mailbox was not one App
> Review controls, and the link expires in 15 minutes.]
>
> [STATE WHAT YOU ARE ASKING FOR.]
>
> We appreciate your reconsideration.

## Next

Run **aso-review-risk** across the rest of the listing before resubmitting — a
2.1 citation for one blocked path usually means other reviewer-facing paths were
never exercised either.

---

# Resubmission kit (2026-08-19)

Written after building the fix. **One correction to the analysis above:** the
0.1.1 build already shipped a working no-email sign-in path — the paste-token
card called `/auth/exchange` and would have signed the reviewer straight in. It
was labelled "Have a sign-in token? (dev)", so the reviewer reasonably ignored a
field marked as a developer affordance. The path existed; the label hid it. The
notes below therefore lead with the paste step rather than the email step.

## What shipped

- `review` token kind (`cloud/src/auth.ts`) — audience-separated, long-TTL, so a
  credential can survive in the review notes. Magic tokens' 15-minute TTL is what
  made this impossible before.
- `POST /auth/review-exchange` — trades that token for an ordinary session, no
  email round-trip. Fail-closed twice: must verify as kind `review`, AND must
  resolve to `REVIEW_ACCOUNT_EMAIL`. Unset → the route is dead for every input.
- Mobile `redeemPastedToken` — tries the review route, falls back to magic, so one
  field serves both reviewers and developers.
- Login copy — "(dev)" replaced with an explicit App Review instruction.

Gates: cloud 2647/2647, mobile 468/468, typecheck clean both packages.

## Replacement for the "HOW TO SIGN IN" section of the review notes

Replaces everything from "Sign-in is passwordless" through "…within the window."
Leave the rest of the notes as they are. `[PASTE TOKEN]` is the output of
`cd cloud && npx tsx scripts/mint-review-token.mts`.

> HOW TO SIGN IN — NO EMAIL REQUIRED
>
> Sign-in is passwordless, so there is no password to give you. Instead we have
> included a sign-in token you can paste directly. This takes about ten seconds
> and needs no access to any mailbox.
>
>   1. Launch the app. On the login screen, scroll to the card headed
>      "Have a sign-in token?".
>   2. Paste this token into the field and tap "Continue":
>
>      [PASTE TOKEN]
>
>   3. You are signed in. No email, no link, no waiting.
>
> The token is valid until [EXPIRY DATE] and signs in to a free-tier account —
> which is the account state you want, because the purchase screen only appears
> for a free account (see below).
>
> Why not email: our sign-in links are delivered to the account holder's mailbox,
> which you have no way to open, and the emailed links expire 15 minutes after
> they are sent. In our previous submission we asked you to use the email flow,
> which left your reviewer unable to proceed. That was our mistake and the token
> above is the fix. The email flow still works normally for end users.
>
> If the token is rejected for any reason, contact support@shipaso.com and we
> will issue a replacement immediately.

## Resolution Center reply

> Hello,
>
> Thank you for the detailed report and for including the screenshot — together
> they identified the problem exactly.
>
> You are right that the app could not be accessed. ShipASO uses passwordless
> sign-in, so entering the email address triggers a sign-in link sent to that
> mailbox. The mailbox we named is not one App Review can open, and our sign-in
> links expire 15 minutes after they are sent. Our review notes asked you to use
> that flow, which left no way to complete sign-in on the review device. That was
> our error, not something your reviewer could have worked around.
>
> We have addressed it in build [BUILD NUMBER]:
>
> - The app now accepts a long-lived sign-in token that can be pasted directly on
>   the login screen, with no email step. A valid token is included in the updated
>   App Review Information notes.
> - The card that accepts it was previously labelled "(dev)", which understandably
>   read as a developer-only affordance. It is now labelled for App Review with
>   explicit instructions.
>
> To sign in: launch the app, scroll to "Have a sign-in token?" on the login
> screen, paste the token from the review notes, and tap "Continue". Sign-in
> completes immediately on-device.
>
> We have verified this on [DEVICES TESTED] running [OS VERSIONS], installing
> fresh as your guidance describes.
>
> Please let us know if anything else would help.

## Still open (not blockers, worth doing)

- **Sign-in sender is `login@snagg.meme`** — unrelated domain on an unusual TLD.
  Independent of this rejection, it is a deliverability and trust liability for
  real users, whose links all come from it.
- **`whatsNew` is empty for en-US** — flagged by `asc review doctor`.
- **No promotional images** on the three subscriptions — only matters for App
  Store promotion or offer codes.
