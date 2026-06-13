# store-ops — the commercial offer (AI-native)

The revenue model, the offers, and the proof. This is the spec the pricing page
and the sales conversation work from.

## The product IS the agent (AI-native positioning)

This is not a consulting service with an AI tool behind it. **The product is an
autonomous ASO agent.** The customer connects their app; the agent audits the
listing, researches keywords against the app's *real* rank + competitor data,
writes optimized copy at exact char limits, and prepares the store push. The
human approves; the agent executes. Then it runs itself on a schedule — watching
ranks weekly and re-optimizing when the data says to.

What the customer buys is **agent runs and autonomy**, not a person's time. The
engine is the store-ops loop (10 skills, the pick→ship→verify→watch chain),
exposed as an agent the customer triggers and supervises.

The one sentence: *an autonomous agent that optimizes your App Store listing,
ships it, and proves the rank moved — you just approve.*

The free OSS plugin is the funnel (run the agent yourself in Claude Code). The
paid tiers are the hosted, autonomous agent doing it for you on a schedule.
Priced for **indie developers** first — cheaper than the afternoon they'd spend
fiddling, and it keeps working while they sleep.

## The offers (all the same agent, more autonomy per tier)

### Free — run the agent yourself

The OSS plugin in Claude Code. The full loop, your own credentials, your machine.
This is the funnel: developers discover the agent by running it, then upgrade to
have it hosted + autonomous.

### 1. Launch Optimization — **$49 one-time**

Connect an app; the agent does a full optimization pass:

- **Audits** the live listing field-by-field vs. ASO best practice.
- **Researches** keywords grounded on the app's *real* rank data + *real*
  competitor positioning (not opinion, not a paid-data guess).
- **Writes** optimized copy — name, subtitle, keyword field, promo — at exact
  char limits, with the reasoning for every choice.
- **Prepares the store push** (`asc` / `gplay` commands) — you approve, it ships.
- **Sets a baseline rank snapshot** so the next run can prove movement.

The agent delivers the report + ship-ready actions in minutes, not days. One app,
en-US. +$29 per locale, +$39 for the Google Play variant.

*Why an indie pays:* $49 to have an agent do — with evidence — what would cost
them an afternoon of guessing.

### 2. Autopilot — **$19/month**

The agent keeps working on its own:

- **Weekly rank tracking** for the keyword set, logged so the trend is visible.
- **Competitor watch** — alerts when a rival renames or repositions.
- **Self-triggered re-optimization** — when the data crosses a threshold (a
  targeted keyword still not ranking, a competitor move), the agent drafts the
  fix and pings you to approve. It proposes; you approve; it ships.

*Why an indie stays:* the agent watches and reacts while they build. $19/mo for
an ASO analyst that never sleeps and only interrupts when there's a real move.

### 3. Fleet Autopilot — **$149/month** (agencies / multi-app devs)

The agent runs across **both stores, multiple locales, multiple apps**, with
monthly autonomous re-optimization and a portfolio dashboard. The tier agencies
buy to scale ASO across a client roster without scaling headcount — one agent,
many apps.

## How it works (AI-native architecture)

The agent runtime, not a human, does the work. The customer's money buys agent
runs + autonomy. The shape (deliberately the same approve-then-act pattern that
worked for ShipMate's CI agent):

```
connect app  →  agent runs the loop  →  decisions surface in a dashboard
 (bundle id +     (audit → research →      (proposed copy + the reasoning +
  store creds)     optimize → prepare push)  an Approve button)
                                                    │
                                          you approve → agent ships via asc/gplay
                                                    │
                          scheduled: agent re-runs weekly, watches ranks +
                          competitors, and only pings you when there's a real move
```

- **Autonomous by default, gated on the irreversible step.** The agent reasons,
  decides, and prepares everything itself; the human approves the *push* (the one
  action that changes a public listing). Same human-in-the-loop-in-code guarantee
  as ShipMate — only the Approve action ships.
- **It runs on a schedule, not on demand.** The product's value is that it keeps
  working — re-checking ranks, watching competitors, drafting fixes — while the
  customer builds. That's the autonomy they pay for.
- **The engine is real and tested** — the store-ops loop (10 skills, 158 tests),
  proven end-to-end on a live app. The hosted product wraps it in connect-app +
  scheduler + an approval dashboard.

## The MRR story (for the program)

```
one-time Launch Optimization ($49)  →  proves willingness-to-pay, funds the rest
   ↓ convert ~30% to recurring
Autopilot ($19/mo)                  →  the recurring base — the MRR line
   ↓ upsell the serious / multi-app
Fleet Autopilot ($149/mo)           →  high-ACV tier; few customers, big MRR jumps
```

The growth narrative judges want: one-time runs validate demand → the autonomous
subscription becomes MRR → the fleet tier accelerates it. Each tier funds
building the next, and the recurring tiers are *recurring because the agent keeps
working*, not because of a lock-in.

## The proof (don't pitch without it)

**Heathen** — a real app we ran the full loop on:
- Found it ranks #44 "agnostic", #84 "aurelius" — but nowhere on the head terms.
- Read the field: Calm/Headspace own "meditation"; Hallow owns "religious"; the
  *secular/stoic* position was unclaimed.
- Optimized: subtitle dropped the unwinnable "mindfulness" for "stoic, without
  religion" — two winnable angles instead of one head-term overlap.
- Every field char-verified; ship-ready commands delivered.

That case study *is* the sales asset. It shows evidence-based reasoning, not
template mad-libs — which is the whole differentiator vs. a $9 data dashboard.

## Why this beats the alternatives (the moat, stated plainly)

- **Astro / AppTweak / Sensor Tower** sell data + a dashboard; you still do the
  work. We do the work and prove it moved.
- **Fiverr ASO gigs** are generic keyword-stuffing with no evidence and no Play
  parity. We ground every choice on the app's real ranks + competitors.
- **DIY** is what the free plugin is for — the paid agent is for the devs who'd
  rather have it run autonomously than do it themselves.
- **Generic "AI ASO" tools** generate keyword soup from a prompt with no grounding.
  Ours reasons over the app's *real* ranks + *real* competitors, then *ships* and
  *verifies* — the agent closes the loop, it doesn't just generate text.

## Why it's credibly AI-native (not a CLI with a subscription)

- The **product is the agent** — the customer connects an app and supervises an
  autonomous loop; they don't operate tools.
- It **acts**, not just advises — it prepares and (on approval) executes the
  store push. Advice is cheap; an agent that ships is the product.
- It's **autonomous on a schedule** — re-optimizing and watching without being
  asked, surfacing only the decisions that need a human. That standing autonomy
  is the thing a static tool or a dashboard can't be.
- The **approval gate is in code**, not a prompt — only the human-approved action
  changes a public listing (the ShipMate guarantee).

## What's deliberately NOT in the offer (yet)

- We never resell Apple/Google data — every credentialed source is the
  customer's own, used by their agent to do their work, never redistributed.
- Fully-unattended publishing — the push stays human-approved by design; "the
  agent shipped to my store without asking" is a feature nobody wants.
