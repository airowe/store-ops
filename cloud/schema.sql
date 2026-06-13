-- store-ops D1 schema (SQLite)
-- Apply: npm run db:migrate:local   (local)   |   npm run db:migrate   (remote)
--
-- State model for the autonomous ASO loop:
--   user --< app --< run --< (proposals, approval)
--   app  --< rank_snapshots / competitor_snapshots   (time-series ground truth)
--
-- The run.status enum is the spine of the approval-gate guarantee:
--   detected -> researching -> awaiting_approval -> approved|rejected -> shipped
-- The irreversible push only happens after an 'approved' approval row exists.

PRAGMA foreign_keys = ON;

-- ── users ────────────────────────────────────────────────────────────────────
-- Auth is STUBBED for the demo (magic-link / simple session). A user is just an
-- email + id; sessions are signed tokens, no password column.
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                       -- uuid
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── apps ─────────────────────────────────────────────────────────────────────
-- An app a customer connected by bundle id. country scopes every iTunes call.
CREATE TABLE IF NOT EXISTS apps (
  id          TEXT PRIMARY KEY,                       -- uuid
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bundle_id   TEXT NOT NULL,                          -- e.g. com.airowe.heathen
  name        TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT 'US',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, bundle_id)
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON apps(user_id);

-- ── runs ─────────────────────────────────────────────────────────────────────
-- One pass of the agent loop for an app. reasoning_json holds the agent's
-- decision trace (audit findings, keyword scores, why it re-drafted).
-- status enum (CHECK-enforced):
--   detected | researching | awaiting_approval | approved | rejected | shipped
CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,                    -- uuid
  app_id         TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'detected'
                   CHECK (status IN (
                     'detected', 'researching', 'awaiting_approval',
                     'approved', 'rejected', 'shipped'
                   )),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reasoning_json TEXT NOT NULL DEFAULT '{}'           -- JSON blob (agent trace)
);
CREATE INDEX IF NOT EXISTS idx_runs_app    ON runs(app_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- ── rank_snapshots ───────────────────────────────────────────────────────────
-- Time-series of organic rank per keyword (iTunes Search API).
-- rank = 1-based index in results[], or NULL when not in top `total` (top 200).
CREATE TABLE IF NOT EXISTS rank_snapshots (
  id          TEXT PRIMARY KEY,                       -- uuid
  app_id      TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  rank        INTEGER,                                -- NULL = not in top results
  total       INTEGER NOT NULL DEFAULT 0,             -- how many apps competed
  checked_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rank_app_kw ON rank_snapshots(app_id, keyword, checked_at);

-- ── competitor_snapshots ─────────────────────────────────────────────────────
-- Time-series of competitor visible listing fields (iTunes Lookup API).
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id          TEXT PRIMARY KEY,                       -- uuid
  app_id      TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  comp_id     TEXT NOT NULL,                          -- competitor App Store trackId
  name        TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  rating      TEXT NOT NULL DEFAULT '',
  seen_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_app ON competitor_snapshots(app_id, comp_id, seen_at);

-- ── approvals ────────────────────────────────────────────────────────────────
-- The human approval gate. One decision row per run. 'approved' is the only
-- state that unlocks the irreversible push (command handoff).
CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,                       -- uuid
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  decision    TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (run_id)
);

-- ── proposals ────────────────────────────────────────────────────────────────
-- The optimized copy the agent produced for a run, per store field, with the
-- char_count it committed to (HARD limits: name 30, subtitle 30,
-- keyword-field 100, promo 170, desc 4000 — enforced in the engine, recorded here).
CREATE TABLE IF NOT EXISTS proposals (
  id          TEXT PRIMARY KEY,                       -- uuid
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,                          -- name|subtitle|keywords|promo|description
  value       TEXT NOT NULL,
  char_count  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_run ON proposals(run_id);
