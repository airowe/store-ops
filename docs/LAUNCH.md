# Launch post — ShipASO

Drafts for the announcement. The wedge is the same in all of them: every ASO
tool tells you what to do and then abandons you at the App Store Connect form.
This one does the work and checks whether it paid off.

---

## Show HN (title + body)

**Title:** Show HN: ShipASO – an AI ASO loop that ships your metadata and checks the rank moved

**Body:**

I ship indie apps, and the part I hated most was App Store Optimization. Not the
thinking — the loop. You research keywords in one tool, copy them into App Store
Connect by hand, then weeks later squint at a dashboard to guess whether it
worked. Three tools, two copy-pastes, no feedback.

Every ASO product I tried sells the same thing: data and a dashboard. Keyword
volumes, difficulty scores, rank graphs. They stop at "here's what to do." The
doing is still on you. And most of them gate that data behind a paid API.

So I built the other half. ShipASO is a set of agent skills that runs in Claude
Code (23 skills + a Python engine, 158 tests). It does the whole loop:

- **audit** your live listing field by field — including a screenshot ASO score
- **research** keywords — no paid data API; it reasons over store autocomplete,
  competitor listings, your own reviews (the words real users use), and your
  app's *actual* organic ranks
- **optimize** the copy to the exact character limits (the #1 cause of wasted
  metadata is a title that's one char over)
- **push** it — it writes the metadata and hands you the exact `asc`/`gplay`
  commands; nothing ships without you running them
- **verify + watch** — and this is the part nobody else does — it reads your
  organic rank for each keyword and logs it over time, tracks competitors'
  listing changes, and tells you when to re-optimize. So you can actually see
  whether the change landed, in any of 14 markets, not just en-US.

That last step is free and needs no account. The public iTunes Search API
returns apps in the store's own ranking order, so your app's position in the
results *is* its rank for that term. I just read the index.

I ran it on my own meditation app. It told me I rank #44 for "agnostic" and #84
for "aurelius" — my niche — and nowhere in the top 200 for "meditation" or
"mindfulness." Which is correct: I can't outrank Calm for "meditation," and the
tool's whole strategy was to stop trying and own the terms I can win. The
subtitle dropped "mindfulness" for "stoic, without religion" — two winnable
angles instead of one head-term I'd lose. Now I have a dated baseline, so when
that change ships I'll know if it moved.

It does Google Play too, end to end — which I haven't seen any other tool do
operationally. That's the lane I think is genuinely open: there's no public tool
that optimizes a Play Console listing all the way through.

It's MIT, all of it. If you bring your own Apple Search Ads or Google Keyword
Planner keys it grounds the volume numbers on real search data, but it never
requires them, and it never resells anyone's data through a shared account.

If you don't want to run it yourself, there's a hosted version — it's live. You
connect an app by bundle id and an autonomous agent runs the loop on a weekly
schedule: re-checking ranks, watching competitors, drafting the next
optimization, and surfacing each decision for you to approve. The approval gate
is enforced in code — the push commands are withheld until a human clicks
approve — and we never hold your store credentials; the push is a
generated-commands handoff you run yourself. Same engine as the plugin, but it
keeps working while you build.

- Repo (free plugin): https://github.com/airowe/app-marketplace
- Hosted agent (live): https://store-ops-dashboard.pages.dev

What's honest about the state of it: the hosted app's auth is a stubbed email
header and billing isn't wired yet — it's a working demo of the loop, not a
hardened SaaS. The engine, the D1 persistence, the connect→run→approve flow, and
the weekly cron are real (45 tests on the TypeScript port).

Happy to get torn apart on the keyword-scoring approach — that's the part I'm
least sure about, and it's where I'd most value the feedback.

---

## X / thread version

See `LAUNCH_X.md` for the full thread.

---

## The one-liner (for bios, directory listings)

> The ASO loop that ships your metadata and proves the rank moved — App Store
> *and* Google Play, no paid data API. MIT.

---

## Notes for whoever posts this

- Lead with the gap (everyone stops at advice), not the feature list. The gap is
  the story.
- The rank-check trick is the most shareable single fact — it's a "huh, that's
  clever and obvious in hindsight" moment. Don't bury it.
- The meditation-app example with real numbers does more than any claim. Keep a
  concrete before/after in every version.
- Don't oversell the Google Play angle as solved-forever; sell it as "the lane
  nobody else operates in," which is true and defensible.
- Invite criticism on the scoring formula. It's genuinely the soft spot, and
  saying so reads as honest rather than as a pitch.
- Be upfront about what's stubbed in the hosted app (auth + billing). On HN,
  saying "working demo, not hardened SaaS" earns more trust than hiding it.
