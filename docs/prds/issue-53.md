# PRD — Agent controls: configurable run thresholds (issue #53)

**Status:** Draft for owner decision
**Owner sign-off required before build:** YES (one product decision — see §8)
**Effort:** M (Medium) — schema migration + pure-logic change + one new API surface + minimal UI
**Labels:** post-launch-OK (default heuristic is sound; this is a refinement, per the issue)

---

## 1. Problem & context

The weekly autonomy loop decides whether to open an `awaiting_approval` run using a **single fixed heuristic** with no per-app tuning:

- `evaluateThreshold(result: AgentResult)` in `cloud/src/cron/scheduled.ts:54-78` crosses the threshold (opens a run) when **either**:
  - (a) any targeted keyword is still unranked — `r.error === "" && r.rank === null` (`scheduled.ts:58-65`), **or**
  - (b) any competitor surfaced (`status === "new"`) or changed a visible field (`status === "changed"`) (`scheduled.ts:68-75`).
- `runWeeklySweep` calls it at `scheduled.ts:132`; on a crossed threshold (and no run already open) it opens a run via `persistRun(... status: "awaiting_approval" ...)` (`scheduled.ts:135-152`); otherwise it still records the pass as a `detected` snapshot (`scheduled.ts:157-167`).

Why this matters:

- **Noise → gate fatigue.** An app with a couple of perennially-unranked long-tail keywords, or a noisy competitor that bumps its version weekly, opens a run **every single week**. The approval gate is the product's safety guarantee; if it cries wolf, owners stop reading it, which quietly erodes the honesty/trust the product is built on.
- **No "watch but don't nag" mode.** Some users want the time-series recorded and a digest email, but **not** a standing run at the gate. Today that's impossible — the only knob is the global heuristic.
- **Can't mute known noise.** A competitor you've deliberately decided to ignore, or a keyword you're not actually chasing this quarter, still trips the threshold.
- **No magnitude control.** "A keyword is unranked" and "a keyword dropped from #4 to #38" are treated identically (the latter isn't even detected — see §3.4). Power users want "only wake me on a rank drop of N+."

The issue explicitly scopes this as: let users tune **what triggers a run** (rank-drop magnitude, competitor-metadata-only, mute keywords/competitors, notify-but-don't-open-a-run), persist the config, and have `evaluateThreshold` read it.

---

## 2. Goal & non-goals

### Goal
Make the run-open threshold **per-app configurable**, persisted in D1, and read by `evaluateThreshold` during the weekly sweep — without weakening the approval gate or the honesty guarantees. Ship with a sensible default that reproduces today's behavior exactly (zero behavior change for apps that never touch the config).

### In scope
1. A persisted per-app `RunThresholdConfig` with these controls (mapped 1:1 to the issue):
   - **`unrankedKeywords`** (`on` | `off`) — keep/disable the "targeted keyword unranked" trigger.
   - **`rankDrop`** (`off` | integer N≥1) — open a run when a tracked keyword drops by ≥ N positions week-over-week (NEW capability; see §3.4).
   - **`competitor`** (`any` | `metadata_only` | `off`) — `any` = today's behavior; `metadata_only` = only when a watched listing **field changes** (ignore brand-new competitors appearing); `off` = ignore competitor movement.
   - **`mutedKeywords: string[]`** / **`mutedCompetitors: string[]`** — exclude specific keywords / competitor keys from ALL triggers.
   - **`mode`** (`open_run` | `notify_only`) — `notify_only` records the snapshot + still computes "crossed" for the digest, but **never opens an `awaiting_approval` run**.
2. New API: `GET /apps/:id/settings` and `PATCH /apps/:id/settings` (owner-scoped).
3. `evaluateThreshold` takes the config (+ prior-rank context) and applies it. Default config === current behavior.
4. Minimal dashboard UI to read/write the config.
5. Digest line reflects `notify_only` ("we saw movement but didn't open a run — your settings").

### Non-goals
- **No new autonomy.** This NEVER makes the agent push, auto-approve, or skip the gate. `notify_only` is strictly *less* autonomous than today.
- **No org/global defaults**, no per-keyword thresholds (only per-app), no scheduling/frequency changes (cron stays `0 9 * * 1`).
- **No ML/auto-tuning** of thresholds.
- **No change to the engine** (`runAgent`) — thresholds are evaluated post-run on the already-computed `AgentResult`.
- **No new measured-data sources.** Rank-drop uses the existing `rank_snapshots` time-series only.

---

## 3. Proposed approach (grounded in real files)

### 3.1 Config type + defaults (new pure module)
New file `cloud/src/cron/thresholdConfig.ts` exporting:

```ts
export type CompetitorTriggerMode = "any" | "metadata_only" | "off";
export type RunThresholdMode = "open_run" | "notify_only";

export type RunThresholdConfig = {
  unrankedKeywords: boolean;        // default true  (today's behavior)
  rankDrop: number | null;          // default null  (off; N≥1 => drop of ≥N)
  competitor: CompetitorTriggerMode;// default "any" (today's behavior)
  mutedKeywords: string[];          // default []
  mutedCompetitors: string[];       // default []
  mode: RunThresholdMode;           // default "open_run"
};

export const DEFAULT_THRESHOLD_CONFIG: RunThresholdConfig = {
  unrankedKeywords: true,
  rankDrop: null,
  competitor: "any",
  mutedKeywords: [],
  mutedCompetitors: [],
  mode: "open_run",
};

/** Parse + sanitize an untrusted config blob (from PATCH body or D1) into a
 *  complete, clamped config. Unknown keys dropped; bad values fall back to default. */
export function parseThresholdConfig(raw: unknown): RunThresholdConfig;
```

`parseThresholdConfig` is the **single trust chokepoint** (mirrors `sanitizeKeywords` in `runConfig.ts:114-135`): muted lists are length-capped (reuse the `MAX_KEYWORD_LEN = 80` cap and control-char stripping pattern from `runConfig.ts:97-135`) and de-duped; `rankDrop` coerced to a positive integer or `null`; enums validated against allow-lists; array length capped (e.g. ≤100 entries) to bound storage. This guarantees a malformed stored blob can never crash the cron — it degrades to defaults.

### 3.2 Make `evaluateThreshold` config-aware (the core change)
Today's signature (`scheduled.ts:54`):
```ts
export function evaluateThreshold(result: AgentResult): ThresholdDecision
```
New signature (additive `opts`, defaulted so all existing callers/tests compile):
```ts
export function evaluateThreshold(
  result: AgentResult,
  config: RunThresholdConfig = DEFAULT_THRESHOLD_CONFIG,
  priorRanks: Map<string, number | null> = new Map(),  // keyword -> last recorded rank
): ThresholdDecision
```
Logic, replacing the body at `scheduled.ts:55-77`:
- **(a) unranked:** only if `config.unrankedKeywords`; filter out `config.mutedKeywords` before the existing `r.error === "" && r.rank === null` check (`scheduled.ts:58`).
- **(b-new) rank drop:** if `config.rankDrop != null`, for each non-errored, non-muted rank with a known prior position, compute `delta = currentRank - priorRank` (both 1-based; a *larger* rank number is worse). If `delta >= config.rankDrop`, push reason `keyword "x" dropped N (#prior → #current)`. A keyword that *became* unranked (`rank === null`) is covered by (a); rank-drop only fires when both prior and current are non-null.
- **(c) competitor:** branch on `config.competitor`:
  - `off` → skip the loop entirely.
  - `metadata_only` → only push `status === "changed"` reasons (drop the `status === "new"` branch at `scheduled.ts:70-71`).
  - `any` → today's behavior (`scheduled.ts:68-75`). In all branches, skip competitors whose `c.key` (or `c.name`) is in `config.mutedCompetitors`.

`ThresholdDecision` stays `{ crossed, reasons }` (`scheduled.ts:45-48`). Keep `evaluateThreshold` **pure** — `priorRanks` is passed in, not fetched inside (consistent with the existing "pure, testable" doc comment at `scheduled.ts:50-53`).

### 3.3 Wire config + prior ranks through the sweep
In `runWeeklySweep` (`scheduled.ts:103-191`), inside the per-app loop after the tier gate (`scheduled.ts:126`):
1. Load config: `const config = await getThresholdConfig(env.DB, app.id);` (new D1 reader, §3.5).
2. Build prior-rank map from existing history: derive `priorRanks` from `getLatestRanks(env.DB, app.id)` (already exists, `d1.ts:666`) — captured **before** this pass's snapshots are written so it's genuinely "last week." (The new pass's snapshots are written inside `persistRun`; `getLatestRanks` here reads the pre-existing latest.)
3. `const decision = evaluateThreshold(result, config, priorRanks);` (replaces `scheduled.ts:132`).
4. **`notify_only` gate** at the open-run branch (`scheduled.ts:135`): change condition to
   `if (decision.crossed && !alreadyOpen && config.mode === "open_run")`.
   When `notify_only` and crossed, fall through to the `detected` branch (`scheduled.ts:157-167`) with a distinct reason like `"snapshot recorded — notify_only: movement detected but no run opened"`. This is the load-bearing honesty rule: **`notify_only` records, it does not gate.**
5. Digest input is unchanged structurally, but `planDigests` should surface a "we noticed movement but, per your settings, didn't open a run" line for `notify_only` crossed weeks. Thread a `notifyOnlyMovement: boolean` onto the existing per-app digest input in `sendWeeklyDigests` (`scheduled.ts:204-223`) so the email stays honest (don't imply a pending approval that doesn't exist — note the existing care taken at `scheduled.ts:216-220`).

### 3.4 Why rank-drop is genuinely new
`evaluateThreshold` today only sees the **current** `AgentResult.ranks` — it has no memory, so it literally cannot detect a drop. The time-series lives in `rank_snapshots` (`schema.sql:83-91`), read via `getRankHistory` (`d1.ts:607`) / `getLatestRanks` (`d1.ts:666`). Passing a `priorRanks` map in is the minimal, pure way to add magnitude-based triggering without giving the pure function DB access.

### 3.5 Persistence (D1)
Add a nullable `settings_json TEXT` column to `apps` (one column, JSON blob — same lightweight approach as the `reasoning_json` blob on `runs`, `schema.sql:75`). Rationale: the config is a small, evolving bag of optional knobs; a JSON column avoids a migration per new control and keeps `AppRow` simple.

- `schema.sql:50-58` — add `settings_json TEXT NOT NULL DEFAULT '{}'` to the `apps` `CREATE TABLE`, plus an `ALTER TABLE` migration comment block in the same style as `schema.sql:37-46` / `schema.sql:133-134`:
  ```
  npx wrangler d1 execute store_ops --command "ALTER TABLE apps ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'"
  ```
- `AppRow` (`d1.ts:45-52`) — add `settings_json: string;`. Update the column lists in `createApp`/`getApp`/`getUserApps`/`listAllApps` (the explicit `SELECT id, user_id, bundle_id, name, country, created_at ...` strings at `d1.ts:337,363,393,411`).
- New D1 helpers in `d1.ts` (modeled on `setGithubConnection`, `d1.ts:220-231`):
  ```ts
  export async function getThresholdConfig(db, appId): Promise<RunThresholdConfig>
    // SELECT settings_json -> parseThresholdConfig(JSON.parse(...) ?? {})
  export async function setThresholdConfig(db, appId, config): Promise<void>
    // UPDATE apps SET settings_json = ? WHERE id = ?
  ```
  `getThresholdConfig` always returns a complete config (defaults merged), so the cron never branches on "no config."

### 3.6 API surface
Add two owner-scoped routes in the `/apps` block of the router (`api/index.ts:1878-1912`), reusing `requireOwnedApp` (`api/index.ts:510-514`):
- `GET /apps/:id/settings` → `{ settings: RunThresholdConfig }` (returns defaults if unset).
- `PATCH /apps/:id/settings` → body is a partial config; handler does `parseThresholdConfig({ ...current, ...body })` then `setThresholdConfig`, returns the stored config. Untrusted body is sanitized through the §3.1 chokepoint — never written raw.

Handlers live next to `appDetail` (`api/index.ts:1058-1065`); also fold `settings` into the `appDetail` response object (`api/index.ts:1061-1064`) so the dashboard can render current values without a second fetch.

### 3.7 Frontend (minimal)
`cloud/public/app.js` — add an "Agent controls" section on the app detail view (the file already builds detail views via the `el(...)` helpers, e.g. `app.js:1593,1817`). Controls: toggle for unranked, number input for rank-drop (with an "off" state), a 3-way competitor select, muted-keyword/competitor chip inputs, and a mode toggle (`open run` vs `notify only`). On save → `PATCH /apps/:id/settings`. Copy must be honest: label `notify_only` as "Record movement and email me — don't open a run." Mirror in `cloud/public/mock.js` so the in-browser demo backend supports the same endpoints.

---

## 4. Exact files to change + new files

**New:**
- `cloud/src/cron/thresholdConfig.ts` — `RunThresholdConfig`, `DEFAULT_THRESHOLD_CONFIG`, `parseThresholdConfig`.
- `cloud/src/cron/thresholdConfig.spec.ts` — parser/sanitizer + default-equivalence tests.

**Changed:**
- `cloud/src/cron/scheduled.ts` — config-aware `evaluateThreshold` (lines 54-78); wire config + `priorRanks` + `notify_only` gate into `runWeeklySweep` (lines 126-176); `notifyOnlyMovement` into the digest input (lines 204-223).
- `cloud/src/cron/scheduled.spec.ts` — extend `makeResult` harness (lines 10-36) with config/prior-rank cases.
- `cloud/schema.sql` — `settings_json` column + migration comment (lines 50-58).
- `cloud/src/d1.ts` — `AppRow.settings_json` (lines 45-52); column lists (lines 337/363/393/411); `getThresholdConfig` / `setThresholdConfig` (near 220).
- `cloud/src/d1.*.spec.ts` — round-trip test for the new readers/writers (follow the existing `d1.recordApproval.spec.ts` style).
- `cloud/src/api/index.ts` — `GET`/`PATCH /apps/:id/settings` routes (router block ~1894-1911); handler fns near `appDetail` (1058); add `settings` to `appDetail` response (1061-1064).
- `cloud/public/app.js` — Agent controls UI on app detail.
- `cloud/public/mock.js` — mirror the two endpoints for the demo backend.

---

## 5. Test plan (TDD, `*.spec.ts`, colocated, vitest)

Follow the repo convention: write the failing spec first, then implement (per the global TDD rule). Strong assertions, parameterized inputs.

**Unit — `cloud/src/cron/thresholdConfig.spec.ts` (new):**
- `parseThresholdConfig({})` deep-equals `DEFAULT_THRESHOLD_CONFIG`.
- Coerces bad values: `rankDrop: "5"` → `5`; `rankDrop: 0` / negative / NaN → `null`; unknown `competitor` → `"any"`; unknown `mode` → `"open_run"`.
- Sanitizes muted lists: strips control chars, caps length at 80 (reuse `runConfig` cases), de-dupes, caps array length, drops empties.
- Drops unknown keys; never throws on garbage (`null`, arrays, strings).

**Unit — `cloud/src/cron/scheduled.spec.ts` (extend existing harness at lines 10-36):**
- **Default-equivalence (regression):** every existing `evaluateThreshold(r)` case yields identical output when called with `DEFAULT_THRESHOLD_CONFIG` — proves zero behavior change.
- `unrankedKeywords:false` → unranked keyword no longer crosses.
- `mutedKeywords:["breathwork"]` → an unranked muted keyword doesn't cross; an unranked non-muted one still does.
- **rankDrop:** with `priorRanks={yoga:4}` and current `yoga:38`, `rankDrop:10` crosses with a `#4 → #38` reason; `rankDrop:50` does not; missing prior → no rank-drop reason; `rankDrop:null` → never fires.
- **competitor modes:** `"off"` ignores both new & changed; `"metadata_only"` crosses on `changed` but not `new`; `"any"` matches today; `mutedCompetitors` excludes a matching key.
- Combination: muted keyword + `competitor:"off"` + a changed non-muted competitor → crosses only via the competitor path (and not when that competitor is also muted).

**Unit — D1 spec (new, colocated):** `setThresholdConfig` then `getThresholdConfig` round-trips; reading an app with `settings_json='{}'` returns defaults; a corrupt stored blob returns defaults (no throw).

**Integration / E2E (follow the existing API/cron integration style):**
- `PATCH /apps/:id/settings` persists and `GET` returns it; ownership enforced — another user's `PATCH`/`GET` → 404 via `requireOwnedApp`.
- `PATCH` with a malicious body (oversized muted list, control chars, junk types) stores only the sanitized config.
- **Sweep behavior:** an app configured `notify_only` whose data crosses the threshold records a `detected` snapshot and opens **no** `awaiting_approval` run (assert `report.runsOpened` unchanged and no open run via `hasOpenRun`). An `open_run`/default app with the same data opens exactly one run.
- Digest: a `notify_only` crossed week sets `notifyOnlyMovement` and the email copy reflects "no run opened," with no false "pending approval."

**Quality gates before any commit:** lint, typecheck, full `vitest` (per user workflow rules). No commit without explicit approval.

---

## 6. Honesty & security considerations

- **Approval gate is never weakened.** Every config value can only make the agent *quieter*, never more autonomous. `notify_only` and all "off"/mute settings strictly *reduce* what opens at the gate. There is no setting that auto-approves, auto-pushes, or skips review — the cron still `persistRun(... "awaiting_approval" ...)` only, and the irreversible push stays behind the human API approval (the existing guarantee documented at `scheduled.ts:19` and `schema.sql:8-13`).
- **Never present unseen data as measured.** Rank-drop uses **only** real recorded `rank_snapshots`; a keyword with no prior snapshot produces **no** drop reason (we don't infer a drop from absent history). The digest for `notify_only` must say exactly what happened ("we recorded movement; per your settings we did not open a run") and must NOT imply a pending approval that doesn't exist (extend the care already taken at `scheduled.ts:216-220`).
- **`.p8` is irrelevant here and stays untouched.** This feature never reads, references, or persists App Store Connect keys; nothing in the config or its storage touches credentials.
- **Untrusted input is sanitized at one chokepoint.** The `PATCH` body and the stored blob both flow through `parseThresholdConfig` (control-char strip + length caps + array bounds + enum allow-lists), mirroring `sanitizeKeywords` (`runConfig.ts:114-135`). Muted strings are re-served to the dashboard, so they get the same defense-in-depth treatment. A corrupt stored blob degrades to defaults — it can never crash the weekly sweep (per-app failures are already isolated at `scheduled.ts:177-187`, but defaulting avoids even a logged error).
- **Ownership enforced** on both routes via `requireOwnedApp` (`api/index.ts:510-514`); a user can only read/write their own apps' settings.

---

## 7. Risks & rollout

- **Risk: silent under-notification.** A user sets `notify_only` or mutes broadly and then misses real movement. *Mitigation:* default is unchanged (today's behavior); the digest email still fires and explicitly states when movement was detected-but-suppressed, so the time-series and the heads-up remain honest. Consider surfacing "muted" counts in the dashboard.
- **Risk: rank-drop false positives from iTunes volatility.** Organic positions are noisy week-to-week. *Mitigation:* `rankDrop` defaults **off**; document that small N values will be chatty; only fire on non-null→non-null deltas (a transient errored fetch never reads as a drop, consistent with `scheduled.ts:58`).
- **Risk: migration drift** between fresh `CREATE TABLE` and existing remote D1. *Mitigation:* ship the `ALTER TABLE` in the schema comment block exactly like the existing user/subscriber migrations (`schema.sql:37-46,133-134`); `NOT NULL DEFAULT '{}'` is backfill-safe.
- **Risk: signature change to `evaluateThreshold`** breaks callers/tests. *Mitigation:* new params are defaulted; the default-equivalence test suite proves no behavior change.
- **Rollout:** (1) run the `ALTER TABLE` on remote + local D1; (2) deploy Worker with config-aware sweep (defaults = today, so zero behavior change on deploy); (3) ship the dashboard UI; (4) announce as an opt-in "Agent controls" refinement. Fully backward compatible — apps that never open the settings panel behave identically to today.

---

## 8. Effort & required decision

**Effort: M (Medium).** One JSON column + migration, a pure config module with its parser, a focused change to one pure function, threading two values through the existing sweep loop, two owner-scoped API routes, and a small settings panel. The bulk of the work is tests (regression-critical: the default-equivalence suite) — not new infrastructure. No engine changes, no new data sources, no credential surface.

**Decision needed from the owner before building (one item):**
- **Confirm `notify_only` semantics and default.** Is `notify_only` the right model (record + email, never open a run), and should the rank-drop trigger ship **off by default** (recommended, to avoid iTunes-volatility noise)? Everything else (mute lists, competitor modes, JSON-column persistence) is a straightforward mechanical refinement of the existing heuristic and needs no product call. Recommendation: ship with all defaults reproducing today's behavior exactly, rank-drop off, and `notify_only` as an explicit opt-in.

