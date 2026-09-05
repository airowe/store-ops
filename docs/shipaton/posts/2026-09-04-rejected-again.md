# Story beat — "Rejected again, and the bug was in the instructions"

Drafted 2026-09-04. Post to X first, then Bluesky, then drop the link in the
Shipaton Discord **#post-engagement-boost**. Record the post URL in
`docs/landing/journey/feed.json` (the 2026-09-04 entry) under `links.post`.

Every claim below is verified — see "Receipts" at the bottom. Do not add a
number that is not in that list.

---

## The thread (X)

**1/**
Apple rejected ShipASO again. Guideline 2.1(a): "the Connect button was not
responsive after sign in."

We spent the morning hunting a broken button. The button was fine.

The bug was in the instructions we wrote for the reviewer. 🧵

**2/**
ShipASO has no passwords. You type your email, we send a magic link, you tap it.

Our notes to App Review said: sign in with adaminsley+shipaso-review@gmail.com,
tap "Send magic link", then open the email.

Read that again. Open *which* email?

**3/**
That mailbox is mine. The reviewer cannot open it.

They had no way in. They tapped the buttons on the login screen, nothing
happened, and they wrote it up as unresponsive.

They were right. That's exactly what it is from where they were sitting.

**4/**
Here's the part that stings.

After our *previous* rejection we built the fix: a 90-day sign-in token that
survives a review cycle, plus a "Have a sign-in token?" field on the login
screen, put there for exactly this reviewer.

**5/**
The code shipped. The comment above it literally says it exists because App
Review can't read our mailbox.

Nobody put a token in the notes.

Two review rounds burned on a documentation gap standing in front of a working
feature.

**6/**
So today: minted the token, verified it against production (not just locally —
the round trip returns a real session), then signed in on an iPad simulator and
watched the dashboard load.

The Connect screen we suspected? Renders fine on iPad. Never was the problem.

**7/**
Lesson I keep re-learning: when a system rejects you, read what you actually
told it to do before theorising about your own internals.

We had a bug report pointing at a button and the real defect was a paragraph of
English.

**8/**
Fixed: the notes now lead with the token, no email required. Registry records
both rejections. The whole thing is on the public journey page.

Wins and losses both go up here — that's the deal.

shipaso.com/journey

---

## Short version (Bluesky / single post)

Apple rejected us again: "Connect button not responsive after sign in."

Spent the morning hunting a broken button. The button was fine.

Our review notes told the reviewer to sign in by opening a magic link — sent to
a mailbox only I can read. They had no way in, so they reported the login
screen as broken. Correct call.

Worst part: we'd already built the fix after the last rejection — a 90-day
review token and a paste field for it. Code shipped. Nobody put the token in
the notes.

Two review rounds lost to a documentation gap in front of a working feature.

shipaso.com/journey

---

## Receipts (verified 2026-09-04 — do not post a claim that is not here)

- Rejection: submission `8d82affb-5cfa-4578-a4d0-f0c4d718298c`, submitted
  2026-08-20, rejected 2026-08-24, Guideline 2.1(a), iPad Air 11-inch (M3),
  iPadOS 26.6, build `202608192254`.
- Review token round trip: `POST /auth/review-exchange` on api.shipaso.com →
  **HTTP 200**, kind `review`, correct account, expires 2026-12-03.
- iPad sign-in: iPad Pro 13 simulator, signed in as the review account,
  dashboard + "Connect an app" rendered correctly.
- The pre-existing fix: `mobile/app/(public)/login.tsx:97-108` (the card and its
  comment) and `POST /auth/review-exchange` in `cloud/src/api/index.ts`.
- 0.1.0's earlier four-guideline rejection is already public in the journey feed
  (2026-07-29) — this beat is the follow-up, not a repeat.

## Do NOT claim

- That 0.1.1 is live or approved. It is **rejected**, pending rebuild + resubmit.
- Any download, revenue, or rank number. None was measured for this beat.
- That the sandbox purchase round trip works. **It has not been exercised** —
  App Review has never reached the paywall.
- That the agent ships to the store on its own. Approving is not shipping.
