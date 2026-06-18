# PRD 02 — ASO-aware screenshot brief (Phase A — the differentiator)

> The piece no external tool can give: a per-shot brief telling the user WHAT to
> show in screenshots 1–N, derived from their actual keywords, audit, and ranking
> data. Any tool makes a pretty image; only ShipASO knows "lead with 'meditation'
> in shot 1 — it's your winnable keyword and you're invisible for it."

## The fusion (data we already have)
- **Top keywords / opportunities** (rankOpportunity, keyword scoring) → what to
  emphasize, in priority order.
- **Audit** (screenshot grade, count) → how many shots to plan, what's missing.
- **Competitor listings** (competitorWatch) → what rivals lead with (differentiate).
- **The app's own copy** (name/subtitle/description via ASC) → the value props.

## Deliverable
`cloud/src/engine/screenshotBrief.ts` — pure:
```ts
export type ShotPlan = {
  position: number;              // shot 1, 2, 3...
  focus: string;                 // "Lead value prop: calm without the spiritual woo"
  keyword?: string;              // the keyword this shot reinforces (if any)
  caption: string;               // a suggested caption (≤ a sane length)
  rationale: string;             // WHY this shot, this position (the ASO logic)
};
export type ScreenshotBrief = {
  recommendedCount: number;      // how many shots to ship (from audit + best practice)
  shots: ShotPlan[];             // ordered; first 2–3 carry most installs
  note: string;                  // honesty frame
};
export function screenshotBrief(input: {
  opportunities?: Opportunity[]; // from rankOpportunity
  audit: Audit;
  copy?: { name?; subtitle?; description? };
  competitors?: CompetitorListing[];
}): ScreenshotBrief;
```
- Shot 1 leads with the top winnable keyword / strongest value prop. Shots 2–3
  reinforce the next opportunities. Later shots cover proof/features.
- `recommendedCount` from the audit (e.g. "you have 2, plan for 6").

## UI
- A "Screenshot brief" panel (reachable from the Fix-this CTA, PRD 01, and/or the
  audit card): the ordered shot plan, each with focus + caption + the *why*.
- A "copy brief" button → exports the plan as text the user can hand to a designer
  or an image tool (mirrors the #35 agent-prompt export pattern).

## Honesty
- The brief is a *starting point / recommendation*, not a guarantee. "Here's a
  high-conversion structure based on your keywords" — never "do this and you'll
  rank/convert N% better."
- Conversion lane: this is about turning views into installs, not moving rank.
- Degrades gracefully: without ASC/opportunities it still gives a sound
  best-practice structure (just less personalized) + nudges connecting ASC.

## TDD
Pure: shot 1 leads with the top opportunity keyword; recommendedCount derives from
audit count; competitor differentiation reflected; no over-promise language; graceful
without opportunities/ASC.

## Acceptance
- `screenshotBrief` produces an ordered, keyword-prioritized shot plan with
  rationale, from the data we already compute.
- The panel renders + has a copy/export action.
- This is the differentiator — every shot's rationale ties to the user's real ASO
  data, which no external screenshot tool can replicate.
