# Visual assets — help users improve screenshots / videos / graphics

> ShipASO already GRADES visual assets (screenshot score, preview findings) but
> abandons users at the problem — the exact gap our wedge mocks ("every ASO tool
> tells you what to do and leaves you there"). This plans how we help users
> actually FIX their screenshots, preview videos, and graphics. Two tiers,
> sequenced: **link out now** (cheap, immediate), **build our own later** (moat).

## The strategic frame (why this, why now)

- We DIAGNOSE the visual gap today: `screenshots_grade_low`, `screenshots_thin`,
  `preview_missing`, `preview_thin_coverage` findings. Every one of those is a
  dead end right now — "your screenshots score D" with no path forward.
- AppKittie ships a screenshot generator; #26 ("Studio" tier) is our parked answer.
- **Conversion (visuals) is the half of ASO our metadata loop doesn't touch.**
  Closing it makes ShipASO a complete listing tool, not just a keyword tool.

## Two phases (sequenced, not either/or)

### Phase A — Link out (ship now, ~no build)
Each visual finding gets a **"Fix this" panel** with curated, honest tool
recommendations + a templated brief. Zero asset-generation infra. Immediate value,
and it teaches us which fixes users actually pursue (signal for Phase B).

- **screenshot finding → tools for App Store screenshots** (template/design tools).
- **preview finding → tools for app preview videos** (screen-recording/editing).
- Plus a **ShipASO-generated brief**: "Here's what to show in your first 3
  screenshots based on your top keywords + audit" — the part NO external tool
  gives, because it requires the ASO context we already have.

### Phase B — Build our own (post-revenue, the #26 "Studio" moat)
Generate the fix in-product: AI screenshots/graphics tied to the audit + keywords.
This is the premium tier. Build only after Phase A shows demand + we have revenue.
Likely uses an image-gen pipeline (the plugin ecosystem already exposes
image/video MCP tools — higgsfield, pika, etc. — worth evaluating vs. building).

## The honesty + brand rules (carry from the rest of the product)

- **Link-outs are curated, not affiliate-spam.** Recommend genuinely good tools;
  if we ever take affiliate revenue, disclose it. Don't recommend a tool we
  wouldn't use.
- **The brief is the differentiator.** Any tool can make a pretty screenshot;
  only ShipASO can say "lead with 'meditation' in shot 1 because that's your
  winnable keyword." Tie every recommendation to the user's actual audit + ranking
  data. That's the moat even in the link-out phase.
- **Don't over-promise generation.** Phase B says "draft" / "starting point,"
  never "we'll make you rank." Visuals drive conversion, not ranking (the
  impact-lane discipline from the findings work).
- **Conversion lane, labeled.** These features improve conversion, not rank — say
  so, consistent with the findings impact chips.

## PRD suite

| PRD | Phase | Scope |
|-----|-------|-------|
| [`01-fix-this-linkout.md`](./01-fix-this-linkout.md) | A (now) | "Fix this" panels on visual findings: curated tools + the ASO-aware brief |
| [`02-screenshot-brief.md`](./02-screenshot-brief.md) | A (now) | The generated brief — what to show, per shot, from keywords + audit |
| [`03-studio-generation.md`](./03-studio-generation.md) | B (later) | The #26 Studio tier — generate screenshots/graphics in-product (evaluate MCP image tools vs. build) |

## Sequencing recommendation
**Phase A first (PRD 01 + 02)** — it's nearly free, ships real value on top of
findings we already surface, and the *brief* (02) is the genuinely differentiated
piece. Phase B (Studio generation) stays parked as #26 until Phase A proves users
want visual help and there's revenue to justify the gen-infra cost.
