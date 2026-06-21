-- store-ops D1 schema (SQLite)
-- Apply: npm run db:migrate:local   (local)   |   npm run db:migrate   (remote)
--
-- State model for the autonomous ASO loop:
--   user --< app --< run --< (proposals, approval)
--   app  --< rank_snapshots / competitor_snapshots   (time-series ground truth)
--
-- The run.status enum is the spine of the approval-gate guarantee:
--   detected -> researching -> awaiting_approval -> approved|rejected
-- Approval moves a run to 'approved' and REVEALS the push commands; it does not
-- push anything. 'shipped' is reserved for a verified push that actually reached
-- App Store Connect (set out-of-band, not by the approval gate) — so a run's
-- status never claims 'shipped' until something truly shipped.

PRAGMA foreign_keys = ON;

-- ── users ────────────────────────────────────────────────────────────────────
-- A user is an email + id; auth is passwordless magic-link → a signed session
-- cookie (no password column). Billing state lives inline (one user == one
-- subscription account): tier gates autonomy + app count, the stripe_* columns
-- mirror the Stripe customer/subscription, status/current_period_end track the
-- live subscription. Everyone defaults to 'free'.
CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,            -- uuid
  email                   TEXT NOT NULL UNIQUE,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  tier                    TEXT NOT NULL DEFAULT 'free'
                            CHECK (tier IN ('free', 'launch', 'autopilot', 'fleet')),
  status                  TEXT NOT NULL DEFAULT 'active',   -- mirrors Stripe sub status
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  current_period_end      TEXT,                         -- ISO; NULL for free / one-time
  github_installation_id  TEXT,                         -- GitHub App installation id (not sensitive)
  github_repo             TEXT,                         -- "owner/name" target for metadata PRs
  agent_paused            INTEGER NOT NULL DEFAULT 0    -- 0/1: owner paused the weekly autonomous sweep (issue #51)
);

-- Migration for an EXISTING db (the CREATE above only fires on a fresh db). Run
-- the same statements remotely + locally:
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','launch','autopilot','fleet'))"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN current_period_end TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN github_installation_id TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN github_repo TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN agent_paused INTEGER NOT NULL DEFAULT 0"
-- (add `--local` to each for the local D1; drop it for remote.)

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

-- ── subscribers ──────────────────────────────────────────────────────────────
-- Launch / "notify me" email capture from the marketing landing. Not a user
-- account — just an intent-to-stay list. Email is unique (idempotent signup).
-- Migration for an existing db:
--   npx wrangler d1 execute store_ops --command "CREATE TABLE IF NOT EXISTS subscribers (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
CREATE TABLE IF NOT EXISTS subscribers (
  id          TEXT PRIMARY KEY,                       -- uuid
  email       TEXT NOT NULL UNIQUE,
  source      TEXT,                                   -- where they signed up (e.g. 'landing')
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
