# ShipASO — launch kit

The complete, current set of copy + a sequenced playbook for getting the word
out. The wedge is the same everywhere: **every ASO tool tells you what to do and
abandons you at the App Store Connect form. ShipASO does the work and proves the
rank moved.** New angle since the early drafts: **you can see your real rank for
free, no signup** (the try-before-signup preview).

Current facts (keep these accurate): 24 skills (12 ASO + 12 store-CLI), 344 cloud
tests, App Store + Google Play, MIT plugin + a hosted agent at app.shipaso.com.

---

## The launch sequence (order matters more than any single post)

Don't fire everything at once. Sequence it so each step warms the next and you're
not spread thin replying everywhere simultaneously.

1. **Soft-launch to your own audience first** (X/Twitter build-in-public, any
   Discord/Slack you're in). Low stakes, catches embarrassing bugs, seeds the
   first real `/proof` wins before a big launch.
2. **Show HN** (Tue–Thu, ~9–11am ET is the sweet spot). The most qualified
   technical audience for a Claude-Code-native tool. Be present to reply all day.
3. **Reddit, same week but a different day** — r/iOSProgramming + r/androiddev.
   These are your actual buyers (indie devs shipping apps). NOT salesy — lead
   with the free rank-check, not the product.
4. **Product Hunt** once you have a few real `/proof` wins to show + a couple of
   testimonials. PH rewards a polished page + launch-day hustle; don't burn it early.
5. **Indie Hackers** — a build-in-public "I shipped X" post + ongoing milestone
   updates. This is a slow-burn relationship channel, not a one-shot.

Between launches: keep posting real rank wins (the share-worthy digest emails are
screenshot fuel) so momentum compounds instead of spiking and dying.

---

## Show HN

**Title:** Show HN: ShipASO – an AI ASO loop that ships your metadata and proves the rank moved

**Body:**

I ship indie apps, and the part I hated most was App Store Optimization — not the
thinking, the loop. You research keywords in one tool, copy them into App Store
Connect by hand, then weeks later squint at a dashboard to guess whether it
worked. Three tools, two copy-pastes, no feedback.

Every ASO product I tried sells the same thing: data and a dashboard. Volumes,
difficulty scores, rank graphs. They stop at "here's what to do." The doing is
still on you, and most gate the data behind a paid API.

So I built the other half. ShipASO is a set of agent skills that run in Claude
Code (24 skills, 344 tests on the hosted side). It does the whole loop: audits
your live listing, researches keywords on **real rank data with no paid API**
(it reads the public iTunes Search API — your position in the results *is* your
rank), optimizes copy to exact char limits, hands you the exact `asc`/`gplay`
push commands (or opens a PR with the Fastlane metadata tree — your CI pushes it,
ShipASO never holds your store credentials), and then reads the rank back over
time to prove it moved.

You can try it without signing up: paste your app on app.shipaso.com and it runs
a real audit + rank baseline on live data. The plugin is free + MIT; the hosted
agent reruns the loop weekly and pings you only when there's a real move to
approve.

Free rank check (no account, the thing that started it): https://shipaso.com/check-your-rank
Plugin: `/plugin marketplace add airowe/store-ops`
Hosted: https://app.shipaso.com
GitHub: https://github.com/airowe/store-ops

Happy to talk about the rank-without-a-paid-API approach, the Apple-403-from-
Cloudflare egress problem (solved with a clean-egress fetch), or the "we never
hold your store credentials" design — it's all in the open.

**HN reply prep (have these ready):**
- *"Isn't this against Apple's terms?"* — It reads the *public* iTunes Search
  API (the same one the store search box uses). No scraping logged-in pages, no
  shared-account data. Every credentialed source is the user's own.
- *"How is rank accurate without licensed data?"* — The Search API returns apps
  in the store's own ranking order, so position = organic rank for that term. It
  can differ slightly from a logged-in device (personalization, regional A/B),
  and the page says so. It's an honest proxy, not a guarantee.
- *"What's the catch on free?"* — None. The plugin runs the whole loop yourself
  in Claude Code. The hosted tier sells *not having to remember* to run it weekly.

---

## X / Twitter thread

**1/** Every ASO tool tells you what keywords to use, then leaves you alone in
the App Store Connect form.

I built one that picks the keywords, writes the metadata, hands you the push, and
then checks whether your rank actually moved. 🛥️

**2/** The loop most tools skip:

`audit → research → optimize → push → verify`

They sell you steps 1–2 (data + a dashboard) and stop. The work — and the *did it
work?* — is still on you.

**3/** ShipASO does the whole thing. And the research runs on **real rank data
with no paid API** — it reads the public iTunes Search API, where your position
in the results *is* your organic rank for that keyword.

**4/** Try it with zero commitment: paste your app → real audit + rank baseline,
free, no signup. → shipaso.com

**5/** The push is yours to approve. ShipASO hands you the exact commands, or
opens a PR with the Fastlane metadata tree so your CI pushes it. We never hold
your store credentials — that's the whole trust model.

**6/** Then it reads the rank back weekly and emails you when something actually
moved. Not a dashboard you have to remember to check — a result that comes to you.

**7/** Free + MIT plugin for Claude Code (24 skills). Or the hosted agent runs it
on a schedule.

Free rank check (no account): shipaso.com/check-your-rank
Plugin + hosted: shipaso.com

---

## Reddit (r/iOSProgramming, r/androiddev)

⚠️ Reddit punishes self-promotion. Lead with the **free, genuinely useful thing**
and let people find the product. Post the rank-check, not the pitch.

**Title:** I built a free way to check your app's real organic App Store rank for any keyword (no account, no paid API)

**Body:**

The public iTunes Search API returns apps in the store's own ranking order — so
your position in the results IS your organic rank for that keyword. You can check
it with one command, free, no signup:

[link: shipaso.com/check-your-rank — the exact command is on the page]

I got tired of ASO tools gating rank data behind a paid API when this works for
the App Store search box already. Wrote up the method (and the honest caveats:
it's the public Search API, not a logged-in device, so personalization/regional
A/B can differ).

Full disclosure: I also build a tool on top of this (ShipASO — it runs the whole
ASO loop), but the rank check stands alone and needs nothing from you. Happy to
answer questions about the method.

*(For r/androiddev, reframe around the Google Play equivalent + the fact that
almost no tool covers Play ASO with the same loop.)*

---

## Product Hunt (when you have real wins + a testimonial or two)

**Tagline:** The ASO loop that ships your metadata and proves the rank moved

**Description:** ShipASO audits your App Store / Google Play listing, researches
keywords on real rank data (no paid API), optimizes your copy, hands you the push
(or opens a PR — your CI pushes it, we never hold your store creds), then reads
the rank back weekly to prove it moved. Free MIT plugin for Claude Code, or a
hosted agent that runs the loop for you.

**First comment (founder):** I ship indie apps and hated the ASO loop — research
in one tool, paste into App Store Connect by hand, squint at a dashboard weeks
later to guess if it worked. So I built the half nobody ships: the *doing* and
the *did it work?*. You can see your real rank free with no signup — paste your
app on the site. Would love feedback from other people shipping apps.

**Assets to prep:** the boat logo, a 30–60s screen recording of the
preview→audit→proof flow, 2–3 screenshots (the landing hero, a digest email, the
run/approval screen), and ideally one real before/after rank win.

---

## Indie Hackers (build-in-public)

A milestone post, then keep updating. IH rewards honesty + numbers over polish.

**Angle:** "I built the ASO tool I wanted: it does the work and proves the rank
moved." Share the wedge, the free rank-check, the no-paid-API insight, and — as
they accrue — real `/proof` numbers (apps moved, keyword wins, best jump). Post
follow-ups when a real user gets a rank win; that's the content that compounds.

---

## One-liner (bios, directory listings, DMs)

> ShipASO — the AI ASO loop that ships your metadata and proves the rank moved.
> Free rank check, no account: shipaso.com

---

## Notes for whoever posts this

- **Be present.** A Show HN / PH launch lives or dies on you replying for the
  first 6–8 hours. Block the day.
- **Lead with free, always.** The rank-check (no signup) is the trust-builder.
  The product is the upsell, not the opener.
- **Keep facts accurate.** Update skill/test counts if they change. Never claim a
  rank guarantee — the honest "public Search API, not a logged-in device" caveat
  is a credibility asset, not a weakness.
- **Screenshot the wins.** The digest emails and `/proof` strip are designed to be
  screenshotted. Every real rank win is launch fuel — post them.
