# PRD 03 — Run-page "Listing audit" card

> Render the findings (PRD 02) as an instructive card on the run page. Depends on
> PRD 02. Vanilla JS, no build step — matches the existing `reasoningCard` style.

## Where
A new **"Listing audit"** card on the run page (`viewRun` in `public/app.js`),
placed ABOVE the diff card — the audit explains *why* the proposed changes, so it
reads first: audit → proposed changes → reasoning → approval gate.

## Layout
- **Header**: "Listing audit" + a one-line summary from `findingsSummary`
  ("3 fixes available · 1 critical") and the screenshot grade chip.
- **Findings list**, sorted as the engine returned (biggest wins first). Each row:
  - severity icon/color (critical=red ✗, warn=amber ⚠, good=green ✓, info=ℹ),
  - **title** (bold), **detail** (plain), **fix** (muted, prefixed "→ Fix:"),
  - an **impact chip**: `ranking` (blue) vs `conversion` (signal-green) vs
    `trust`/`completeness` (neutral) — so the user sees which lever each pulls,
  - optional `evidence` as a small mono tag.
- **Group by severity** (Critical → Warnings → Good → Info) with subtle dividers,
  OR a flat sorted list with severity color — pick the cleaner read; flat-sorted
  is likely better (the engine already prioritizes). Collapse `info`/`good` behind
  a "show all" if the list is long.

## Styling
Reuse the `.reasoning`/`.step` patterns + the existing severity colors
(`--bad`/`--warn`/`--signal`/`--dim`). Add `.finding`, `.finding .impact-chip`.
Respect `prefers-reduced-motion` (the card's reveal stagger).

## Empty / honest states
- **No findings at all** (rare — a great listing) → a green "Your listing is in
  great shape — no fixes found" state, not a blank card.
- **No-key run** → render the thin findings, then PRD 04's unlock CTA at the
  bottom of the card.
- **A surface errored** → just fewer findings; no error noise (graceful, per 01).

## mock.js
`runAgentMock` must emit a representative `findings` array (a mix of severities +
impacts) + `findingsSummary` so the card renders in the demo/E2E without a key.
(Coordinate with PRD 02's mock changes.)

## TDD (E2E)
- A run with findings renders the "Listing audit" card with the expected rows,
  severities visible, and impact chips present.
- A critical finding renders in the critical/`--bad` treatment.
- `prefers-reduced-motion`: card renders fully, no stuck elements (mirror the
  existing movement-card reduced-motion test).
- The no-findings state shows the green "great shape" message.

## Acceptance
- The run page leads with an instructive audit card; findings are prioritized,
  labeled by impact, each with a concrete fix.
- Renders cleanly in all states (findings / none / no-key / reduced-motion).
- E2E green; no raw data rendered.
