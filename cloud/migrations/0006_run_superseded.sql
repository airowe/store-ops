-- 0006_run_superseded — add the 'superseded' run status + backfill stale rows.
--
-- WHY: an older awaiting_approval run left open when the agent re-ran an app
-- accumulated as a phantom "pending" run (the funnel bug — Mangia 9/16, Heathen
-- 4/13). persistRun now flips prior open runs to 'superseded'; this migration
-- (a) widens the status CHECK to allow it and (b) backfills the existing stale
-- rows so today's phantoms resolve on deploy.
--
-- SQLite can't ALTER a CHECK constraint, so this is the standard rebuild:
-- create-new → copy → drop → rename (mirrors the #78-2 stored_credentials kind
-- widening). Guarded so a re-run is a no-op: if runs_new already exists from a
-- half-applied run we drop it first; the final table keeps the original name.

DROP TABLE IF EXISTS runs_new;

CREATE TABLE runs_new (
  id             TEXT PRIMARY KEY,
  app_id         TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'detected'
                   CHECK (status IN (
                     'detected', 'researching', 'awaiting_approval',
                     'approved', 'rejected', 'shipped', 'superseded'
                   )),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reasoning_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO runs_new (id, app_id, status, created_at, reasoning_json)
  SELECT id, app_id, status, created_at, reasoning_json FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX IF NOT EXISTS idx_runs_app    ON runs(app_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- Backfill: for each app, keep the NEWEST awaiting_approval run open; mark every
-- older awaiting_approval run 'superseded'. A run is stale iff a strictly-newer
-- awaiting_approval run exists for the same app (ties broken by id, matching the
-- newest-first ordering listRunsForApp uses). Decided runs are never touched.
UPDATE runs SET status = 'superseded'
WHERE status = 'awaiting_approval'
  AND EXISTS (
    SELECT 1 FROM runs newer
    WHERE newer.app_id = runs.app_id
      AND newer.status = 'awaiting_approval'
      AND (newer.created_at > runs.created_at
           OR (newer.created_at = runs.created_at AND newer.id > runs.id))
  );
