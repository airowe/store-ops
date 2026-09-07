# Founders' Pass — the advantage to lean on, and who to hand it to

Written 2026-09-06 from a fresh read of the competition. Every price and
claim below was checked against a public page that day; the source list is
at the end. Nothing here has been sent to anyone.

## What the market looks like right now

The category split in 2026 into three shapes.

| Shape | Who | What they sell | Entry price |
|---|---|---|---|
| Data platforms | AppTweak, MobileAction, Appfigures, Sensor Tower | keyword and rank data with a dashboard; you do the work | $9.99 (Appfigures Connect) to $79 (AppTweak Essential) a month, up to $549+ |
| Native indie tool | Astro | Mac app, iOS only, keyword tracking; no API, no CLI, no MCP | $9/mo billed annually |
| AI writers and agents | AppDrift, Sonar, IconikAI | LLM-written metadata, translation, screenshots; some publish to the stores; Sonar exposes 22 MCP tools with a write scope | $9–$19.99/mo, credit packs from $10, $10/app/mo |

Two of the AI entrants are close to us and worth naming plainly:

- **Sonar** is an MCP-first ASO server: 22 tools, credits or a $9/mo agent
  plan, write tools behind a write-scope key. It is the nearest thing to
  our hosted MCP, and it got there with more tools and a lower price.
- **AppDrift** writes metadata, localizes, generates screenshots, and
  publishes to both stores from $9.99/mo. It also sells a "Store-Ops API"
  to platforms, which is our repository's name. Its lists rank itself
  first, which is how most of the "best ASO tools 2026" pages are built.

What none of them claim, on any page I read:

1. **That the change worked.** Every tool ends at "published" or at a rank
   chart you read yourself. None closes the loop by reading the rank back
   after its own push and attributing the move to the change. Ours does,
   and it refuses to show a number it did not measure.
2. **An approval-gated agent with a ledger.** AppDrift publishes on your
   click; Sonar writes on a key. Neither runs a scheduled loop that opens a
   run, waits for a person's approval, executes it, and writes down each
   step, including the ones it skipped and why.
3. **An open engine with no paid data dependency.** Every competitor is a
   data subscription. Our plugin is 33 MIT skills over the free iTunes API,
   and the hosted product uses the same engine.

## The one advantage to lean into

**We are the only ASO tool that has to prove it worked.**

Not "AI", not "cheaper", not "MCP". Those are shared or beatable, and Sonar
already beats us on tool count and price. The claim nobody else can make
is that a push is followed by a measured readback, and that the product's
own interface will say "unmeasured" rather than guess. It is enforced in
code (`measured-or-nothing`, the honesty guards, the execution ledger), it
is visible on every run page, and it is the thing the build-in-public
thread has been demonstrating for three months.

For acquisition that becomes one sentence: *ShipASO changes your listing
after you approve it, then shows you whether the rank moved.* Every
competitor's sentence stops at the comma.

Where this is weakest, so the sentence stays honest: readback is a rank
snapshot over time, not causal attribution; Apple's own Search Performance
data is not yet wired in (AppDrift has it); and the closed-loop proof has
been shown on the owner's apps, not a customer's. The Founders' Pass exists
to fix the last one.

## The Founders' Pass

**Offer:** Scale tier (50 apps, autopilot, the weekly loop) free for twelve
months, to a small named list of people who ship many apps or speak to
many developers. No obligation to post. One ask: let us read the rank
readback on their apps into the public proof page, anonymized, the same
way the owner's apps already are. That is the customer-side proof the
advantage is missing.

**Why free beats a discount here:** the value of these people is not their
subscription. It is one screenshot of a run page in a thread with 30,000
readers, and one line in a newsletter that says "it read the rank back."
A discount makes that a favor; a pass makes it a story.

**Mechanics (built, or one script away):**

- Tier grant: `setTier` in `cloud/src/d1.ts` already accepts a tier and a
  status. A comped user is `tier = scale`, `status = comped`,
  `current_period_end` twelve months out, no Stripe ids. `getTier` is what
  every gate reads, so autopilot, the sweep, and the 50-app limit all apply.
  `cloud/scripts/grant-founder-pass.mjs` does this in one command and
  prints what it changed.
- The pass holder signs in with a magic link like anyone else, connects
  apps, stores one team-scoped ASC key (#560), and flips the two switches
  in Settings › Autonomy (#565).
- Their measured wins land on the public proof page only if they opt in;
  the existing `rlhf_opt_out` and proof aggregation are the boundary.

## The list

Ranked by fit, not fame. "Verified" means I found the person and the
claim on a public page dated 2025–2026 today; "to verify" means the name is
well known but I did not confirm current activity and it should be checked
before any outreach.

### Tier 1 — ship many apps, speak to developers, already adjacent

| Who | Why them | Verified | The ask |
|---|---|---|---|
| **Rudrank Riyam** — author of the `asc` CLI our skills run on; Shipaton Build-in-Public award winner; Callstack podcast on agents and release automation | Every ShipASO skill is a runbook over his tool. We upgraded to his 5.0.0 the day it shipped and found nine breakages the linter missed. That is a story he would tell. | yes | Pass + a joint post: "asc 5.0 in the wild, what broke, what the linter learned." Tag @rudrank, he features real posts from asc users. |
| **Max** — 30-app portfolio, $22k MRR, Indie Hackers interview, moving to SaaS in 2026 | Exactly the "priced on apps, not seats" customer. Thirty apps on Scale is the pricing page's own example. | yes | Pass for the whole portfolio; ask for the readback on the public page. |
| **David Barnard and Jacob Eiting** — Sub Club by RevenueCat, fortnightly, "indie devs that made it big to the highest-grossing subscription apps" | RevenueCat hosts Shipaton, which we are in. 2026 episodes are about vibe coding lowering the barrier and the "supply shock" of apps, which is precisely the discovery problem ASO solves. | yes | Not a pass, a pitch: a Sub Club segment on "the agent that has to prove it worked", with the ledger on screen. |
| **The "100 iOS apps in 100 days" builder** — Indie Hackers, March 2026, one app per weekday, documenting every lesson | A hundred listings is the stress test for a loop that runs on a schedule. | post verified, name not | Read the post, confirm the name, offer the pass for all hundred. |

### Tier 2 — the audience owners

| Who | Reach | Verified | The ask |
|---|---|---|---|
| **Sean Allen** — Swift News, YouTube plus newsletter, every other week | large; exact 2026 numbers not found | yes | Pass, and a "what I'd show in Swift News" demo video under two minutes. |
| **Antoine van der Lee** — SwiftLee, weekly blog and newsletter, runs the Swift newsletter index | large | yes | Pass; SwiftLee Weekly link. He also ships his own apps. |
| **Paul Hudson** — Hacking with Swift | largest Swift education audience | site verified, ASO interest not | Pass; low expectation, high upside. |
| **Phiture ASO Stack Slack** — 6,000+ ASO practitioners, ASO-only, run with Incipia; ASO Monthly newsletter first Wednesday | the ASO profession | yes | Not a pass. A post in the channel with the ledger and the readback, written as a practitioner question, not a launch. Their trends piece for 2026 already says agents are the direction. |
| **Steve P. Young** — App Masters Academy, Slack community, "helped 29 clients get featured by Apple" | ASO education buyers | yes | Pass; his mastermind sessions run on AI topics already (an in-app-events-with-AI session in May 2026). |
| **Thomas Petit** — mobile growth consultant | consultancies and their clients | name verified, 2026 activity not | Pass; to verify first. |

### Tier 3 — build-in-public indies worth a quiet pass

Neil of Crab Polygons (animated widgets) and Iain McLaren (a suite of free
"calm" apps), both in TapSmart's July 2026 indie showcase. Small, real,
many apps each. A pass costs nothing and their posts are exactly our
audience.

Not on the list: Ariel Michaeli (Appfigures) and the AppTweak, MobileAction
and Sonar teams. They are the competition or its press. Pieter Levels,
Marc Lou, and the other X build-in-public names are not iOS-first; a pass
would be noise.

## The Shipaton entrants — the pool, not the list

Shipaton 2025 drew tens of thousands of participants and 812 submitted
projects. 2026 runs to September 30, judging October 1–13, winners October
21. Every entrant is launching a brand-new app on the store in the next
three weeks, which is the one moment ASO is not optional. Checked today:

- The Ship Kit already carries 28 sponsor perks unlocked by milestones, and
  the ASO slots are taken by our competitors: Layers ("automate content and
  App Store listing optimization", 2 months free), AppFollow (50% off, 6
  months), AppTweak (50% off), Fload ("AI growth team for ASO"), AppScreens,
  Asapty. Sponsors are reached at shipaton@revenuecat.com.
- The rules do not forbid promotion; the only catch-all is "inappropriate,
  unsportsmanlike". Discord (discord.gg/shipaton26) has #post-engagement-boost,
  where sharing progress is the point. There is no public entrant directory
  until the Devpost gallery opens at submission.

Three plays, in order of when they work:

1. **Now, as a peer (free, no rules risk).** We are an entrant. In
   #post-engagement-boost and on the #Shipaton tag: "reply with your App
   Store link and I'll post your measured audit." `preview_app` needs no
   signup, every audit is a public post with real numbers, and the fix is
   one sign-in away. This becomes a daily calendar slot, "Shipaton audit of
   the day", from tomorrow to September 30.
2. **A Shipaton Pass, self-serve.** Startup tier (10 apps, the loop,
   autopilot) free through December 31 for any entrant, claimed with a code
   at sign-in. That needs a claim route and a landing section, about a day
   of work, plus one email to shipaton@revenuecat.com asking for a Ship Kit
   slot. Our line against the six ASO perks already there: they give you
   data or a discount; we change the listing after you approve it and show
   you whether the rank moved.
3. **October, the report.** When the Devpost gallery opens, audit every
   submitted app's live listing with the engine (public data, no keys) and
   publish "Shipaton 2026: the ASO report", grade distribution and the
   common mistakes, each entrant tagged with their own measured line and the
   pass. Timed for the judging window, when 800 makers are watching and
   most of them just learned they did not win.

Play 1 starts tomorrow. Play 2 is a build decision. Play 3 is a calendar
entry for October 1.

## The sequence

1. **This week.** Rudrank first, because the asc 5.0 story is real, dated,
   and flattering to his tool. Then Max. Two passes, two conversations.
2. **After the first customer readback exists on the proof page**, the
   Sub Club pitch and the ASO Stack post. Both need a number that is not
   ours.
3. **Then the audience owners**, with the demo video, one at a time, never
   a batch email.

Every message is written by a person and sent by a person. The offer is
the pass and the readback; there is no affiliate code and no ask to post.

## What to measure

Passes granted, passes activated (apps connected + a key stored), runs
approved by pass holders, autopilot executions, and readbacks that landed
on the proof page. Nothing else counts until one of those is non-zero.

## Sources

- Sonar: https://trysonar.app/agents · https://glama.ai/mcp/servers/trysonar/mcp · https://trysonar.app/blog/astro-aso-pricing
- AppDrift: https://appdrift.co/platform · https://appdrift.co/for-platforms · https://www.capterra.com/p/10040127/AppDrift/
- IconikAI: https://www.iconikai.com/aso-agent
- Data platforms: https://thekintsu.com/blog/aso-tools-under-100-a-month · https://thekintsu.com/blog/appfigures-review-2026 · https://theapplaunchpad.com/blog/7-apptweak-alternatives-to-consider-in-2026
- Phiture: https://phiture.com/asostack/aso-trends-in-2026/ · https://phiture.com/aso-stack-slack-community/ · https://phiture.com/aso-monthly-newsletter/
- Rudrank Riyam: https://www.callstack.com/podcasts/app-store-connect-cli-agents-and-mobile-release-automation-with-rudrank-riyam · https://www.revenuecat.com/blog/company/shipaton-interview-with-rudrank-riyam · https://github.com/rudrankriyam/App-Store-Connect-CLI
- Max: https://www.indiehackers.com/post/tech/from-failed-app-to-30-app-portfolio-making-22k-mo-in-less-than-a-year-myy3U7K9evxGOVOHti8s
- 100 apps: https://www.indiehackers.com/post/im-building-100-ios-apps-in-100-days-in-public-86c6b6a745
- Sub Club: https://subclub.com/ · https://www.listennotes.com/podcasts/sub-club-by-revenuecat-david-barnard-jacob-mi4gerXHEUD/
- Swift audiences: https://github.com/SAllen0400/swift-news · https://www.avanderlee.com/ · https://swiftlee-weekly.com/swift-newsletters/ · https://www.hackingwithswift.com/100
- App Masters: https://appmastersacademy.com/ · https://www.linkedin.com/in/stevepyoung/
- Indies: https://www.tapsmart.com/apps/indie-apps-showcase-july-2026/
- Shipaton: https://www.revenuecat.com/blog/company/announcing-shipaton-2026
