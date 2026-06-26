# PRD — Agent controls: pause / resume the autonomous agent (per-user or per-app)

**GitHub issue:** #51
**Status:** Proposed (post-launch)
**Effort:** **M** (Medium)
**Needs owner DECISION before building:** **Yes** — one scoping decision (see §8). Once decided, implementation is mechanical.

---

## 1. Problem & context

The dashboard renders a permanent banner that asserts the agent is running, with no control to stop it:

> `cloud/public/app.js:426` — `"Autonomous agent <b>active</b> — re-checks your ranks &amp; listing every Monday 09:00 UTC …"`

That line is hard-coded. There is no UI affordance, no API endpoint, and no persisted flag to turn the autonomous loop off. Verified against the code:

- **No pause/resume route.** The router in `cloud/src/api/index.ts:1776-1948` has handlers for auth, billing, apps, runs, github, asc — but nothing for agent enablement.
- **No pause field in the schema.** `cloud/schema.sql` `users` and `apps` tables have no `agent_paused` / `autopilot_enabled` column. The only autonomy switch is the subscription **tier**.
- **The only "off switch" today is downgrading.** The weekly sweep gates purely on tier: `runWeeklySweep` calls `getTier()` then `canRunCron(tier)` and skips free/launch apps (`cloud/src/cron/scheduled.ts:112-125`). An autopilot/fleet customer who wants to stop the Monday run has no option except cancelling their plan.

**Why it matters.** ShipASO's core value is honest, human-in-the-loop autonomy: the agent *prepares* but the human *approves the push* (`scheduled.ts:19-24`, `decideRun` at `api/index.ts:1301-1347`). A user who can't pause the loop loses the "I'm in control" half of that promise. Practical scenarios: an app in App Store review where the user doesn't want new proposals churning, a temporary freeze on metadata changes, or a Fleet operator wanting to silence one noisy app without touching the others. The weekly sweep also **emails a digest** (`sendWeeklyDigests`, `scheduled.ts:199-237`) — pause must also stop the nagging, not just the run.

**Why post-launch-OK (per issue).** The agent never auto-pushes (the irreversible step is gated behind human approval — `scheduled.ts:19-21`, `decideRun`), so an un-pausable loop can't do harm; it can only *propose* and *email*. Acceptable at launch, real gap for trust/control afterward.

---

## 2. Goal & non-goals

### Goal
- A persisted **pause/resume** control for the autonomous weekly sweep, settable from the dashboard.
- `runWeeklySweep` (`cloud/src/cron/scheduled.ts`) skips paused targets and does not open runs or send digests for them.
- The dashboard banner reflects real state: **"active"** vs **"paused"**, with a toggle.
- Pause is **per-user** at minimum and **per-app** ideally (see §8 decision).

### Non-goals
- **No change to the manual run path.** Pause governs *standing autonomy* (the cron) only. A paused user can still trigger `POST /apps/:id/run` and `/run-asc` on demand — pausing the robot must not lock the human out of their own tool. (Mirrors how free/launch tiers already skip cron but allow manual runs.)
- **No change to the approval gate.** Already-open `awaiting_approval` runs stay approvable while paused. Pause stops *new* autonomous runs; it does not retract pending ones.
- **No new tier / billing semantics.** Pause is orthogonal to tier. A free user has no cron anyway, so pause is a no-op for them (we still persist the flag; it just never gates anything until they upgrade).
- **No scheduled "pause until date" / auto-resume.** A boolean now; a timed pause is a future issue.
- **No retroactive cleanup.** We don't delete or alter the `detected` snapshot rows already written.

---

## 3. Proposed approach (grounded in real files)

The cleanest insertion point mirrors the **existing tier gate**, which is the precedent for "should this app be swept?".

### 3a. Persisted flag (the gate)
Add a paused flag and check it in `runWeeklySweep` right next to the tier check at `cloud/src/cron/scheduled.ts:112-125`:

```ts
const tier = await getTier(env.DB, app.user_id);
if (!canRunCron(tier)) { /* existing skippedTier path */ continue; }

// NEW — honor an explicit pause (per-user, and per-app if scoped that way)
if (await isAgentPaused(env.DB, { userId: app.user_id, appId: app.id })) {
  report.skippedPaused++;
  report.perApp.push({
    appId: app.id, bundleId: app.bundle_id, crossed: false, runId: null,
    skippedOpenRun: false, skippedPaused: true,
    reasons: ["skipped — agent paused by owner"],
  });
  continue;
}
```

This guarantees a paused target opens **no run** (no `awaiting_approval`, no `detected` snapshot) and — because `sendWeeklyDigests` iterates `report.perApp` (`scheduled.ts:205`) — **sends no digest** for it, with no extra digest-side change needed beyond skipping entries flagged `skippedPaused`.

The check belongs in a pure-ish D1 helper `isAgentPaused()` in `cloud/src/d1.ts`, alongside `getTier` (`d1.ts:235-241`), reading the new column(s).

### 3b. Persistence pattern
Follow the **existing `getTier`/`setTier` precedent** (`d1.ts:235-286`) exactly: a typed read helper + a partial-update writer. The `users` table already carries per-user account state inline (tier, status, stripe_*, github_* — `schema.sql` users block), so `agent_paused` fits there for the per-user scope. For per-app scope, add `agent_paused` to the `apps` table (precedent: every app-scoped column lives there).

### 3c. API endpoint (mirror existing PATCH-like writers)
There is no PATCH convention; the codebase uses POST writers that return the new state (e.g. `githubConnectRoute` at `api/index.ts:1451-1460` returns `{ connected, repo }`; `decideRun` returns the new status). Follow that:

- `POST /agent/pause` and `POST /agent/resume` (per-user), and/or
- `POST /apps/:id/agent { paused: boolean }` (per-app).

Each is `requireUser`-gated (`api/index.ts:1842`), owner-scoped for the per-app variant via the existing `requireOwnedApp` (`api/index.ts:510-514`), and returns the canonical new state so the client doesn't guess.

### 3d. Surfacing state to the dashboard
`GET /auth/me` (`api/index.ts:493-507`) is the dashboard's boot check and already returns account-shaped data. The cleanest UX is to include the per-user paused flag there (and per-app flags ride on the existing `GET /apps` list response, `listApps` at `api/index.ts:824-855`, since each app card is built from that). Then `viewDashboard` (`app.js:415`) replaces the hard-coded banner at `app.js:426` with a state-driven line + a toggle button calling the new endpoint and re-rendering.

---

## 4. Exact files to change + new files

### Schema
- **`cloud/schema.sql`** — add column(s) + the migration `ALTER TABLE` comment block (the file documents migrations inline for every column, e.g. the users/subscribers blocks):
  - Per-user: `users.agent_paused INTEGER NOT NULL DEFAULT 0` (SQLite has no bool; 0/1, matching how the codebase treats flags).
  - Per-app (if scoped per-app): `apps.agent_paused INTEGER NOT NULL DEFAULT 0`.
  - Add the matching `ALTER TABLE … ADD COLUMN agent_paused INTEGER NOT NULL DEFAULT 0` lines (local + remote) in the comment, following the existing users-table migration comment style.

### Data layer
- **`cloud/src/d1.ts`**
  - Add `agent_paused: boolean` (or `0|1` normalized to boolean) to `UserRow` (`d1.ts:32-43`) and/or `AppRow` (`d1.ts:45-52`).
  - Extend `USER_COLS` (`d1.ts:182`) and every app `SELECT` column list (`d1.ts:337, 363, 411`, and the `listAppsForUser` join at ~`d1.ts:395`) to include `agent_paused`.
  - New `isAgentPaused(db, { userId, appId? })` reading the column(s) — per-user OR (if per-app) `app.agent_paused OR user.agent_paused`.
  - New `setAgentPaused(db, { userId?, appId?, paused })` — partial-update writer modeled on `setTier` (`d1.ts:247-286`).
  - Normalize `agent_paused` from `0|1` to `boolean` in the row mappers (note `getApp`/`createApp` currently `SELECT` an explicit column list, not `*`, so the new column must be added to each).

### API
- **`cloud/src/api/index.ts`**
  - New handlers `pauseAgent` / `resumeAgent` (per-user) and/or `setAppAgentPaused` (per-app), returning the new state.
  - Router wiring in `handleApi` (after the `apps`/`runs` blocks, `api/index.ts:1877-1938`): `POST /agent/pause`, `POST /agent/resume`, and/or `POST /apps/:id/agent`.
  - Add `paused` to the `GET /auth/me` response (`authMe`, `api/index.ts:493-507`) for per-user state, and to each app object in `listApps` (`api/index.ts:842-852`) for per-app state.

### Cron
- **`cloud/src/cron/scheduled.ts`** — insert the pause check after the tier gate (`scheduled.ts:125`); add `skippedPaused` to `CronReport` (`scheduled.ts:80-96`) and the per-app entry shape; ensure `sendWeeklyDigests` (`scheduled.ts:199-237`) skips `skippedPaused` entries (it already iterates `report.perApp`, so the skip is a one-line filter or the entry simply never reaches the digest gate).

### Frontend
- **`cloud/public/app.js`** — replace the hard-coded banner at `app.js:426` with a state-driven banner ("active" vs "paused, resume?") inside `viewDashboard` (`app.js:415`); add a toggle button that calls the new endpoint via the existing `api()` helper (`app.js:69`) and re-renders. Per-app: add a small pause toggle to `appCard`. Read state from the `session`/`/auth/me` object (`app.js:26-43`) and/or the per-app `/apps` payload.
- **`cloud/public/mock.js`** — add the `paused` field to the mocked `/auth/me` + `/apps` responses and a stub for the pause/resume endpoints so the live demo + frontend tests stay coherent (mock.js mirrors the Worker's response shapes).

### New test files (colocated `*.spec.ts`, per `~/.claude/CLAUDE.md` + repo convention)
- **`cloud/src/d1.agentPaused.spec.ts`** — `isAgentPaused` / `setAgentPaused` against the fake-D1 pattern in `cloud/src/d1.recordApproval.spec.ts:1-30` (captures SQL + bound args).
- Extend **`cloud/src/cron/scheduled.spec.ts`** — sweep skips paused targets (no run opened, no digest). Reuse its `makeResult` builder (`scheduled.spec.ts:9-27`).
- API-level test for the new routes (follow whichever pattern `cloud/tests/` uses for endpoint tests; an existing `*.spec.ts` such as `auth.spec.ts` or `billing.spec.ts` shows the Worker-request harness).

---

## 5. Test plan (TDD — stub → failing test → implement)

### Unit
1. **`setAgentPaused` writes the right SQL.** Fake D1 captures `UPDATE users SET agent_paused = ? WHERE id = ?` (and/or `apps`) with bound `1`/`0`. Strong assertion on exact SQL + args, per `d1.recordApproval.spec.ts`.
2. **`isAgentPaused` reads + normalizes.** Returns `true` for stored `1`, `false` for `0`/missing. Per-app variant: paused when **either** the app OR the owner is paused.
3. **Cron skips a paused user** (`scheduled.spec.ts`): a paused owner's app produces `runsOpened === 0`, a `perApp` entry with `skippedPaused: true`, and **no** `awaiting_approval` AND **no** `detected` snapshot row persisted (assert `persistRun` not called for it).
4. **Cron still sweeps an un-paused app** in the same batch (per-app isolation — pausing app A must not pause app B of the same user under per-app scope).
5. **Digest is suppressed** for paused targets — `sendWeeklyDigests` produces no message for a `skippedPaused` entry.
6. **Tier gate precedence** — a free user who is *not* paused is still `skippedTier`, not `skippedPaused` (the two gates don't collide; tier is checked first).

### Integration / E2E
7. **`POST /agent/pause` then `GET /auth/me`** returns `paused: true`; `resume` flips it back. Owner-scoped: another user's app can't be paused (per-app variant 404s via `requireOwnedApp`, like every other app route).
8. **Manual run still works while paused** — `POST /apps/:id/run` succeeds for a paused user (regression guard on the non-goal).
9. **Playwright** (`cloud/playwright.config.ts` exists): banner reads "active", clicking the toggle flips it to "paused" and the button label updates without a full reload.

### Honesty assertions (treat as first-class tests)
10. **A paused app's banner never claims "active."** Pin the exact copy so a future refactor can't silently re-hardcode "active" (the bug this issue fixes). Assert the paused banner string is rendered when `paused === true`.

---

## 6. Honesty & security considerations

- **Never present unseen data as measured.** Pause *prevents* data collection; it must not fabricate it. When paused, we open **no** run — not even a `detected` snapshot. The dashboard must show the last *real* checked-at date and a clear "paused — no new checks since …" state, never imply a fresh measurement happened. No placeholder/zeroed ranks.
- **The `.p8` is never touched here.** This feature reads/writes a boolean flag only; it must not go anywhere near ASC credentials. The ephemeral-`.p8` posture (`runAppWithAsc` / `ascPushRoute`, `api/index.ts:917-1044, 1535-1578`) is untouched.
- **The agent NEVER auto-pushes — pause reinforces, never weakens, that.** Pause only *reduces* what the cron does (prepare + email). Resuming must not bypass the approval gate; a resumed sweep still lands runs in `awaiting_approval` exactly as today (`scheduled.ts:135-152`). No code path here may set `approved`/`shipped`.
- **Owner-scoping.** Per-app pause routes use `requireOwnedApp` (`api/index.ts:510-514`) so a user can't pause/resume another user's app. Per-user routes are `requireUser`-scoped (`api/index.ts:1842`). Same precedence as every authed route.
- **No info leak.** The flag is per-account state, returned only to the authenticated owner (via `/auth/me` and `/apps`), never on the public `/proof`, `/preview`, or `/resolve` routes.
- **Pause does not lock the human out.** Manual runs remain available (non-goal §2) so a paused state can never trap a user's own app away from them.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| **Migration on live D1.** Adding a `NOT NULL DEFAULT 0` column to an existing remote `users`/`apps` table. | SQLite `ALTER TABLE ADD COLUMN` with a constant default is safe + instant. Ship the `ALTER` comment block in `schema.sql` (existing convention) and run local + remote per the documented `wrangler d1 execute` pattern. Default `0` = "not paused" preserves today's behavior for everyone. |
| **Gate-ordering bug** (pause checked before tier, or skip path forgets `continue`). | The pause check sits immediately after the existing tier `continue` block and uses the same shape; unit test #6 pins precedence; test #3 pins that no run/snapshot is written. |
| **Stale banner** — user pauses but UI still says "active" until reload. | Toggle handler re-renders `viewDashboard` from the endpoint's returned state (don't optimistic-guess); test #9. |
| **Digest leak** — paused app still gets emailed. | `sendWeeklyDigests` already iterates `report.perApp`; skip `skippedPaused` entries; test #5. |
| **mock.js drift** — demo diverges from Worker shape. | Update `mock.js` `/auth/me` + `/apps` + new endpoints in the same PR (existing parity requirement). |

**Rollout:** ship behind no feature flag (low-risk additive column + opt-in user action; default is current behavior). Migrate D1 (local → remote) → deploy Worker → deploy Pages. No data backfill. Reversible: dropping the routes + banner change reverts to today; the unused column is harmless.

---

## 8. Effort & the DECISION needed before building

**Effort: M.** New column + two thin D1 helpers + one cron `if` + two/three small routes + one banner/toggle in `app.js` + mock parity + ~6 spec cases. All of it mirrors existing precedents (`getTier`/`setTier`, the tier gate, `githubConnectRoute`). No new infra, no engine changes, no credential surface.

**Owner DECISION required — scope: per-user vs per-app vs both.** This is the only real product call and it changes the column count, the endpoints, and the UI surface:

- **Per-user only (smaller, S–M):** one `users.agent_paused`, one `/agent/pause`+`/resume`, banner toggle only. Pauses *everything* the user owns. Simplest; matches the issue's "per-user at minimum."
- **Per-app (M):** add `apps.agent_paused`, a per-app route + per-card toggle. Pause one noisy app without silencing the rest — the Fleet-operator use case. The issue says "ideally per-app."
- **Both (M, recommended):** per-user master switch *and* per-app overrides; `isAgentPaused` returns true if **either** is set. Most flexible, marginal extra cost since the helper already takes both ids.

**Recommendation:** ship **per-user now** (covers the stated minimum and the trust gap) and structure `isAgentPaused(db, { userId, appId? })` to accept an optional `appId` so **per-app is an additive follow-up** (add the `apps` column + one route + one toggle) with no rework. Confirm scope with the owner before starting, since it determines the schema migration shape.

