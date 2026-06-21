# Competitor: Appeeky (appeeky.com)

**Captured:** 2026-06-21
**Source:** appeeky.com + X (@imeronn / Erencan Arica, the maker; surfaced via a @Mustayayy reply).
**What it is:** An **"agentic ASO platform"** — self-described "agentic ASO co-founder" — across web,
**native macOS desktop (local-first, built-in terminal)**, and an iPhone app. iOS + Google Play.

This is the **most direct competitor seen to date — more so than AppSprint.** It uses our exact
positioning word ("agentic"), names our exact feature set, ships on more surfaces, has an MCP server
for Claude, and is priced aggressively low. Treat this as the primary head-to-head.

## The uncomfortable overlap (they named our features)

| ShipASO feature | Appeeky equivalent (their words) |
|---|---|
| Intent-grounded keyword targeting | "Volume, difficulty, **opportunity scoring**" |
| Keyword gaps (#71/#01) — "winnable terms competitors use you don't" | "Competitor keyword gap analysis — identifies **'winnable' terms** competitors rank for that you don't" |
| Scored, prioritized findings (#45/#55/#61) | "Weighted health scores with **prioritized recommendations**" |
| Screenshot coverage by device size (#70) | "Screenshot coverage **evaluation by device size**" |
| Coverage/localization gaps (#60/#78) | "Localization gap detection across markets" |
| War room / competitor head-to-head (#25/#72) | "Side-by-side ASO score comparisons, keyword overlap" |
| Rank snapshots + deltas | "**Daily** rank snapshots by country and device" |
| The reasoner (#57) grounded in real data | AI Copilot "grounded in your app data… not generic advice" |

Their own differentiator line could be ShipASO's: *"recommendations are specific to your listing, not
recycled blog advice."* We are building the same product, and they are further along on breadth.

## Where they're genuinely ahead of us
- **Breadth of surfaces:** native macOS desktop + iPhone app (Home Screen widgets for MRR/downloads/
  revenue) + web. We're web-only.
- **Multi-platform:** iOS **and** Google Play. We're iOS-only.
- **Daily** rank data (we run weekly cron).
- **Volume/difficulty/opportunity numbers** across countries — the ASA-data we deliberately don't
  fabricate (#78). They show numbers; we show "unmeasured." For a buyer who wants a number, they win
  that comparison at face value.
- **MCP server** exposing "every data point as a tool" for Claude/Cursor/Windsurf — a real
  agent-integration play we don't have.
- **Review sentiment + topic extraction** — a whole analytics surface we lack.
- **Aggressive pricing:** Indie $8/mo, Startup $20/mo, Agentic Scale $66/mo. *Far* below AppSprint
  ($99–199) and presumably below our tiers. They're racing to the bottom on price.

## Where ShipASO can still differentiate (honestly)
- **The push + proof loop.** Appeeky's listed features are *analysis/recommendation* — audits, scores,
  copilot advice. The site's "what's absent" notably omits A/B testing and creative tooling, and
  there's no clear "we draft the metadata change, you approve, we prove the rank moved" loop. ShipASO's
  identity is the **closed loop** (prepare → human-approve → push → prove movement), not just advice.
  *Verify this* — don't assume; their "Canvas workflow (insights → execution)" + ASC sync may close it.
- **Honesty as the wedge — but it's narrowing.** Appeeky shows volume/difficulty/opportunity *numbers*
  and download *estimates*. If those are estimates-as-fact, our "never present unmeasured data as
  measured" is a real counter-position — but only if we make the buyer care about it. Against a tool
  that just shows a confident number, "we're honest about what we didn't measure" is a harder sell
  than it was against vaguer competitors. This raises the stakes on the WWDC-2026 "Apple LLM-ranks
  now" thesis (aso-is-back-wwdc26.md): if keyword-volume numbers matter *less* and "is the app
  legitimately the real deal" matters *more*, our intent-grounding wins; if not, their data breadth wins.
- **RLHF / learning loop (#39 Part 2, just shipped).** Appeeky has an AI Copilot grounded in app data,
  but no stated mechanism that *learns from human edits to its proposals*. Our anonymized,
  encrypted edit-capture → composer-improvement loop is a differentiator **if** we actually train on it
  (it's currently dormant pending the RLHF secrets).

## Honest assessment
Appeeky is the clearest "they're building the same thing" signal yet — same agentic framing, same
feature names, more surfaces, lower price, MCP integration. ShipASO is **not** ahead on breadth, data,
platforms, or price. Our only defensible wedges are:
  1. the **closed push-and-prove loop** (if theirs really is advice-only — verify),
  2. **honesty/intent-grounding** (sharpest if the LLM-ranking thesis holds),
  3. the **learning-from-edits loop** (only if we activate + train on it).

This is the competitor to watch closely and to position *against* deliberately — not one to out-feature.

## Players
- **Erencan Arica (@imeronn)** — Appeeky's maker; shipping fast (ASC/ASA/Meta/TikTok/Google Play all
  "now run locally" as of Jun 20–21 2026).
- **Mostafa Esmaeili (@Mustayayy)** — the reply that surfaced this; an enthusiastic user, not the maker.
