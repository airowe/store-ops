# Launch post — store-ops

Drafts for the announcement. The wedge is the same in all of them: every ASO
tool tells you what to do and then abandons you at the App Store Connect form.
This one does the work and checks whether it paid off.

---

## Show HN (title + body)

**Title:** Show HN: store-ops – an AI ASO loop that ships your metadata and checks the rank moved

**Body:**

I ship indie apps, and the part I hated most was App Store Optimization. Not the
thinking — the loop. You research keywords in one tool, copy them into App Store
Connect by hand, then weeks later squint at a dashboard to guess whether it
worked. Three tools, two copy-pastes, no feedback.

Every ASO product I tried sells the same thing: data and a dashboard. Keyword
volumes, difficulty scores, rank graphs. They stop at "here's what to do." The
doing is still on you.

So I built the other half. store-ops is a set of agent skills (it runs in Claude
Code) that does the whole loop:

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
  listing changes, and (on a schedule) tells you when to re-optimize. So you can
  actually see whether the change landed, in any of 14 markets, not just en-US.

That last step is free and needs no account. The public iTunes Search API
returns apps in the store's own ranking order, so your app's position in the
results *is* its rank for that term. I just read the index.

I ran it on my own meditation app. It told me I rank #45 for "agnostic" and #84
for "aurelius" — my niche — and nowhere in the top 200 for "meditation" or
"mindfulness." Which is correct: I can't outrank Calm for "meditation," and the
tool's whole strategy was to stop trying and own the terms I can win. Now I have
a dated baseline, so when my next metadata change ships I'll know if it moved.

It does Google Play too, end to end — which I haven't seen any other tool do
operationally.

It's MIT, all of it. If you bring your own Apple Search Ads or Google Keyword
Planner keys it grounds the volume numbers on real search data, but it never
requires them, and it never resells anyone's data through a shared account.

If you don't want to run it yourself, there's a hosted version: connect your app
and an autonomous agent runs the whole loop on a schedule — re-checking ranks,
watching competitors, and drafting the next optimization, surfacing each decision
for you to approve. Same engine, but it keeps working while you build. (The CLI
plugin is free forever; the hosted agent is the paid tier.)

Repo: [link]

Happy to get torn apart on the keyword-scoring approach — that's the part I'm
least sure about.

---

## X / thread version

**1/**
Every ASO tool tells you what keywords to use, then leaves you alone in the App
Store Connect form.

I built one that picks the keywords, writes the metadata, hands you the push,
and then checks whether your rank actually moved.

MIT. Runs in your editor. 🧵

**2/**
The trick for the rank check: the public iTunes Search API returns apps in the
store's own ranking order. Your app's position in the results is its rank for
that term. No account, no scraping, no $9/mo tracker. Just read the index.

**3/**
I pointed it at my meditation app. Result: #45 for "agnostic," #84 for
"aurelius," nowhere for "meditation."

That's not a failure — it's the strategy working. You don't beat Calm for
"meditation." You own the terms you can win and prove it.

**4/**
It does the full loop on Google Play too, which I genuinely haven't seen
anywhere else. Most tools are iOS-only and stop at advice.

**5/**
No paid data API required — it reasons over free signals (store autocomplete,
competitor listings). Bring your own Apple/Google keys for real volume numbers
if you want. Your keys, your data, your call.

Repo + the 60-second version: [link]

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
