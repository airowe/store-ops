# Local posting runsheet — first four #BuildInPublic beats

Run from a machine that has the Bluesky app password (and your X login in a
browser). Everything referenced is in the repo: texts in
`marketing/social/2026-08-09/beats/`, media in `marketing/social/2026-08-09/`,
poster script `scripts/post-beat.mjs` (thin CLI over the tested postedge
Bluesky lib — refuses over-cap text/images, never truncates).

## 0. One-time setup

```bash
export BSKY_HANDLE="shipaso.com"          # the verified domain handle
export BSKY_APP_PASSWORD="xxxx-xxxx-..."  # Settings → Privacy and Security → App Passwords
```

## 1. Bluesky — one command per beat (from repo root)

```bash
node scripts/post-beat.mjs --text marketing/social/2026-08-09/beats/beat-1.txt \
  --image marketing/social/2026-08-09/journey-ledger.png \
  --alt "Timeline of the ShipASO build journey: Claude brain, posting edge, RevenueCat subscriptions, and the four-guideline App Store rejection"

node scripts/post-beat.mjs --text marketing/social/2026-08-09/beats/beat-2.txt \
  --image marketing/social/2026-08-09/rejection-card.png \
  --alt "Card: Apple rejected 0.1.0 on four guidelines — trademark in name, nothing purchasable, 404 magic link, price text in screenshots. All four fixed in 0.1.1"

node scripts/post-beat.mjs --text marketing/social/2026-08-09/beats/beat-3.txt \
  --image marketing/social/2026-08-09/journey-ledger.png \
  --alt "The journey timeline with 'The agent's brain is now Claude' as the latest milestone"

node scripts/post-beat.mjs --text marketing/social/2026-08-09/beats/beat-4.txt \
  --image marketing/social/2026-08-09/set-montage.png \
  --alt "Three framed App Store screenshots rendered by ShipASO: spotlight, editorial, and story-after-the-screen layouts with green brand accents"
```

Each prints `url=https://bsky.app/...` — record it in the checklist below.
Cadence: beat 1 today (pin it on the profile), then one per day.

## 2. X — manual paste (decided: no paid API)

Per beat: open x.com → paste the SAME text file's contents → attach the same
image (beat 4: attach `shipshots-set.mp4` instead — X takes the video) → post.
Optionally prefix RevenueCat with `@` on X only (the mention resolves there).
Pin beat 1. Record each URL below.

## 3. Checklist (fill in as you go)

| Beat | Bluesky URL | X URL |
|---|---|---|
| 1 — intro (pinned both) | | |
| 2 — rejection story | | |
| 3 — Claude brain | | |
| 4 — ShipShots loop | | |

Wins are NOT posted this way — the automated pipeline (postedge → bsky-post /
--mark-posted) owns those, and only a measured rank win triggers it.

## Prompt for the local Claude Code session

> In the store-ops repo, read docs/shipaton/local-post-runsheet.md and walk me
> through it: check I have BSKY_HANDLE and BSKY_APP_PASSWORD set (never print
> the password), then run the four scripts/post-beat.mjs commands from section
> 1 one at a time, confirming with me before each post and collecting the
> printed url= values. For X, show me each beat's text to copy and tell me
> which media file to attach (beat 4 uses shipshots-set.mp4). When done, fill
> the section-3 checklist table with the real URLs, commit that edit on a
> fresh branch off main, push, and open a PR. Do not post anything twice, do
> not edit the beat texts, and stop and ask me if any post command errors.
