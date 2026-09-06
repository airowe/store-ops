# Story beat — "The first time ShipASO wrote to App Store Connect"

Drafted 2026-09-06 for posting 2026-09-07. **Not posted.** X first, then
Bluesky, then the Shipaton Discord #post-engagement-boost. Record the post
URL in `docs/landing/journey/feed.json` (the 2026-09-06 entry) under
`links.post`.

Every claim below is verified — see "Receipts". Do not add a number that is
not in that list. Voice: first person, plain, no setups.

---

## The thread (X) — tag @RevenueCat, #Shipaton #BuildInPublic

**1/** (attach `first-write.png`)
ShipASO wrote to App Store Connect for the first time yesterday. One
screenshot, onto an unreleased version of a meme app I own, through the
production API. Apple said 200. Here's what the first real write taught me
that four months of unit tests didn't.

**2/**
The upload path had been "done" since July. Reservation, multipart PUT,
checksum commit, all tested against Apple's documented shapes. It had never
made a single call. I'd been careful to write "implemented, never exercised"
on the issue, because the other mistake, calling unexercised code working, is
the one that hurts.

**3/**
First call: 200 in 2.5 seconds, checksum matched, Apple showed the asset as
complete. Good. Then I tried the branch the tests couldn't reach: uploading
to a device size the app had no screenshot set for. That creates the set
first. Also 200. Two branches nobody had ever run, both fine.

**4/**
Then the experiment create. Same care, same tests, same July. Apple: 404,
"the path provided does not match a defined resource type." I'd built the
v2 endpoint on a v1 path. The read side used that path and worked, so every
test believed the write side too. Fixed in an hour. Only a live call could
have found it.

**5/** (attach `agent-writes.png`)
So today the agent can do the writes itself. You approve a run; it finds or
creates the draft version, pushes the copy, pushes each approved locale, and
writes down every step. Screenshots and experiments it still leaves to you,
and it says so on the run instead of quietly skipping.

**6/**
Off by default. Turning it on doesn't touch the 32 runs I'd approved before
the switch existed, because those approvals meant "hand me the commands",
not "push". Each gets a visible line saying so. Approving is still the last
thing a person does. Nothing here submits for review.
shipaso.com/journey

## Short version (Bluesky) — attach `first-write.png`

ShipASO made its first real write to App Store Connect yesterday: one
screenshot onto an unreleased version of an app I own, 200 in 2.5 s. The
upload code had been "done" since July and never called. The experiment
code from the same month came back 404, wrong path, fixed in an hour. Only a
live call finds that. shipaso.com/journey

## Receipts (verified 2026-09-06)

- First upload: `POST /runs/78810ef5…/asc/upload-screenshot` → HTTP 200 in
  2.53 s; asset `1ea4bf76…`, checksum `cc56c4ff…`, read back COMPLETE on
  Snagg 1.0.1 (`APP_IPHONE_67`). Recorded on #374.
- Set-create branch: `POST …/asc/upload-screenshots` to `APP_IPHONE_65`,
  `setCreated: true`, 200 in 3.3 s, asset `ae2a9c62…`, read back COMPLETE.
- Idempotency: same bytes re-sent → `skipped: already present`, zero new
  assets, 1.4 s.
- Experiment create: first attempt 404 "The path provided does not match a
  defined resource type" on `/v1/appStoreVersionExperimentsV2`; fixed in
  #562 (`/v2/appStoreVersionExperiments`); second attempt 200 in 1.8 s,
  experiment `bb37fdba…`, `started: false`.
- "Implemented, never exercised" wording: #374 status comment, 1 month ago.
- Autopilot: PR #564, merged and deployed 2026-09-06; migration 0017;
  32 approved-untouched runs counted in production D1 at that moment.
- Test screenshots deleted afterwards; the experiment remains, stopped.
- Version created: Snagg 1.0.1, PREPARE_FOR_SUBMISSION, never submitted.

## Do NOT claim

- Any download, revenue, or usage number. None was measured.
- That 0.1.1 is approved. It is WAITING_FOR_REVIEW as of 2026-09-06.
- That the agent submits, releases, or starts an experiment. It creates
  experiments stopped and never submits.
- That autopilot is on for anyone. It is off for every account.
