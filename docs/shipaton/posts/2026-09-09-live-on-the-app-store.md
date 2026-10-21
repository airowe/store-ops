# Story beat — "It's on the App Store" (the launch post)

Drafted 2026-09-09 for posting today. **Not posted.** X first, then Bluesky,
then the Shipaton Discord #post-engagement-boost, then the wider channels in
`docs/shipaton/launch-week-runsheet.md`. Record the post URL on the
2026-09-08 journey entry under `links.post`.

This is the "0.1.1 live" beat the playbook has been waiting on since August.
Every claim below is verified — see "Receipts". Voice: first person, plain,
no setups. Attach the App Store product page screenshot (take it from the
live listing today; nothing in the repo is a current capture).

Store link, everywhere: https://apps.apple.com/us/app/shipaso-keyword-ranks/id6787632160

---

## The thread (X) — tag @RevenueCat, #Shipaton #BuildInPublic

**1/**
ShipASO is on the App Store. Two rejections, four guidelines, one bug that
was in our own review notes, and it went live yesterday.

It's an ASO agent: it audits your listing, finds the keywords you can
actually win, writes the copy, and reads the rank back after you ship.

https://apps.apple.com/us/app/shipaso-keyword-ranks/id6787632160

**2/**
What the app does on day one: sign in, add an app, and it runs the audit on
your live listing. Grade, title and subtitle keyword coverage, what your first
three screenshots say, and the terms your competitors rank for that you
don't. Every number is measured from the public listing or shown as a dash.

**3/**
What it does not do: push to the store for you. It proposes, you approve,
it writes the draft version, and then it watches the rank. Approving is the
last thing a human does. That line is in the code, not just the marketing.

**4/**
The road here, all of it public on shipaso.com/journey:
- Jul 29: rejected on four guidelines at once
- Aug 3: subscriptions rebuilt as real in-app purchases
- Aug 24: rejected again, because our review notes sent Apple to a mailbox
  only we could read
- Sep 8: approved

**5/**
If you're in the Shipaton too: reply with your App Store link and I'll post
your listing's measured audit, no signup. And the Startup plan is free for
entrants until Dec 31. Sign in at app.shipaso.com, Settings › Plan, code
SHIPATON26. No card.

## Short version (Bluesky)

ShipASO is live on the App Store. It audits your listing, finds the keywords
you can win, writes the copy, and reads the rank back after you ship. It
never pushes for you; you approve. Two rejections and a public journey to get
here: shipaso.com/journey
https://apps.apple.com/us/app/shipaso-keyword-ranks/id6787632160

## Discord (#post-engagement-boost)

Entrant here: ShipASO (the ASO agent) got approved yesterday and is on the
App Store. If you're live too, drop your store link and I'll post your
listing's measured audit, no signup. Startup plan is free for entrants until
Dec 31: app.shipaso.com → Settings › Plan → SHIPATON26.
https://apps.apple.com/us/app/shipaso-keyword-ranks/id6787632160

---

## Receipts (verified 2026-09-09)

- The listing is public: `GET https://apps.apple.com/us/app/id6787632160`
  redirects to the product page, and the iTunes lookup API returns version
  0.1.1 with `releaseDate` 2026-09-08. ASC version 0.1.1 reads
  `READY_FOR_DISTRIBUTION`.
- The rejection dates and guideline counts are the journey feed entries for
  2026-07-29 and 2026-09-04 (`docs/landing/journey/feed.json`).
- The IAP rebuild is the 2026-08-03 milestone in the same feed.
- "Never pushes for you" is `cloud/src/readiness.ts` and the execution path
  in PR #564: draft-version writes only, review submit is not implemented.
- The audit card states (measured, pending, unavailable, absent) and the
  Shipaton Pass claim are the receipts on the 2026-09-08 audit post.
- Not claimed on purpose: install counts, rank moves, and user numbers.
  Nothing is measured yet for this build.
