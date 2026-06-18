# PRD 01 — "Fix this" panels on visual findings (Phase A)

> Each visual finding currently dead-ends ("your screenshots score D" → nothing).
> Add a "Fix this" panel that turns the diagnosis into a path: curated tool
> recommendations + a link to the ShipASO brief (PRD 02). Cheap, ships on top of
> findings we already surface.

## Where it attaches
The findings card (shipped) already renders `screenshots_grade_low`,
`screenshots_thin`, `screenshots_no_ipad`, `preview_missing`,
`preview_thin_coverage`, `preview_error_state`. Each *visual* finding gets an
expandable "Fix this →" affordance in its row.

## Deliverable
A pure mapping `cloud/src/engine/fixSuggestions.ts`:
```ts
export type FixSuggestion = {
  findingId: string;             // which finding this fixes
  steps: string[];               // 2–4 concrete steps to fix it
  tools: Array<{ name: string; what: string; url: string; free: boolean }>;
  briefHook?: boolean;           // true → "Generate your screenshot brief" CTA (PRD 02)
};
export function fixesFor(findingIds: string[]): FixSuggestion[];
```
- A small **curated, static catalog** of genuinely-good tools per visual problem
  (screenshot design/templating tools; app-preview screen-record/edit tools). NOT
  affiliate-spam — tools we'd actually recommend. If affiliate links are ever
  added, a disclosure field is required.
- Tool list is data (a const map), trivially editable. No external calls.

## UI
- Each visual finding row gets a "Fix this →" toggle revealing:
  - the **steps** (e.g. "1. Lead with your strongest value prop. 2. Show the app
    in use, not a marketing banner. 3. Add captions tied to your top keywords."),
  - the **tool links** (name + one-line "what it's good for" + free/paid badge),
  - the **"Generate your screenshot brief"** CTA (→ PRD 02) when `briefHook`.
- Conversion-lane framing: a small note that these lift *conversion*, not rank
  (consistent with the findings impact chips).

## Honesty
- Curated, disclosed. Recommend tools on merit; never imply ShipASO is affiliated
  unless it is (and then say so).
- "These improve conversion, not ranking" — never let a user think new
  screenshots will move their keyword rank.

## TDD
Pure: `fixesFor` returns the right suggestions per finding id; visual findings get
tool lists + steps; non-visual findings return none; the brief hook is set only on
screenshot findings.

## Acceptance
- Each visual finding has an actionable "Fix this" panel (steps + curated tools +
  brief CTA).
- No external calls; the catalog is static + editable.
- Conversion-lane framing present; honesty rules met.
