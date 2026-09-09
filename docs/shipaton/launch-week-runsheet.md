# Launch week runsheet — 0.1.1 is live, 0.1.2 is next

0.1.1 was approved and released on 2026-09-08. Store link:
https://apps.apple.com/us/app/shipaso-keyword-ranks/id6787632160

This is the do-it-now ordering for the week after approval. It follows the
playbook (`docs/shipaton/buildinpublic-playbook.md`): X first, then Bluesky,
then the Discord channel, reply to every substantive comment, record every
post URL in the journey feed. Honesty invariants apply in public: measured
numbers or nothing, and never say the agent ships to a store on its own.

## Day 1 (today): the launch beat

Text is in `docs/shipaton/posts/2026-09-09-live-on-the-app-store.md`.

- [ ] Screenshot the live product page for the card. Nothing in the repo is a
      current capture of the approved listing.
- [ ] Post the X thread. Pin it, replacing the 09-08 offer pin (the offer is
      tweet 5 of this thread, so nothing is lost).
- [ ] Post the Bluesky short (`scripts/post-beat.mjs`, see
      `docs/shipaton/local-post-runsheet.md` for the env).
- [ ] Drop the X link in the Shipaton Discord #post-engagement-boost.
- [ ] Put both URLs on the 2026-09-08 feed entry: `links.post`, and
      `links.bsky` if you want the second one shown.
- [ ] Tag @RevenueCat on X. The IAP story is theirs to amplify and the
      Shipaton is their hackathon.

## Day 1: the channels that send installs, not just impressions

Everything on the landing page already points at the listing (hero button,
footer, and a Smart App Banner meta tag so Safari on iPhone shows the install
strip at the top of shipaso.com). What is left is manual:

- [ ] **Show HN.** Title: "Show HN: ShipASO – an ASO agent that audits your
      App Store listing and reads the rank back". First comment is the
      honest version: the free rank check is the public iTunes Search API,
      no paid data source, approval is the terminus. Link the journey page,
      not the store; HN does not install apps, it reads.
- [ ] **r/iOSProgramming and r/SideProject.** Lead with the two-rejection
      story and the review-notes bug. Rejection posts out-engage launch posts
      and both subs allow a store link in the body.
- [ ] **Indie Hackers.** Post the journey as a "launched" milestone with the
      timeline from the thread.
- [ ] **The MCP registry listing.** `docs/mcp-registry-publish.md` is the
      procedure. The registry entry should mention the app now that it
      exists.
- [ ] **Product Hunt: not this week.** Hold until 0.1.2 is live with the new
      UI. A PH launch is one shot and the current build is the pre-brand
      look.

## Days 2 to 7: keep the daily cadence

- [ ] One Shipaton audit post per day, per the 09-08 template. Every reply
      with a store link is a lead who already has an app to audit.
- [ ] Build-log thread on the usual day (`packages/postedge/buildlog.mjs`).
- [ ] Reply to every comment within the day. Note any suggestion that could
      ship in the feed entry body when it does.

## What to measure, and where it goes

Numbers appear on the journey page only once they are measured:

- App Store Connect → Analytics → App Units and Impressions (daily, 0.1.1
  onward). Record the first week's total in a feed entry only if it is a
  real number from ASC, never an estimate.
- `cloud` ops heartbeat (#572) already files prod and ASC state daily; read
  it before writing any post that mentions state.
- Sign-ups on app.shipaso.com with the SHIPATON26 code: the `comped`
  billing rows.

## 0.1.2: the new UI

0.1.2 is the brand build: Fraunces, Space Grotesk and JetBrains Mono shipped
in the binary, dark-first on a fresh install, the public screens composed in
the landing page's identity, and the app card saying what a quiet week
recorded (#539, #540, #550). Build number is minute-stamped from
`mobile/fastlane/Fastfile`; the pipeline is fastlane, not EAS.

What's New text for the ASC version (4000 char cap, this is well under):

> The app now looks like ShipASO. New typefaces, a dark theme by default
> (light is one tap away in Settings), and public screens redrawn to match
> shipaso.com. The app card now says what a quiet week recorded: how many
> proposals the loop logged and that nothing moved, instead of showing
> nothing. Every number on every screen is still measured or shown as a
> dash.

Steps, all `asc` (app id 6787632160):

1. `cd mobile && set -a && . ../.env && set +a && fastlane ios build`
2. `fastlane ios upload` (TestFlight only, no review submit by design)
3. `asc versions create --app 6787632160 --version 0.1.2 --platform IOS`
4. Set the What's New text on the version's en-US localization.
5. `asc builds latest --app 6787632160 --version 0.1.2` for the build id,
   then `asc versions attach-build --version-id <id> --build <build>`.
6. Preflight per `asc-submission-health`, then
   `asc submit create --app 6787632160 --version 0.1.2 --build <build> --confirm`.
7. Review notes: the 90-day review token flow from
   `marketing/aso/shipaso/review-notes-0.1.1.md` still applies. Paste it
   again. The August rejection was a missing note, not a missing feature.
