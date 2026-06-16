# Competitive read — AppKittie (appkittie.com)

> Captured 2026-06-16 from appkittie.com (home + /mcp). Their site blocks plain
> crawlers; figures below are quoted from their own marketing copy, not verified
> independently. Re-check before citing externally — pricing/features drift.

## One-line

AppKittie is a **market-intelligence platform** for app founders/studios —
"observe and replicate how the best apps win." ASO copywriting is *one feature*
inside a much broader competitive-espionage toolbox. We are an **execution
tool**: we ship your metadata and prove the rank moved.

## What they offer

| Capability | Notes |
|---|---|
| Revenue & download estimates (iOS + Android) for any app | The core data moat — find high-revenue apps to copy |
| Winning Ads library + Ad Spend tracker | Competitors' creatives, spend, and which countries they target |
| Creator / Influencer tracker | Which TikTok/IG creators winning apps collaborate with |
| App Discovery engine | 30+ filters: revenue, downloads, growth, ratings |
| Global / regional market rankings | Spot regional hits to replicate |
| Keyword & ASO intelligence | Keyword difficulty + traffic score; "personalized ASO suggestions" |
| Screenshot generator + translator | Productized — this is our parked #26 ("Studio") |
| Review mining | Sentiment, feature requests, complaints across competitors |
| **MCP server + 9 AI skills** | Cursor/Claude/Windsurf; credit-metered (see below) |

**MCP surface (the overlap that matters):** hosted MCP at `mcp.appkittie.com`,
6 tools (`search_apps`, `get_app_detail`, `get_keyword_difficulty`,
`batch_keyword_difficulty`, `get_app_reviews`, `get_supported_countries`) +
9 skills. One skill is **"Metadata Optimization" — write optimized title,
subtitle, keyword field, description, 3 variants with character counts.** That
is our core loop, offered as a single skill. Install motion is identical to ours
(`claude mcp add appkittie …`).

**Pricing:** $99/mo, or $69/mo billed yearly ($828). One tier, everything
included. 3-day free trial. 5,000 API credits/mo; MCP tools are credit-metered
(search 1, keyword difficulty 10, etc.). Target: "app founders, app studios,
developers and growth teams." Heavy logo wall (Snapchat, Stripe, Supabase, Rork).

## What they have that we don't

- Revenue/download estimates and the whole **data moat** (we read public
  metadata + rank, not $$).
- **Ad spy + ad-spend tracking** (our Google Ads API push was rejected — we have
  no ads surface at all).
- Creator/influencer intelligence; app discovery; market rankings; review mining.
- A **live, paid MCP server** + skills marketplace presence.
- A shipped **screenshot generator** (our #26, still a backlog issue).
- Competitor analysis (our #25, still a backlog issue).

They are ahead on **breadth** and on the **two things we parked** (#26, #25).

## Where we win (and it's real)

1. **We close the loop; they hand you a suggestion.** Their skill writes 3
   variants — then the dev copy-pastes into App Store Connect and never learns if
   it worked. We do audit → research → optimize → **push (via `.p8`) → verify the
   rank moved.** That last mile is the wedge. They're intelligence; we're
   execution.
2. **We read the live listing and improve it; they generate from scratch.** The
   #30 work — reading real subtitle/keywords via ASC and treating them as a floor
   so we never regress a good listing — is a correctness property a "write 3
   variants" generator structurally lacks.
3. **The `.p8` never persists.** Ephemeral, per-request. A trust differentiator
   for a tool that touches the user's live store account.
4. **Free + MIT plugin.** Their floor is $99/mo. Our zero-friction OSS on-ramp is
   an acquisition funnel they can't match.

## Strategic read

- **Not a pure competitor — a *superset* with a shallower last mile.** AppKittie
  is "Bloomberg terminal for apps"; ASO writing is one tab. We are "the robot
  that ships your metadata and proves the rank moved."
- **Don't out-breadth them.** Revenue estimates and ad-spy need a data moat we
  don't have and shouldn't try to build pre-PMF.
- **Lean into the closed loop + "free vs. $99."** Position ShipASO as the
  *execution layer* that takes any ASO recommendation — even one from AppKittie —
  and actually ships + verifies it. Complementarity story, not just competition.
- **Our one sentence:** *"AppKittie tells you what to write. ShipASO writes it,
  ships it, and proves the rank moved."*

## Implications for the backlog (not launch — after)

- **#26 (Studio screenshots)** and **#25 (competitor war room)** are no longer
  speculative — a funded competitor ships both. Re-weight when we get to Phase 3.
- **MCP server** is now a proven distribution channel for this exact buyer. See
  [`../prd/mcp-server.md`](../prd/mcp-server.md). **Deferred — post-launch.**

## NOT changing for launch

Knowing where AppKittie is does **not** change the launch plan. We launch the
closed-loop product we have (audit → push → verify, free plugin + hosted agent).
The MCP server and the breadth features are explicitly post-launch.
