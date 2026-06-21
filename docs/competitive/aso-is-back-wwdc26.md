# Signal: "ASO is back" (WWDC 2026 ranking shift)

**Captured:** 2026-06-21
**Primary source:** Adam Lyttle (@adamlyttleapps), YouTube — *"App Store Optimization is BACK?! (time will tell)"* (`nnjRWgBu-s4`, 5:41, published 2026-06-17, ~4k views).
**Amplified by:** Ahmed Gagan (@ahmedgagan11) X thread (2067286858007216314, ~23k views), which re-summarizes Lyttle's video and credits him.

> This is a captured external claim, not measured fact. Treat the mechanism ("an LLM ranks now")
> as an *unconfirmed theory* — both authors explicitly hedge it ("time will tell", "my best guess",
> "leading theory"). Do NOT repeat it as fact in ShipASO copy or findings. See "Implications" below.

## The claim, in one line

After ~12 months of new apps refusing to rank, App Store keyword rankings started moving sharply
again in the week around WWDC 2026 — and the move looks like it may be an **annual, WWDC-timed event**.

## The hard data points cited (named, first-party to the authors)

| App / dev | Keyword | Movement | Note |
|---|---|---|---|
| Piano Power (Lyttle) | "learn music notes" (main kw) | **+142 spots** | Brand-new app, released weeks ago |
| Piano Run (Lyttle) | all targeted keywords | "every targeted keyword climbed" | Relaunched last year |
| Christian (peer) | one keyword | **49 → 14** | |
| Zade (peer) | one keyword | **+112 spots** | |

On-screen rank-tracker (from the video, ~0:08) showed deltas of **+101, +51, +61, +87, +134, +98,
+34, +18, +118, +52, ±0** across a portfolio — column layout: `Difficulty | Position (#) | Trend
(delta + sparkline) | App`. Caption: *"I get the feeling something changed with ASO rankings —
seeing green on all apps, even newly released ones."*

> Note: this rank-tracker UI (difficulty bar / position / signed delta / sparkline per keyword) is
> functionally the same artifact ShipASO produces. The market is already visualizing exactly what we
> build.

## The narrative arc (Lyttle's framing)

1. **~WWDC 2025:** Apple pushed an update that "tanked everyone's rankings overnight." New apps
   stopped ranking. The old playbook — *build an app around a keyword and let search do the rest* —
   "just stopped working." No launch boost, no visibility.
2. **Stated theory for why:** vibe-coding flooded the store with slop; Apple's blunt fix was to stop
   surfacing new apps at all.
3. **The 30%-cut angle:** devs fled to paid ads + web-to-app funnels, which (Lyttle claims) "convert
   better and cost less" — eroding Apple's 30% IAP take. He implies Apple noticed the exodus.
4. **~WWDC 2026 (this week):** rankings moving again; indie devs reporting +50–140 spot jumps,
   brand-new apps ranking.
5. **Cadence hypothesis:** ranking shifts may now be **annual, around WWDC** — "once a year you find
   out where you stand, then it holds for 12 months." Framed as *brutal but stable* (vs Google's
   random rolling updates).
6. **Mechanism hypothesis (the load-bearing claim):** an LLM — "Apple Intelligence or some internal
   version of it" — now runs over the rankings, sorting real apps from slop. If true:
   **"ASO has quietly become less about keyword stuffing and more about training and prompting that
   AI model."** Both authors call this the part that "wins the whole game" if you crack it first.
7. **The open test he's watching:** slop submissions never stopped ("more apps submitted now than
   any point in App Store history"). The real question is whether the new system can *tell good from
   slop*. If yes → best news for indies all year. If no → back to square one.

## Why this matters for ShipASO

**Tailwind / validation:**
- The thesis *"ASO is now about convincing the model your app is the real deal, not stuffing
  keywords"* is **exactly the honesty/intent-grounding track** we just shipped (the `reasonKeywords`
  path: keywords derived from the real description, not name tokens; no fabricated volume/difficulty;
  never present unmeasured data as measured). A model-gated store is a tailwind for an
  intent-grounded tool and a headwind for keyword-stuffers.
- The market just un-stuck: a year of "dead silence" → "the needle finally moved." A rank-proving
  product is far more compelling when ranks are demonstrably moving again. This is squarely our
  landing-page promise ("prove the rank moved").

**Risks / things to verify, not assume:**
- The "LLM ranks now" mechanism is unproven theory. Per our own core discipline, we must NOT state
  it as fact anywhere user-facing. It's a hypothesis to *design toward*, not a measured truth.
- If "rankings shift annually at WWDC and hold for 12 months" is real, our weekly-cron cadence story
  may overclaim movement during the ~11 frozen months. Worth pressure-testing how we frame
  week-over-week deltas.

## First-party data check (DONE 2026-06-21) — inconclusive, by design

We queried production D1 (`store_ops`) to test the claim against our own rank snapshots. **Verdict:
we can neither confirm nor refute it from our data** — and that itself is the honest, on-brand finding.

- **Clear Cost:** no rows in production at all. It was connected during a live walkthrough and then
  cleared, so there is zero persisted rank history. Nothing to check.
- **Mangia** (`app_id 8eee0f6a-18f8-43c9-b0f9-497cf60f858f`): 11 snapshot timestamps spanning
  2026-06-16 → 2026-06-21, but **every tracked keyword is `unranked` (rank = NULL) at every
  timestamp** — `recipe`, `meal`, `pantry`, `grocery`, `meal planner`, `cooking`, `mangia`,
  `manager`, all outside the top ~165–190. No rank ⇒ no movement to measure. You cannot observe a
  +142-style jump on a keyword the app never ranked for.

Why our data structurally can't answer this (worth remembering before we ever cite it):
1. **No clean pre/post-WWDC baseline.** Snapshots cluster around *our own test/walkthrough sessions*
   (Jun 16, then a burst Jun 20–21), not a steady cadence. There's no stable "11 months of dead
   rankings" line and no controlled post-WWDC reading.
2. **Mangia is the wrong instrument.** Lyttle's evidence was apps that *already ranked* for a keyword
   and jumped. An unranked-on-everything app has no rank to move.

> This is a concrete, in-the-wild instance of the discipline the product preaches: **we didn't
> measure it, so we don't claim it.** A keyword-stuffing tool would have happily drawn a "rankings
> recovering!" chart from this noise. We don't.

**To actually test the claim later:** instrument 2–3 apps that *currently rank* for a keyword and let
the weekly cron build a genuine multi-week baseline; a future WWDC-style shift would then show up as
real, measured movement rather than test-session noise.

## Other follow-ups (not yet done — for Adam to decide)

1. **Positioning angle (relates to #71/#78):** if consensus is shifting to "convince the model," our
   intent-grounded reasoner is on the right side of it — worth saying so, *carefully*, without
   asserting the unproven LLM mechanism.

## Competitor note

- **Adam Lyttle** — indie iOS dev, sizeable audience; just launched **Prelauncher** (prelauncher.com:
  validate an app idea with Meta Ads *before building*). Adjacent to us (pre-build demand validation
  vs post-launch ASO), not a direct competitor — but same buyer.
- **Ahmed Gagan** — 18yo indie hacker; runs **seoitis.com** and **getvibeshots.app** (+ theswiftk.it,
  theflutterk.it). Closer to our space; amplifies ASO-tooling narratives to a 20k+ reach audience.
