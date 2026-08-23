# Phase 1 — loop state on the API

Status: **planned**.

## Problem

`AppListItem` (`packages/api/types.ts:44`) is the dashboard's whole view of an
app:

```ts
export type AppListItem = {
  id: string;
  name: string;
  bundle_id: string;
  latest_run: { status: RunStatus; created_at: string } | null;
  rank_summary: RankSummary | null;
  findings_summary: FindingsSummary | null;
};
```

Nothing about the loop. The data exists in D1 — `app_settings.last_sweep_at`,
`app_settings.schedule_json`, and `runs.reasoning_json -> $.trigger.source` —
but no endpoint returns it, so no surface can show it.

## Goal

`GET /apps` and `GET /apps/:id` carry enough loop state to render "the agent is
running this" without a second request.

## The shape

```ts
/**
 * What the autonomous loop has done for this app. Every field is nullable
 * because an app can predate the sweep, or never have been swept.
 */
export type LoopState = {
  /** ISO. null = never swept (a new app, or one connected before the stamp existed). */
  last_sweep_at: string | null;
  /** ISO of the next scheduled slot. null when we cannot compute one. */
  next_sweep_at: string | null;
  /** Runs this app's agent opened by itself. 0 is a real measurement here. */
  agent_run_count: number;
  /** ISO of the FIRST agent-opened run — "watching since". null if none. */
  agent_since: string | null;
};
```

`AppListItem` gains `loop: LoopState | null`.

**Why a nested object rather than four flat fields:** the four are meaningless
apart — a `next_sweep_at` with no `last_sweep_at` is a schedule, not a history —
and grouping lets the UI branch once on `loop === null` for a pre-sweep app.

**Why `agent_run_count` is a number and not nullable:** unlike a rank, zero
agent runs is a fact we measured (we counted the rows), not an absence of
measurement. It renders as "not yet" in the UI, not as "—".

## `nextSweepAt` — new, and the one piece of real logic

`schedule.ts` has `isSweepDue(schedule, lastSweepAt, now)` but **no function
that returns the next slot**. Phase 1 adds one:

```ts
export function nextSweepAt(schedule: SweepSchedule, now: Date): Date
```

Pure, exported, unit-tested alongside `isSweepDue`. Rules:

- `weekly` / `biweekly` — the next UTC datetime matching `day` + `hourUtc`
  strictly after `now`. Biweekly returns the next matching slot; whether the
  sweep *fires* on it still depends on `isSweepDue`'s min-gap, so this is
  documented as **the next slot, not a guarantee of a run**.
- `daily` — the next occurrence of `hourUtc`, today or tomorrow.

The distinction matters for honesty: a biweekly app can see a slot pass without
a sweep. UI copy is "next check" rather than "next run" for that reason.

## Cost

`listApps` already does per-app `getRun` in a `Promise.all` loop, so the shape
of the N+1 is pre-existing. Loop state adds per app:

- one `app_settings` read (`last_sweep_at` + `schedule_json`) — the existing
  `getLastSweepAt` reads the same row and can be widened rather than doubled
- one aggregate over `runs` for count + earliest

**Both fold into a single query joined onto the existing app list**, and that is
the requirement, not an optimization: adding two more sequential awaits per app
to a loop that already has one would be a visible regression on a 12-app
account. The aggregate is `GROUP BY app_id` over `runs` filtered on
`json_extract(reasoning_json,'$.trigger.source') = 'cron'`.

Verify against the owner's 12-app account before and after; a measurable
increase in `GET /apps` latency fails this phase.

## Tests

- `nextSweepAt`: each cadence, a slot later today, a slot that has passed today
  (rolls to the next), month and year boundaries, and DST-irrelevance (all UTC).
- `LoopState` assembly: never-swept app → `last_sweep_at: null`,
  `agent_run_count: 0`; an app with cron runs → correct count and earliest.
- A run whose trigger source is `human` or absent is **not** counted as an
  agent run. This one needs a negative control — seed a human-triggered run and
  assert the count does not move.
- `GET /apps` shape unchanged for existing fields (no accidental break).
