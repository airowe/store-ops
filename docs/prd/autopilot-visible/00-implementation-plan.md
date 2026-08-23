# Autopilot, made visible — implementation plan

Status: **planned**. Scoped against the codebase and production D1 on 2026-08-23.

## Problem

The product's single differentiating property — that it works while you are not
looking — is invisible in its own interface.

Measured in production:

| App | total runs | opened by the agent | since |
|---|---|---|---|
| Heathen — Secular Meditation | 29 | 9 | 2026-06-13 |
| Mangia — Recipe Manager | 20 | 9 | 2026-06-16 |
| WeatherThere — Trip Forecast | 12 | 9 | 2026-06-16 |
| Who Got Cooked | 11 | 7 | 2026-07-04 |

Three months of unattended operation. A user cannot see any of it.

The one place that tells the story is `RunTriggerNote` (`RunView.tsx:328`) —
"ShipASO opened this run on its own", with the observations that triggered it.
It is well-built and carefully worded (it never overstates the actor). It is
also reachable only by opening a specific run, which means you must already
know there is something to look at.

The pages a user actually lands on say nothing:

| Surface | Shows today | Says about the loop |
|---|---|---|
| Dashboard | app list, run status badge, approve-all | nothing |
| App detail | ranks, findings, competitors | nothing |
| Run detail | verdict, diff, `RunTriggerNote` | ✅ correct already |

The API is the hard blocker. `AppListItem` (`packages/api/types.ts:44`) carries
`latest_run`, `rank_summary`, `findings_summary` — and no loop state at all. The
dashboard cannot render the claim because the data never arrives.

## Goal

A signed-in user can see, without clicking into anything, that agents are
running their ASO: when the loop last ran, when it runs next, and how much work
it has done unattended. The same surface becomes the marketing asset for the
"ASO on autopilot" hook.

## Non-goals

- **A live "agent working" animation.** The sweep fires Monday 09:00 UTC and
  completes in seconds; a continuous-activity animation would be theater for a
  process that is not continuous. A timeline of real dated runs is stronger
  evidence precisely because it is checkable.
- **Changing what the agent does.** This is a visibility change end to end. No
  new triggers, no new cadence, no change to what opens a gate.
- **Rebuilding trigger copy.** `runTrigger.ts` already resolves actor +
  headline + reasons and is well-tested. Everything here consumes it.
- **Per-app scheduling UI.** `schedule.ts` supports daily/weekly/biweekly and
  the settings surface exists; exposing more controls is separate work.

## Honesty constraints

Two repo invariants bind this work directly, and the second one is the reason
the hook is defensible at all:

1. **Measured-or-nothing.** An app that has never been swept shows "—" or a
   plain "not yet swept", never a fabricated cadence. `last_sweep_at` is
   nullable and pre-dates some apps; null renders as absence.
2. **Approval is the terminus.** "Autopilot" must not imply the agent ships.
   Copy says the agent *watches, finds, and prepares*; approving and submitting
   stay the user's. The word autopilot is chosen deliberately over "autonomous"
   or "manages": everyone knows an autopilot still has a pilot.

## Phases

| Phase | What | Why this order |
|---|---|---|
| [1](phase-1-api-loop-state.md) | Loop state on `AppListItem` + app detail | Nothing can render without it |
| [2](phase-2-loop-status-surface.md) | The status strip on dashboard + app detail | The in-product surface |
| [3](phase-3-agent-run-provenance.md) | Agent-opened runs marked in run lists | Makes the history legible |
| [4](phase-4-landing-proof.md) | Landing page proof, screenshotted from Phase 2 | The ad is the real product |

Phases 1–3 ship value independently. Phase 4 depends on 2 existing to
photograph, and on **#495 being deployed** — see below.

## Dependency: #495 must land first

Until PR #495 deploys, the loop opens no gates and notifies nobody:

- `hasOpenRun` had no age limit, so one unapproved run made an app permanently
  ineligible for a new gate (#492). Every production app was in that state.
- No real user had a device token, so the notification path was a no-op for
  them anyway (#494).

Advertising "ASO on autopilot" while the autopilot is jammed would be a false
claim about our own product. Phase 4 in particular must not ship before #495 is
live and a Monday sweep has been observed opening gates.
