# Phase 3 — agent-opened runs, legible in a list

Status: **planned**. Independent of Phases 1–2; sequenced third because it is
the smallest.

## Problem

`RunTriggerNote` tells the story correctly — "ShipASO opened this run on its
own" — but only on the run detail page (`RunView.tsx:328`). A run *list* shows
status badges with no actor: a run the agent opened unprompted and a run the
user clicked "run now" for look identical.

That flattens the exact distinction the product is selling.

## Goal

In any list of runs, an agent-opened run is distinguishable from a
human-requested one at a glance, without a click.

## Approach

Reuse `runTrigger.ts` — it already resolves `actor: "agent" | "human" |
"system"` from the stored trigger, is unit-tested, and is deliberate about not
overstating. **Do not re-derive actor anywhere.** This phase adds a compact
renderer, not new logic.

Surfaces: the portfolio runs list (`features/portfolioRuns`), the app detail
run history, and the dashboard's latest-run badge.

Presentation: a small actor marker plus a `title`/`aria-label` carrying the
headline `runTrigger` already produces. An older run with no stored trigger
renders **no marker** — `runTrigger` returns null and the correct rendering of
"we do not know who opened this" is silence, not a guess. That rule already
exists in `RunTriggerNote`; this phase inherits it rather than restating it.

## Requirements

- Actor comes from `runTrigger(trigger)`, never from re-reading the trace.
- A null trigger renders nothing at all, and a test asserts that specifically —
  it is the case most likely to regress into a plausible-looking default.
- The marker is not colour-only (accessibility, and it must survive a
  screenshot in the landing page).

## Tests

- agent / human / system triggers each render their distinct marker.
- Null trigger renders no marker and no placeholder.
- The accessible name matches `runTrigger`'s headline, so screen readers get
  the same sentence sighted users get on hover.
