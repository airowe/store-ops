# src/cron/ — the weekly autonomy loop (Worker scheduled handler)

Routed from `src/index.ts` `scheduled()` → `handleScheduled(env)` (wrapped in
`ctx.waitUntil`). Fires on the Cron Trigger `0 9 * * 1` (every Monday 09:00 UTC,
set in `wrangler.toml`). This is the product's core: autonomy with a human gate.

## What it does (BUILT) — `runWeeklySweep(env)`

For EACH connected app (`listAllApps`; per-app failures isolated):

1. **Build input** from the stored app row + the LAST competitor snapshot map
   (`getLatestCompetitorMap`) so the engine can diff this week vs last.
2. **Run the agent** against LIVE iTunes data (`runAgent`): audit, ranks,
   competitor watch+diff, keyword reasoning, propose copy, prepare push commands.
3. **Threshold check** (`evaluateThreshold`, pure + unit-tested):
   - a targeted keyword is still **unranked** (`rank === null`), OR
   - a competitor is **new** or its visible listing **changed**.
4. **Act**:
   - crossed **and** no run already open → `persistRun(status='awaiting_approval')`
     (records snapshots + proposals + generated push commands atomically) and
     surfaces it for human approval. The cron NEVER pushes.
   - otherwise → `persistRun(status='detected')` so the rank/competitor
     time-series stays complete every week without nagging the user.

## Idempotency

If an app already has an `awaiting_approval` run (`hasOpenRun`), the sweep still
records fresh snapshots but does **not** open a second gate — the human clears
the first one. D1 is the work queue; one `scheduled()` invocation walks all apps.

## Triggering locally

Miniflare doesn't auto-fire cron. Run `wrangler dev --test-scheduled` and hit
`GET /__scheduled?cron=0+9+*+*+1`. `runWeeklySweep` also returns a `CronReport`
(`{appsProcessed, runsOpened, perApp[...]}`) for manual invocation / tests.
