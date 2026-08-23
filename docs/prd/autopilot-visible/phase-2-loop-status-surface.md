# Phase 2 — the loop status surface

Status: **planned**. Depends on Phase 1.

## Problem

A user lands on the dashboard and sees a list of apps with run-status badges.
Nothing tells them work happened while they were away. The product's whole
proposition is unrepresented on its own landing surface.

## Goal

One component, used on both the dashboard and app detail, that states what the
loop has done and when it runs next — legible in under two seconds.

## The component

`LoopStatus` (`features/dashboard/LoopStatus.tsx`), consuming `LoopState`.

**Fully-measured state** (the common case):

```
● Agents active · last checked 3 days ago · next check Monday 09:00 UTC
  9 checks run for you since June 13. You approved 2.
```

**Never-swept state** (a just-connected app):

```
○ Agents active · first check Monday 09:00 UTC
```

**No schedule computable** (`next_sweep_at === null`):

```
● Agents active · last checked 3 days ago
```

Never a fabricated next slot. Measured-or-nothing applies to a future time the
same way it applies to a rank.

## Copy rules

These are the load-bearing decisions, and the tests should pin them:

1. **"Checks", not "runs".** A biweekly app can see a slot pass without a
   sweep firing (min-gap), so "next run" would occasionally be wrong. "Next
   check" is true either way.
2. **Never "managing" or "handling" your ASO.** The agent watches, finds, and
   prepares. Approving and submitting are the user's. This is the same
   constraint that makes the "autopilot" framing defensible.
3. **The approved count is stated only when > 0.** "You approved 0" reads as an
   accusation; silence is the honest rendering of nothing-yet.
4. **Relative time, absolute schedule.** "3 days ago" for the past (a user
   knows what that means without arithmetic) and an explicit UTC slot for the
   future (they may want to be around for it).

## Placement

| Surface | Where | Scope |
|---|---|---|
| Dashboard | Directly under the greeting, above the app grid | Aggregated across all apps |
| App detail | Under the app header, above the rank chart | That app only |

Dashboard aggregation: `last_sweep_at` = most recent across apps,
`agent_run_count` = sum, `next_sweep_at` = soonest. An account whose apps are
all never-swept shows the never-swept variant.

## What this is not

Not a live activity feed, not a progress animation, not a "thinking" state. The
sweep takes seconds and happens weekly; anything implying continuous motion
would be dishonest about a discrete process. The evidence is the dated history.

## Tests

- Each of the three states renders its documented shape.
- `agent_run_count: 0` → no approved-count line, no "0 checks".
- `next_sweep_at: null` → no next-check clause, and no invented one.
- `last_sweep_at: null` → never-swept variant, not "last checked never".
- Aggregation: 3 apps with different sweep times → newest last, soonest next,
  summed count.
- Copy guard: the rendered text must not contain "manage", "manages",
  "managing", "ships", or "shipped for you". A cheap regex test, and the one
  most likely to catch a well-meaning future copy edit that breaks the
  invariant.
