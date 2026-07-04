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
                            CHECK (tier IN ('free', 'indie', 'startup', 'scale')),
  status                  TEXT NOT NULL DEFAULT 'active',   -- mirrors Stripe sub status
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  current_period_end      TEXT,                         -- ISO; NULL for free / one-time
  github_installation_id  TEXT,                         -- GitHub App installation id (not sensitive)
  github_repo             TEXT,                         -- "owner/name" target for metadata PRs
  agent_paused            INTEGER NOT NULL DEFAULT 0,   -- 0/1: owner paused the weekly autonomous sweep (issue #51)
  rlhf_opt_out            INTEGER NOT NULL DEFAULT 0,    -- 1 ⇒ do NOT capture this user's proposal edits (#39 Part 2)
  rank_cadence            TEXT NOT NULL DEFAULT 'weekly' -- 'daily'|'weekly': how often the cron snapshots ranks (issue #94)
                            CHECK (rank_cadence IN ('daily', 'weekly')),
  email_digest            TEXT NOT NULL DEFAULT 'weekly' -- comms-prefs: weekly digest email; 'off' silences it (the sweep runs regardless)
                            CHECK (email_digest IN ('weekly', 'off')),
  push_run_ready          INTEGER NOT NULL DEFAULT 1     -- comms-prefs: 0 ⇒ do NOT send run-ready push (the run still opens)
);

-- Migration for an EXISTING db (the CREATE above only fires on a fresh db). Run
-- the same statements remotely + locally:
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','indie','startup','scale'))"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN current_period_end TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN github_installation_id TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN github_repo TEXT"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN agent_paused INTEGER NOT NULL DEFAULT 0"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN rlhf_opt_out INTEGER NOT NULL DEFAULT 0"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN rank_cadence TEXT NOT NULL DEFAULT 'weekly' CHECK (rank_cadence IN ('daily','weekly'))"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN email_digest TEXT NOT NULL DEFAULT 'weekly' CHECK (email_digest IN ('weekly','off'))"
--   npx wrangler d1 execute store_ops --command "ALTER TABLE users ADD COLUMN push_run_ready INTEGER NOT NULL DEFAULT 1"
-- (add `--local` to each for the local D1; drop it for remote.)
--
-- ⚠️ DEPLOY ORDER (comms-prefs): apply the email_digest/push_run_ready ALTERs
-- BEFORE deploying a Worker that references them — USER_COLS names the columns,
-- so an un-migrated DB fails every getUser/requireUser call app-wide, not just
-- the prefs routes. Migration first, deploy second (the rank_cadence precedent).
--
-- TIER RENAME (Appeeky-undercut: launch/autopilot/fleet → indie/startup/scale).
-- DATA migration — remaps existing rows to the new tier names (the dropped
-- 'launch' one-time tier maps to 'startup'). Run BEFORE tightening the CHECK
-- constraint, since the old tier values would otherwise violate the new check.
-- The human applies these remotely; do NOT run them from code:
--   npx wrangler d1 execute store_ops --command "UPDATE users SET tier='scale' WHERE tier='fleet'; UPDATE users SET tier='indie' WHERE tier='autopilot'; UPDATE users SET tier='startup' WHERE tier='launch';"
-- SQLite cannot ALTER an existing CHECK constraint in place; to adopt the new
-- CHECK on an existing db, rebuild the users table (CREATE new → INSERT … SELECT
-- → DROP old → RENAME), or recreate from this schema after the data UPDATE above.
-- (add `--local` for the local D1; drop it for remote.)

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

-- ── app_competitors ──────────────────────────────────────────────────────────
-- #72: the competitors an app actually WATCHES. Before this table existed the
-- weekly "watched competitors" step always ran on an EMPTY list. Rows arrive two
-- ways: auto-discovery (source='discovered', status='suggested' until the user
-- confirms) and user entry (source='user', confirmed immediately). Only
-- status='confirmed' rows feed runs + the weekly sweep — a suggestion is never
-- silently watched.
-- ⚠️ DEPLOY ORDER: create this table (db-migrate workflow) BEFORE deploying a
-- Worker that reads it. Reads are defensively guarded, but the feature is dead
-- until the table exists.
CREATE TABLE IF NOT EXISTS app_competitors (
  app_id      TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  comp_key    TEXT NOT NULL,                          -- App Store trackId (or bundle id)
  name        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'user'
                CHECK (source IN ('user', 'discovered')),
  status      TEXT NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('suggested', 'confirmed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, comp_key)
);
CREATE INDEX IF NOT EXISTS idx_app_competitors ON app_competitors(app_id, status);

-- ── app_settings ─────────────────────────────────────────────────────────────
-- Per-app agent configuration. threshold_json holds the run-threshold config
-- (#53, src/thresholds.ts); schedule_json holds the sweep schedule (#52,
-- src/schedule.ts — default weekly Monday 09:00 UTC); last_sweep_at stamps the
-- last completed sweep (the hourly cron's due-check reads it). ALL reads are
-- FAIL-OPEN: missing row / column / NULL / garbage → today's behavior.
-- ⚠️ DEPLOY ORDER: create/alter via the db-migrate workflow BEFORE deploying a
-- Worker that reads it (reads degrade gracefully, but writes 500 until then).
-- Migration for pre-#52 deployments:
--   ALTER TABLE app_settings ADD COLUMN schedule_json TEXT;
--   ALTER TABLE app_settings ADD COLUMN last_sweep_at TEXT;
CREATE TABLE IF NOT EXISTS app_settings (
  app_id          TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  threshold_json  TEXT NOT NULL DEFAULT '{}',
  schedule_json   TEXT,
  last_sweep_at   TEXT
);

-- ── stored_credentials ───────────────────────────────────────────────────────
-- #67 post-launch half: OPT-IN, server-side, envelope-encrypted store
-- credentials (design: docs/prd/credential-storage/00-design.md). This table
-- holds ONLY ciphertext — never key material: the KEK is a Worker secret
-- (CRED_KEK_V*), never in D1/repo. Write-only custody: no route ever returns
-- plaintext; identifiers (key_id/issuer_id) are non-secret metadata for the UI.
-- ⚠️ DEPLOY ORDER: create via db-migrate BEFORE deploying a Worker that reads it.
CREATE TABLE IF NOT EXISTS stored_credentials (
  id            TEXT PRIMARY KEY,                     -- uuid
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id        TEXT REFERENCES apps(id) ON DELETE CASCADE, -- NULL = account-level
  kind          TEXT NOT NULL CHECK (kind IN ('asc','play')),
  -- non-secret identifiers, shown in the management UI (never key material):
  key_id        TEXT NOT NULL DEFAULT '',             -- ASC Key ID / Play client_email
  issuer_id     TEXT NOT NULL DEFAULT '',             -- ASC Issuer ID (empty for play)
  -- the envelope (base64) — safe to store; useless without the KEK:
  ciphertext    TEXT NOT NULL,                        -- IV ++ payload-ct+tag
  wrapped_dek   TEXT NOT NULL,                        -- IV ++ wrapped-DEK+tag
  kek_version   INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  UNIQUE (user_id, app_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_stored_cred_user ON stored_credentials(user_id);

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

-- ── proposal_edits ───────────────────────────────────────────────────────────
-- RLHF capture (#39 Part 2): the (agent proposal → human-shipped final, decision)
-- preference signal, one row per editable field, written ATOMICALLY inside the
-- recordApproval batch so the captured signal can never disagree with the gate.
--
-- PRIVACY BY CONSTRUCTION:
--   • FULLY ANONYMOUS — there is deliberately NO user_id and NO app_id column. A
--     row cannot be traced back to a user or an app. (Honored at write time:
--     opted-out users produce ZERO rows; since rows are anonymous they could not
--     be selectively deleted later, so capture must never start for them.)
--   • ENCRYPTED AT REST — proposed_enc / final_enc hold AES-256-GCM ciphertext
--     (random 12-byte IV ++ ciphertext, base64), keyed by env.RLHF_ENCRYPTION_KEY.
--     The copy text is NEVER stored in plaintext. With no key set, capture is a
--     silent no-op (safe-degrade) — no row is written and the approval proceeds.
--   • edited = 1 when the human changed the field, 0 when it shipped unchanged.
--     decision ∈ {approved, rejected} — a rejection is a negative preference.
-- Migration for an existing db (the CREATE above only fires on a fresh db):
--   npx wrangler d1 execute store_ops --command "CREATE TABLE IF NOT EXISTS proposal_edits (id TEXT PRIMARY KEY, field TEXT NOT NULL, decision TEXT NOT NULL, edited INTEGER NOT NULL, proposed_enc TEXT NOT NULL, final_enc TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
-- (add `--local` for the local D1; drop it for remote.)
CREATE TABLE IF NOT EXISTS proposal_edits (
  id            TEXT PRIMARY KEY,                     -- uuid
  field         TEXT NOT NULL,                        -- name|subtitle|keywords|promo|description|whatsNew
  decision      TEXT NOT NULL,                        -- 'approved' | 'rejected'
  edited        INTEGER NOT NULL,                     -- 1 if the human changed it, else 0
  proposed_enc  TEXT NOT NULL,                        -- AES-256-GCM(IV++ciphertext, base64) of the agent's value
  final_enc     TEXT NOT NULL,                        -- AES-256-GCM(IV++ciphertext, base64) of the shipped value
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── review_snapshots ─────────────────────────────────────────────────────────
-- OPTIONAL best-effort cache of PUBLIC App Store reviews (#95). Reviews change
-- slowly, so caching the RSS-feed read avoids re-fetching every audit (PRD 03
-- open question). PUBLIC data only — never ASC/private review data. The engine
-- works WITHOUT this table (the cache is best-effort and the API run fetches
-- live), so it is purely additive; no code path depends on it yet.
-- Migration for an existing db (the CREATE above only fires on a fresh db):
--   npx wrangler d1 execute store_ops --command "CREATE TABLE IF NOT EXISTS review_snapshots (id TEXT PRIMARY KEY, app_id TEXT NOT NULL, review_id TEXT NOT NULL, rating INTEGER, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT 'us', fetched_at TEXT NOT NULL DEFAULT (datetime('now')))"
-- (add `--local` for the local D1; drop it for remote.)
CREATE TABLE IF NOT EXISTS review_snapshots (
  id          TEXT PRIMARY KEY,                       -- uuid
  app_id      TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  review_id   TEXT NOT NULL,                          -- the public RSS review id
  rating      INTEGER,                                -- 1–5 stars, NULL when the feed omitted it
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT 'us',
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_app ON review_snapshots(app_id, fetched_at);

-- ── device_tokens ────────────────────────────────────────────────────────────
-- Expo push tokens per user, so the cron can notify an owner when a run opens
-- while they're away (mobile, Phase 5). A token is unique (one row per device);
-- re-registering the same token just refreshes ownership/timestamp. Not a
-- credential — but we never log full tokens.
-- Migration for an EXISTING db (the CREATE below only fires on a fresh db):
--   npx wrangler d1 execute store_ops --command "CREATE TABLE IF NOT EXISTS device_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL DEFAULT 'ios', created_at TEXT NOT NULL DEFAULT (datetime('now')))"
--   npx wrangler d1 execute store_ops --command "CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)"
-- (add `--local` for the local D1; drop it for remote.)
CREATE TABLE IF NOT EXISTS device_tokens (
  token       TEXT PRIMARY KEY,                       -- the Expo push token (unique per device)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL DEFAULT 'ios',            -- 'ios' | 'android'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
