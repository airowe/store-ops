# PRD #52 — Agent controls: configurable cadence / schedule

> Status: Draft for owner review · Effort: **M** · **Requires a product DECISION before building** (see §9)

---

## 1. Problem & context

The autonomous loop — the product's core — fires on a **single, hardcoded, global cron**:

- `cloud/wrangler.toml:39-40` → `crons = ["0 9 * * 1"]` (every Monday 09:00 UTC).
- `cloud/src/index.ts:67-73` `scheduled()` → `ctx.waitUntil(handleScheduled(env))`.
- `cloud/src/cron/scheduled.ts:240-250` `handleScheduled()` → `runWeeklySweep()` walks **every** app via `listAllApps()` (`cloud/src/d1.ts:407-415`) and processes each one unconditionally on that one Monday tick.

There is **no per-user / per-app schedule anywhere**:

- `cloud/schema.sql` `apps` table (`:50-58`) has only `id, user_id, bundle_id, name, country, created_at` — no cadence/day/time columns. `AppRow` (`cloud/src/d1.ts:45-52`) mirrors this.
- No API surface to read or write a schedule (the `/apps/:id` routes in `cloud/src/api/index.ts:1877-1912` cover detail/run/ranks/deltas/war-room/share-card — nothing for scheduling).
- The dashboard app-detail view (`cloud/public/app.js:595-634`) has no cadence control.

**Why it matters.** Cloudflare cron triggers are **global to the Worker**, not per-record — so today every autopilot/fleet customer is swept at the same instant regardless of their timezone, release rhythm, or preference. Customers in APAC get a Monday-night sweep; a customer who ships on Thursdays would prefer a Friday review; a Fleet agency may want daily checks on hot apps and biweekly on stable ones. The fixed cadence was an acceptable launch simplification (per the issue: "post-launch-OK"), but it caps the value of the autonomy tier and is the most-requested control gap.

**Constraint that shapes the whole design:** Cloudflare crons cannot be created per-record. We must either (a) keep a **frequent global cron** that, on each tick, asks "which apps are *due* now?" against a stored schedule, or (b) move to **Durable Object alarms** (one alarm per app). See §3 for the recommendation.

---

## 2. Goal & non-goals

### Goal
Let an autopilot/fleet user choose, **per app**, *when* the autonomous sweep runs:
- **Cadence:** `weekly` (default, preserves today's behavior), `biweekly`, `daily`, or `off` (pause autonomy without disconnecting).
- **Day-of-week** (for weekly/biweekly) and **hour** + **timezone**, so "Friday 08:00 in the user's local time" is honored.
- A safe, backward-compatible default: any app with no explicit schedule continues to behave exactly like today (Monday 09:00 UTC).

### Non-goals
- **No new push behavior.** The agent still NEVER auto-pushes; the schedule only controls *when the sweep PREPARES* a run that lands in `awaiting_approval` (`cloud/src/cron/scheduled.ts:135-152`). The irreversible step stays gated behind human approval in the API. (Honesty/security §6.)
- **No sub-hourly / arbitrary-cron UX.** We expose a small, opinionated set (cadence + day + hour + tz), not a raw cron textbox.
- **No per-keyword or per-competitor scheduling.** One schedule per app.
- **No backfill / catch-up engine.** A missed tick (Worker downtime) is simply skipped; the next due tick runs. The time-series tolerates gaps (snapshots are recorded "every week regardless" — `cloud/src/cron/scheduled.ts:16-18` — but a skipped run is acceptable).
- **No change to the tier gate semantics.** Free/launch still get no standing autonomy (`canRunCron`, `cloud/src/billing.ts:40-42`); scheduling is an autopilot/fleet control.

---

## 3. Proposed approach (grounded in real files)

**Recommended: stored schedule + frequent global cron + a pure "is this app due?" gate.** (Option A.) Lowest-risk, reuses the existing sweep architecture, no new Cloudflare primitive, fully unit-testable.

### 3a. Change the cron frequency to hourly
`cloud/wrangler.toml:40` → `crons = ["0 * * * *"]` (top of every hour). The handler then filters to only the apps **due in this hour**. (Hourly is the resolution we expose; finer granularity is a non-goal.)

### 3b. Store the schedule on the app row
Add columns to `apps` (`cloud/schema.sql:50-58`) and to `AppRow` (`cloud/src/d1.ts:45-52`):
- `schedule_cadence TEXT NOT NULL DEFAULT 'weekly'` CHECK in (`'off','daily','weekly','biweekly'`)
- `schedule_dow INTEGER NOT NULL DEFAULT 1` (0=Sun … 6=Sat; 1=Mon preserves today)
- `schedule_hour INTEGER NOT NULL DEFAULT 9` (0–23)
- `schedule_tz TEXT NOT NULL DEFAULT 'UTC'` (IANA tz name, e.g. `America/New_York`)
- `schedule_anchor TEXT` (ISO date; biweekly phase anchor, nullable)

Defaults are chosen so **every existing app keeps Monday-09:00-UTC behavior** with zero migration data work.

### 3c. A pure `isAppDue()` gate (new, testable)
New file `cloud/src/cron/schedule.ts` exporting:

```ts
export type AppSchedule = {
  cadence: 'off' | 'daily' | 'weekly' | 'biweekly';
  dow: number;      // 0-6
  hour: number;     // 0-23
  tz: string;       // IANA
  anchor?: string;  // ISO date for biweekly phase
};

// Pure. Given a schedule and the current instant, is this the app's due hour?
export function isAppDue(schedule: AppSchedule, now: Date): boolean;

// Parse/normalize an AppRow's schedule_* columns into AppSchedule (with defaults).
export function scheduleFromRow(row: AppRow): AppSchedule;

// Validate + normalize a client-supplied schedule patch (clamp hour 0-23,
// dow 0-6, validate tz via Intl, default missing fields). Throws on bad cadence.
export function normalizeSchedule(input: unknown): AppSchedule;
```

`isAppDue` resolves "now" into the app's `tz` using `Intl.DateTimeFormat` (available in Workers runtime — `compatibility_flags = ["nodejs_compat"]`, `wrangler.toml:18`), compares the **local hour** to `schedule_hour`, the **local day-of-week** to `schedule_dow` (for weekly/biweekly), and for biweekly checks the ISO-week parity against `schedule_anchor`. `daily` ignores `dow`. `off` is always `false`.

> Timezone correctness note: because the cron fires hourly in UTC, "due at 08:00 local" is evaluated by formatting the current UTC instant *into the app's tz* and checking the resulting local hour. This automatically handles DST. We deliberately avoid storing a precomputed UTC hour (which would drift across DST boundaries).

### 3d. Wire the gate into the sweep
In `runWeeklySweep()` (`cloud/src/cron/scheduled.ts:103-191`), inside the per-app loop, **after** the existing tier gate (`:110-125`) add a due-check:

```ts
const schedule = scheduleFromRow(app);
if (!isAppDue(schedule, now)) {
  report.skippedNotDue++;
  report.perApp.push({ ...skipped-not-due entry... });
  continue;
}
```

`now` is threaded into `runWeeklySweep(env, now = new Date())` so tests can inject a fixed instant. Everything downstream (`buildAppInput` → `runAgent` → `evaluateThreshold` → `persistRun`) is unchanged. Rename is **not** required, but consider exposing the function as `runDueSweep` with `runWeeklySweep` as a back-compat alias to avoid churn in `handleScheduled` (`:240-242`) and any tests.

Extend `CronReport` (`cloud/src/cron/scheduled.ts:80-96`) with `skippedNotDue: number` and a `skippedNotDue?: boolean` per-app flag, mirroring the existing `skippedTier` pattern exactly.

### 3e. Read/write the schedule via the API
Add a route in the `/apps/:id` block (`cloud/src/api/index.ts:1889-1893`):

- `GET /apps/:id` already returns the app row — extend `appDetail` (`:1057-1065`) to include the `schedule` object (derived via `scheduleFromRow`).
- New `PATCH /apps/:id/schedule` (or `POST /apps/:id/schedule`) → `setAppSchedule(req, env, userId, appId)`:
  1. `requireOwnedApp(env, appId, userId)` (`:509-514`) — owner-scoped.
  2. **Tier gate:** `getTier` (`cloud/src/d1.ts:235-241`); if `!canRunCron(tier)` → `402` ("scheduling is an autopilot/fleet feature"). Mirrors the `connectApp` gate (`cloud/src/api/index.ts:758-774`).
  3. `normalizeSchedule(body)` → reject bad input with `400`.
  4. New `updateAppSchedule(db, appId, schedule)` in `cloud/src/d1.ts` (a guarded `UPDATE apps SET schedule_* = ? WHERE id = ?`, following the `setTier` pattern at `:247`).
  5. Return the normalized schedule.

Register the routes in the handler (`cloud/src/api/index.ts:1889-1893`) following the existing `seg.length === 3 && seg[2] === "..."` style. CORS `access-control-allow-methods` (`:167`) must add `PATCH` if we use PATCH (or just use POST to avoid the CORS change).

### 3f. Dashboard control
In `viewApp` (`cloud/public/app.js:595-634`), add a "Schedule" card next to the "Agent runs" card (`:626-631`): cadence dropdown, day-of-week dropdown, hour dropdown, timezone (default to `Intl.DateTimeFormat().resolvedOptions().timeZone`), and a Save that POSTs to `/apps/:id/schedule`. Gate visibility on tier (the dashboard already knows tier context for other gated UI). Show an honest helper line: *"The agent prepares a review on this cadence. It never pushes — you still approve every change."*

### Rejected alternative — Option B (Durable Object alarms)
One DO per app with `state.storage.setAlarm()`. More precise (exact-minute firing, no hourly scan) and scales without a growing per-tick fan-out, **but**: introduces a new Cloudflare primitive + binding + migration in `wrangler.toml`, a new DO class, alarm-rescheduling logic on every schedule edit, and harder local testing. Given current app volume, the hourly-scan cost is trivial and Option A reuses the proven sweep path. **Recommend Option A now; revisit DO alarms only if fan-out cost becomes real.** This is the DECISION flagged in §9.

---

## 4. Exact files to change + new files

### New files
- `cloud/src/cron/schedule.ts` — `AppSchedule` type, `isAppDue`, `scheduleFromRow`, `normalizeSchedule` (pure, no DB/network).
- `cloud/src/cron/schedule.spec.ts` — unit tests for the above (colocated `*.spec.ts`, per repo convention).

### Changed files
- `cloud/schema.sql` (`:50-58`) — add the five `schedule_*` columns + an inline `-- Migration for an EXISTING db:` `ALTER TABLE` block (matching the documented migration style at `:37-46` and `:133-134`).
- `cloud/src/d1.ts` — extend `AppRow` (`:45-52`) with `schedule_*`; widen the `SELECT` column lists in `getApp` (`:360-367`), `listAppsForUser` (`:387-405`), `listAllApps` (`:407-415`), and `createApp` (`:331-358`) so the new columns load; add `updateAppSchedule(db, appId, schedule)`.
- `cloud/src/cron/scheduled.ts` — import the schedule helpers; thread `now` into `runWeeklySweep`; add the `isAppDue` gate in the loop (`:107-125` area); extend `CronReport` (`:80-96`) with `skippedNotDue`.
- `cloud/src/api/index.ts` — `setAppSchedule` handler; extend `appDetail` (`:1057-1065`) to return `schedule`; register the route (`:1889-1893`); add `PATCH` to CORS methods (`:167`) only if PATCH is chosen.
- `cloud/wrangler.toml` (`:40`) — `crons = ["0 * * * *"]`; update the explanatory comment block (`:36-40`) to describe the due-check sweep.
- `cloud/public/app.js` (`viewApp`, `:595-634`) — the Schedule card.

### Docs
- `cloud/README.md` / `cloud/DEPLOY.md` — note the cron is now hourly and gates per-app on a stored schedule (one line each).

---

## 5. Test plan (TDD, `*.spec.ts` + Playwright e2e per repo conventions)

Follow the existing scaffold-stub → failing-test → implement flow. Pure logic and integration tests stay separate (the repo already splits e.g. `scheduled.spec.ts` pure tests from `tests/e2e/*.e2e.ts`).

### Unit — `cloud/src/cron/schedule.spec.ts` (new, pure, no network/DB)
Parameterize inputs; strong assertions; no unexplained literals.
- `isAppDue` weekly: true only at the matching local dow+hour; false on other hours/days.
- `isAppDue` daily: true at the matching local hour every day, ignoring dow.
- `isAppDue` biweekly: true on the matching dow+hour only on the in-phase week relative to `anchor`; false on the off week.
- `isAppDue` cadence `'off'`: always false.
- **Timezone/DST:** an app with `tz='America/New_York', hour=8` is due at the UTC instant whose New-York-local hour is 8 — assert both a winter (EST, UTC-5) and summer (EDT, UTC-4) instant resolve correctly. (This is the load-bearing correctness case.)
- `scheduleFromRow`: missing/legacy columns fall back to the Monday-09:00-UTC defaults.
- `normalizeSchedule`: clamps `hour` to 0–23 and `dow` to 0–6; rejects an unknown cadence (throws); rejects an invalid IANA tz; fills defaults for omitted fields.

### Unit — extend `cloud/src/cron/scheduled.spec.ts`
- `runWeeklySweep(env, fixedNow)` processes only apps whose schedule is due at `fixedNow`; not-due apps appear in `report.perApp` with `skippedNotDue: true` and are **not** passed to `runAgent` / `persistRun`.
- A not-due app's snapshots are NOT recorded (no run row), confirming the due-gate short-circuits before the agent runs.
- The existing tier-gate tests still pass (the due-gate sits after the tier gate; an off-tier app is still `skippedTier`, never reaching the due-gate).
- An app with `cadence='off'` is skipped even on its nominal Monday hour.

### Unit — extend d1 / api specs
- `updateAppSchedule` writes the columns and a subsequent `getApp` reads them back (mirror `d1.recordApproval.spec.ts` style).
- API: `POST/PATCH /apps/:id/schedule` returns the normalized schedule for the owner; `402` for free/launch tier; `404` for a non-owned app; `400` for bad cadence/tz. (Add to the api spec suite that already exercises owner-scoping + tier gates.)

### E2E — `cloud/tests/e2e/` (Playwright, e.g. new `schedule.e2e.ts` or extend `flows.e2e.ts`)
- Connect an app, open detail, change cadence to "Daily" + a tz/hour, Save, reload → the control reflects the saved schedule.
- The Schedule card is hidden/disabled for a free-tier user (gate visible end-to-end).
- Honesty copy assertion: the card states the agent never pushes (string present).

### Regression
- Full `npm test` (vitest) + `npx playwright test` green before commit. Run lint + typecheck (the user's quality gates) — `tsconfig.json` strict mode must still pass with the widened `AppRow`.

---

## 6. Honesty & security considerations

This product's core value is **honesty** — these are hard constraints, not nice-to-haves:

1. **The agent still NEVER auto-pushes.** The schedule only changes *when a sweep PREPARES* a run. The prepared run lands in `awaiting_approval` exactly as today (`cloud/src/cron/scheduled.ts:135-152`); `pushCommands` remain withheld until human approval (`cloud/src/api/index.ts:225,262`). No scheduling path may set status `approved`/`shipped` or emit push commands. This must be asserted in tests.
2. **Never present unseen data as measured.** A skipped tick (not due, paused, or Worker downtime) means **no run and no snapshot** for that hour — the UI must not imply a fresh check happened. The "rank trend" / "what moved" surfaces already render only recorded snapshots; we add nothing that fabricates a data point for a skipped cadence. A paused (`off`) app shows its last real run honestly, not a stale "as of now."
3. **Never persist the `.p8`.** Unchanged and unaffected: scheduling stores only cadence/day/hour/tz — no credentials. The ASC `.p8` continues to arrive per-request and is never written (`cloud/src/api/index.ts:917-1044` `runAppWithAsc`). Important corollary: the **scheduled sweep is iTunes-only and does NOT do a Mode-A ASC read** (it has no credential), so cadence changes never imply the agent gained ASC access. Keep that boundary; the digest/run stays honest-but-conservative on the cron path.
4. **Owner-scoping + tier gate** on the write route (`requireOwnedApp`, `canRunCron`) prevents a user from scheduling another user's app or a free user from enabling autonomy. Input is validated server-side (`normalizeSchedule`) — never trust a client cron string (we don't even expose one).
5. **No PII in schedule data;** tz is an IANA name, safe to store and display.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| **Cron 12×→168× more invocations** (hourly vs weekly) | The due-gate (`isAppDue`) short-circuits before any network/DB-heavy work; non-due apps cost one pure function call. Sweep still iterates `listAllApps`, but for small/medium volume this is cheap. If `listAllApps` fan-out grows, add a `WHERE`-narrowing query later (or move to Option B). |
| **DST / tz bugs** silently shifting a customer's review hour | Resolve "now" into the app tz via `Intl` per tick (no precomputed UTC hour); explicit winter+summer DST unit tests. |
| **Migration on the live D1** | Columns added with safe `NOT NULL DEFAULT` values that reproduce today's behavior; documented `ALTER TABLE` block run locally + remote, matching the established migration pattern (`schema.sql:37-46`). No data backfill needed. |
| **Double-fire / missed-hour edge** (a tick lands twice or skips) | Idempotency already exists: `hasOpenRun` (`cloud/src/cron/scheduled.ts:133`) prevents a second open run; a missed hour is acceptable (non-goal: no catch-up). Optionally record `last_swept_at` to dedupe within an hour — **only if** observed double-fires warrant it (defer). |
| **User confusion: "I set daily but nothing happened"** | The sweep still only *opens a run* when `evaluateThreshold` crosses (`:54-78`); otherwise it records a `detected` snapshot. The Schedule card copy must explain cadence = "how often we *check*", not "how often you get a to-do". |

**Rollout:**
1. Ship schema migration (idempotent `ALTER TABLE`, defaults preserve current behavior) — deploy with no behavior change.
2. Ship hourly cron + due-gate (every app still defaults to Mon-09:00-UTC → identical sweeps).
3. Ship the API + dashboard control behind the existing tier gate.
4. Monitor cron invocation logs (`handleScheduled` already logs a summary, `:246-249`; extend it to include `skippedNotDue`).
No feature flag strictly required since defaults are behavior-preserving, but the schema→cron→API ordering means each step is independently revertible.

---

## 8. Effort estimate

**M (Medium).** ~1–2 days. Breakdown: pure `schedule.ts` + tests (S), schema migration + d1 plumbing (S), sweep wiring + tests (S), API route + tests (S), dashboard card + e2e (M). No new Cloudflare primitive (Option A), no engine changes, no credential surface. The complexity is concentrated in tz/DST correctness, which is fully unit-testable.

## 9. Product DECISION needed before building

**Yes — one decision for the owner:**

1. **Scheduling primitive: Option A (hourly global cron + stored-schedule due-gate) vs Option B (Durable Object alarms).** Recommendation: **Option A** now (lower risk, reuses the sweep, no new binding). Confirm before building, since it dictates schema + `wrangler.toml`.

Secondary product choices (sensible defaults proposed, but worth a thumbs-up):
2. **Granularity exposed:** cadence (off/daily/weekly/biweekly) + day + hour + tz — *not* raw cron. Confirm this is the right surface (vs. simpler "weekly day-picker only", or richer "twice-weekly").
3. **`off` as a cadence** (pause autonomy without disconnecting) — confirm we want a pause state vs. forcing disconnect.
4. **Per-app vs per-user schedule.** This PRD proposes **per-app** (a Fleet agency wants different cadences per app). Confirm; a per-user default-with-per-app-override is a heavier variant if desired later.
