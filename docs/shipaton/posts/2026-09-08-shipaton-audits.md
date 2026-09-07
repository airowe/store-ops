# Story beat — "Reply with your App Store link" (the Shipaton Pass, and the daily audit)

Drafted 2026-09-07 for posting 2026-09-08. **Not posted.** X first, then
Bluesky, then the Shipaton Discord #post-engagement-boost. This one is a
standing offer: it gets pinned, and every audit post from here to September
30 quotes it. Record the post URL on the 2026-09-07 journey entry under
`links.post`.

Every claim below is verified — see "Receipts". Voice: first person, plain,
no setups.

---

## The offer (X) — tag @RevenueCat, #Shipaton #BuildInPublic

**1/**
I'm building a Shipaton app too. Mine's an ASO agent, so here's a trade for
everyone else in the hackathon: reply with your App Store link and I'll post
your listing's measured audit. Real numbers from the public listing, no
signup, no pitch. One a day until the deadline.

**2/**
What you get back: the audit card. Title and subtitle keyword coverage, what
your screenshots' first three say, which of your competitors' terms you're
missing, and a grade. Every number is measured from the live listing or shown
as a dash. No volume scores, because nobody has an honest source for those.

**3/**
If you want it to do the work instead of just telling you: the Startup plan
is free for Shipaton entrants until December 31. Sign in at app.shipaso.com,
Settings › Plan, code SHIPATON26. No card. It proposes, you approve, it
writes to your draft version, then it reads the rank back.
shipaso.com/#shipaton

## Short version (Bluesky)

Building a Shipaton app? Reply with your App Store link and I'll post its
measured audit. Real numbers, no signup. And the Startup plan is free for
entrants until Dec 31: app.shipaso.com, Settings › Plan, code SHIPATON26.
shipaso.com/#shipaton

## Discord (#post-engagement-boost)

Entrant here, building an ASO agent (ShipASO). Offer for anyone who's
already live: drop your App Store link and I'll post your listing's audit,
measured from the public page, no signup. And the Startup plan is free for
Shipaton entrants until Dec 31: app.shipaso.com → Settings › Plan → code
SHIPATON26. Nothing charged, ever.

---

## The daily audit post — template (one per reply, 09-08 → 09-30)

Attach the audit card screenshot from the no-signup preview
(`shipaso.com/report?...` for the app). Fill only what the card shows.

> Shipaton audit of the day: **<App name>** by @<maker>.
> Grade <X>. Title covers <n> of its own top terms; subtitle <n>. First three
> screenshots say: "<caption 1>", "<caption 2>", "<caption 3>".
> Missing from the listing that a competitor ranks for: <term>, <term>.
> Fix is one approve away if you want it. #Shipaton

Rules for the template:

- A number appears only if the card shows it. A dash on the card is a dash
  in the post, or the line is dropped.
- Never a rank claim ("would rank higher"). The card doesn't know that and
  neither do I.
- Never a comparison to another entrant's grade.
- Tag the maker only if they replied with the link themselves.
- Each post links back to the offer thread, never to a checkout.

## Receipts (verified 2026-09-07)

- `POST /billing/claim` grants Startup until 2026-12-31 to a signed-in account
  that types SHIPATON26; a paid Startup/Scale account is refused (409), a
  wrong code 400, after 2026-10-13 410. `cloud/src/engine/shipatonPass.ts`,
  spec 11 tests; route spec 7 tests.
- The claim field is in Settings › Plan (`PlanCard.tsx`, 7 tests). The plan
  row shows "Shipaton Pass until 2026-12-31" from `/auth/me`.
- Expiry: the hourly cron demotes `comped*` rows past their end date
  (`expireCompedPasses`, 4 tests against the real schema).
- The public preview needs no account: `preview_app` on the MCP front door
  and the report page. Every card number is measured or a dash (audit card
  states: measured, pending, unavailable, absent).
- "No volume scores": pricing.md, "there is no keyword volume or difficulty
  score, because no honest measured source exists for one."
- Shipaton dates: deadline 2026-09-30 11:45pm PDT; judging Oct 1–13; winners
  Oct 21 (shipaton.dev rules, read 2026-09-06).

## Do NOT claim

- That any entrant has claimed the pass, until one has (count it in D1).
- That the audit predicts a rank.
- That the agent submits, releases, or starts an experiment.
- Any download, revenue, or usage number.
