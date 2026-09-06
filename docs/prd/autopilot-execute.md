# Autopilot execution — the agent performs an approved run's writes

Status: **built** (migration 0017, 2026-09-06). Owner decision the same day:
"expand the agent's abilities in autonomous mode to be able to do everything
the agent's tools have available."

## What changed, and what did not

Before: the loop stopped at `approved`. The agent proposed, a person approved,
and then a person (or a hand-assembled curl) called each write route.

After, with `users.autopilot_execute = 1`: approval is still the human's act,
and it is the last one. The agent then does what the write routes do, in order,
with the stored key, records every step, and marks the run `shipped` when the
metadata write returned success from Apple.

**Approval is still the terminus** of the human's involvement. What moved is
who presses the buttons after it. Nothing here submits for review, releases,
starts an experiment, or touches a live `READY_FOR_SALE` version; those remain
buttons in App Store Connect.

## The gate

Autopilot never widens what a person could do by hand. `autopilotGate`
(`cloud/src/engine/autopilot.ts`) requires **all** of:

| Condition | Where it comes from |
|---|---|
| `autopilot_execute` on | `PATCH /account/autopilot {execute:true}`; refused unless consent is already on |
| `asc_write_opt_in` on | `PATCH /account/asc-writes {optIn:true}` (#405) |
| paid tier (`canAscWrite`) | billing |
| `ASC_WRITE_ENABLED` | deployment flag |
| run status `approved` | `recordApproval` — never `awaiting_approval`, never `shipped` |
| a stored key | per-app row, else the account-wide row (#560) |

Default is **off**. Existing users see no change until they turn it on.

## The plan, per run

`planAutopilot(trace, storefrontLocale)`:

1. **version** — use the editable version, or create the next patch of the
   highest parseable one. Never a guessed `1.0.0`.
2. **metadata** — `applyAscMetadata` with `proposedCopy` to the storefront locale.
3. **locale:\<code\>** — one per approved locale in `localizedCopy`; a locale
   Apple has no localization for is created once, then pushed.
4. **screenshots** — *skipped*: no rendered asset exists server-side (R2 does
   not exist; rendering is on the developer's machine, see `aso-goldie-config`
   and `asc-screenshot-write-lane`).
5. **experiment** — *skipped*: a treatment needs those assets.

Steps 4 and 5 are recorded as skipped **with the reason**, not omitted. A
run page that says "shipped" also says what did not happen.

## The ledger

`run_executions` (one row per run × step; `done` / `skipped` / `failed` with a
detail string). `GET /runs/:id/executions` returns it. A failed step stops the
strip; later steps are recorded `skipped: not attempted: <reason>`. A run with
any execution row is **not retried** by the cron: the failure is for a person
to read, not for the agent to hammer.

`runs.status = 'shipped'` is written in exactly one place, `markRunShipped`,
guarded on `status = 'approved'`, only after a `metadata: done` row
(`runStatusWriters.spec.ts` pins this).

## Triggers

- Hourly cron (`handleScheduled`), after the sweep and digests, best-effort.
- `POST /runs/:id/approve`, `POST /runs/approve-all`, and turning the flag on,
  each via `ctx.waitUntil(runAutopilot(env))`, so an approval acts within
  seconds rather than at the next hour. Double triggers are harmless: a run
  with execution rows is skipped.

## Deploy order

Migration 0017 (`users.autopilot_execute`, `run_executions`) must be applied
before the Worker that reads them. The getters tolerate its absence (column
→ off, table → empty) so a mis-ordered deploy degrades to "autopilot off",
never to a broken `/auth/me`.

## Not yet

- A dashboard switch. The two `PATCH` routes exist; the settings page does
  not show them.
- Google Play. No Play write beyond the data-safety CSV exists to automate.
- Notifications on execution. The run page is the record; a digest line is a
  follow-up.
