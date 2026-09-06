-- 0017_autopilot_execute — the agent executes an approved run's writes itself.
--
-- Until now the loop stopped at 'approved': the agent proposed, a person
-- approved, and then a person (or a curl) had to call each write route. With
-- this flag ON, approval is still the human's act — and the last one. The
-- agent then does what the write routes do, in order, with the stored key:
-- editable version, metadata, each approved locale. It records every step so
-- the run page can say what actually reached Apple, and marks the run
-- 'shipped' only when the metadata push returned success.
--
-- CONSENT ONLY, and OFF by default. Executing additionally requires everything
-- a manual write requires: a paid tier (canAscWrite), asc_write_opt_in, an
-- approved run, ASC_WRITE_ENABLED, and a stored key (per-app or account-wide).
-- The flag adds no permission a person did not already have to grant.
--
-- Rollback: UPDATE users SET autopilot_execute = 0; DROP TABLE run_executions;
ALTER TABLE users ADD COLUMN autopilot_execute INTEGER NOT NULL DEFAULT 0;

-- One row per (run, step). `status` is what happened, never what was hoped:
--   done     the write returned success from Apple
--   skipped  nothing to do, with the reason (no locales, no assets server-side)
--   failed   Apple or a precondition refused, with the reason
-- A run with a 'done' metadata row is what makes runs.status = 'shipped'.
CREATE TABLE IF NOT EXISTS run_executions (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,            -- 'version' | 'metadata' | 'locale:<code>' | 'screenshots' | 'experiment'
  status      TEXT NOT NULL CHECK (status IN ('done', 'skipped', 'failed')),
  detail      TEXT NOT NULL DEFAULT '', -- ids Apple returned, or the reason
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_run_executions_run ON run_executions(run_id, created_at);
