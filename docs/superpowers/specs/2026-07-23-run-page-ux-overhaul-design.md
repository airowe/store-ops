# Run Page UX Overhaul — Design

**Date:** 2026-07-23
**Status:** Approved (design validated via live review + user decisions)
**Surface:** `cloud/web/src/features/run/*` + `cloud/web/src/app.css`
**Origin:** live design review of the Approve/Reject run page (artifact 3f2018e4)

## Goal

Turn the run report from a 4.3-screen document you *read* into a page you can
*act on* — surface the decision, encode severity as form, and cut repetition —
without losing any of the (genuinely good) analysis it already shows.

## Constraints that bind the whole overhaul

- **Client-only.** No API/DB/engine change. All data already arrives in the run
  detail response (`RunDetail`, `Finding[]`, `Opportunity[]`, `CopyFields`,
  `localizationExpansion`, etc.). We only change presentation.
- **Honesty invariant preserved.** Nothing may fabricate or hide a real signal:
  a collapsed "good" section still states what's inside; an unscored keyword
  still reads "not enough data", never a made-up number.
- **Design tokens only.** Colors come from the existing token set
  (`--signal`, `--warn`, `--bad`/`--danger`, `--ink`, `--dim`, `--faint`,
  `--panel`, `--line`). No new hardcoded hex. Severity color is semantic, not
  the accent.
- **Additive-safe.** Every existing card keeps its data-testids and its current
  behavior unless a finding explicitly changes it; existing run tests stay green.
- **Accessibility.** New interactive controls (collapse toggles, the sticky bar,
  the section rail) are real buttons/links with visible focus and correct
  contrast; respect `prefers-reduced-motion` on any transition.

## The seven findings → components

| # | Finding | Component(s) |
| --- | --- | --- |
| 1 | Sticky decision bar | `RunView.tsx`, `app.css` |
| 2 | Top decision summary | new `DecisionSummary.tsx`, `RunView.tsx` |
| 3 | Severity stripes + collapse healthy | `FindingsCard.tsx` |
| 4 | Unscored keyword presentation | `OpportunitiesCard.tsx` |
| 5 | Token keyword diff | `CopyDiff.tsx` (keywords field) |
| 6 | Markets ranked table | `LocalizationExpansionCard.tsx` |
| 7 | Sticky section rail | new `SectionRail.tsx`, `RunView.tsx`, `app.css` |

## Finding 1 — Sticky decision bar

A bar fixed to the bottom of the viewport whenever a run is **open**
(awaiting_approval and not tier-limited — the same condition that renders the
inline Approve/Reject today). Contents:
- **Left:** a compact net summary — `N keyword changes · M fixes` (derived from
  the same data the summary header uses).
- **Right:** filled primary **Approve changes** + quiet ghost **Reject**, wired
  to the existing `decide.mutate("approve"|"reject")`.

The existing inline button row is **removed** (the sticky bar replaces it) so
there's one decision locus, not two. When the run is not open (approved,
rejected, superseded, tier-limited), no bar renders — the current status line
behavior is unchanged. The bar must not overlap page content: the page gets
bottom padding equal to the bar height so the last card clears it.

Reduced-motion: the bar appears without slide animation.

## Finding 2 — Top decision summary

A `DecisionSummary` block rendered at the top of an open run, directly under the
`CopyDiff`, before the audit. It states the verdict at a glance:
- **keyword delta** — `+A / −B terms` from the current vs proposed keywords.
- **blocker count** — number of `critical`/`warn` findings (the ones that need
  the user), with the single most-severe title inline if there's exactly one.
- **everything-else count** — remaining `good`/`info`/context findings, as a
  quiet "N more checks".

Rendered as labeled pills (semantic color per lane). It reads before the detail;
the detail below is unchanged. On a non-open run it does not render.

## Finding 3 — Severity stripes + collapse healthy

`FindingsCard` already carries `Finding.severity` (`critical|warn|good|info`)
and an engine sort. Changes:
- **Severity stripe:** each actionable finding row gets a left color stripe
  (semantic: critical→`--bad`, warn→`--warn`, good→`--signal`, info→`--dim`),
  so severity is scannable as form, not just the small text label.
- **Sort blockers up:** within the actionable lane, order
  `critical → warn → info → good` (stable within a tier) so what needs action
  leads. (If the engine already sorts this way, preserve it; otherwise re-sort
  in the component — presentational only.)
- **Collapse healthy:** `good` (and `info` with no fix) findings collapse behind
  a disclosure — `▸ N healthy checks` — expanded on click. Blockers
  (`critical`/`warn`, and any finding with a `fix`) stay expanded. The
  disclosure still names the count honestly; nothing is hidden silently. The
  context-facts strip and the locked-surface CTA are unchanged.

## Finding 4 — Unscored keyword presentation

`OpportunitiesCard` already receives `Opportunity.scored`. Currently it renders
`score {N}` when `scored !== false`. Change: when `scored === false`, it already
shows "not enough data to score" — keep that. Additionally, replace the bare
`score {N}` for scored keywords with a **small winnability bar** (a 0–100 fill
using `--signal`) plus the number, so the score reads as a magnitude, not a
lone integer, and identical numbers no longer look like a copy-paste bug. The
"not enough data" branch shows no bar. (Note: the engine honesty fix #319 makes
fewer keywords render a number at all; this is the presentation half.)

## Finding 5 — Token keyword diff

The `keywords` field in `CopyDiff` currently renders as two comma-joined strings
(old struck, new highlighted). Replace **only the keywords field's** rendering
with a token diff:
- Split both sides on comma into trimmed terms.
- Removed terms (in current, not in proposed): struck + `--bad` tint.
- Added terms (in proposed, not in current): `--signal` tint.
- Unchanged terms: quiet (`--dim`), no decoration.
- Rendered as chips, wrapping. A summary line: `A added · B removed · C kept`.

Other fields (name/subtitle/promo) keep the existing string diff — a token diff
only makes sense for the comma-list keyword field. The char-budget count and
over-limit flag are unchanged.

## Finding 6 — Markets ranked table

`LocalizationExpansionCard` currently renders each locale with a repeated
sentence. Replace with:
- **One shared rationale line** at the top (the "translate existing copy to
  claim it" explanation, said once).
- A **compact ranked table**: locale (with its market-size tag), and a relative
  **size bar** so the ROI ordering the section already claims is visible. Rows
  stay in the received order (the engine's ROI sort). Each row keeps its locale
  code and the per-market descriptor as a short cell, not a full sentence.

Honesty: the header still says "market-size heuristic, not live install data".

## Finding 7 — Sticky section rail

A slim rail (sticky, right or left gutter on wide viewports; hidden/inline on
narrow) listing the run's sections — Changes · Audit · Metadata · Keywords ·
Markets · Screenshots — each a jump link to that card. The active section
highlights on scroll (IntersectionObserver). On narrow viewports the rail
collapses to nothing (the page is single-column; the sticky action bar carries
the decision). Sections that aren't present in this run don't appear in the rail.

## Structure & testing

- New pure/near-pure pieces (`DecisionSummary`, `SectionRail`, the token-diff
  helper, the winnability-bar) are small and unit-tested (`*.test.tsx`, jsdom).
- Each finding is independently testable and independently reviewable — the plan
  makes each its own task + commit.
- Full web suite (currently 217) must stay green; each task adds its own tests.
- No API/DB/migration; `tsc --noEmit` clean; the token-contrast guard from #320
  still passes (no new hardcoded muted hex).

## Out of scope (YAGNI)

- Any engine/API change (score logic already fixed in #319; markets ROI sort
  already exists).
- Reordering the actual cards beyond the summary header placement.
- New run data or new endpoints.
- Mobile-app (RN) changes — this is the web run view.
