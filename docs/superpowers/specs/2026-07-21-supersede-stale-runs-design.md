# Supersede stale awaiting_approval runs

## The bug (found in the funnel investigation)

When the agent re-runs an app, the PREVIOUS run stays at `awaiting_approval`
forever — nothing closes it. So an app that's been iterated on accumulates
phantom "pending" runs (Mangia: 9 stuck / 16 total; Heathen: 4 / 13). This:
- clutters the run list with dead runs that look actionable but aren't,
- makes every funnel/analytics query lie ("24 abandoned proposals" was mostly
  supersession, not abandonment).

Only the NEWEST `awaiting_approval` run per app is real; older ones are
superseded iterations.

## Fix

Add a terminal `superseded` status. When `persistRun` writes a new
`awaiting_approval` run for an app, atomically flip any prior `awaiting_approval`
runs for that same app to `superseded` — in the SAME batch, so the invariant
"at most one open run per app" can never be violated by a race.

- `approved` / `rejected` / `shipped` runs are NEVER touched — only a still-open
  `awaiting_approval` is superseded (a decided run is history, not a phantom).
- Supersession fires ONLY when the new run is itself `awaiting_approval` (a real
  proposal replacing older pending ones); a `detected`/`researching` run doesn't
  supersede.

## Changes

1. **`RUN_STATUSES`** (`cloud/src/engine/constants.ts`) — add `"superseded"`.
2. **Schema** — widen the `runs.status` CHECK to include `'superseded'`, in
   `schema.sql` (baseline) + a new migration `0006_run_superseded.sql`. Because
   SQLite can't `ALTER` a CHECK, the migration is a table-rebuild
   (create-new → copy → drop → rename), guarded `IF NOT EXISTS`-style so it's
   safe. (Mirrors the #78-2 `stored_credentials` kind-CHECK widening precedent.)
3. **`persistRun`** — when `args.status === "awaiting_approval"`, prepend to the
   batch:
   `UPDATE runs SET status='superseded' WHERE app_id=? AND status='awaiting_approval'`
   (runs before the new INSERT, so the new run isn't self-superseded — it doesn't
   exist yet in the batch's view; and even if ordering surprised us, the new
   run's id differs, so add `AND id != ?` defensively).
4. **Backfill** — the migration also flips existing stale rows: for each app,
   keep the newest `awaiting_approval` run, mark the rest `superseded`. One SQL
   statement. So the current 13 phantom runs resolve on deploy.

## Honesty / safety

- Never touches a decided run (`approved`/`rejected`/`shipped`).
- `hasOpenRun` already filters to `awaiting_approval`, so it automatically ignores
  superseded runs — no change needed; the "one open run" check gets MORE correct.
- `listRunsForApp` returns all statuses (newest-first) — a superseded run now
  reads as clearly resolved instead of a phantom pending.

## Testing

- `d1.supersedeRuns.spec.ts` (real-SQLite schema harness, like the other
  `*Schema.spec.ts`):
  - persisting a 2nd `awaiting_approval` run for an app supersedes the 1st,
  - a decided (`approved`/`shipped`) prior run is NOT superseded,
  - a run for a DIFFERENT app is untouched,
  - the new run itself stays `awaiting_approval` (not self-superseded),
  - the migration backfill: given N stale `awaiting_approval` rows for one app,
    only the newest survives as open, the rest become `superseded`.
- `RUN_STATUSES` includes `superseded` (a constants test if one exists).

## Out of scope

- Any UI change to render `superseded` specially — `listRunsForApp` already
  carries the status; the client can style it later. This PR fixes the data.
