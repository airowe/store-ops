-- 0003_play_rank_snapshots — persist Google Play CATEGORY CHART rank as a time
-- series (ranking-parity step 1). Play chart rank was measured on-demand (#221)
-- and thrown away; this table stores it so the pure rank-analysis modules
-- (opportunity / attribution / war-room) can run for Play the way they do for iOS.
--
-- Keyed by (collection, category, country) — a category-chart position is NOT a
-- search-keyword position, so it lives apart from rank_snapshots (keyword-keyed).
-- position NULL = we read the chart and the app was not in the top out_of (honest
-- "not charting"); an unreadable/UNKNOWN chart is never inserted. Idempotent
-- (IF NOT EXISTS) — a no-op on a DB that already got the table from schema.sql.
CREATE TABLE IF NOT EXISTS play_rank_snapshots (
  id            TEXT PRIMARY KEY,
  app_id        TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  package_name  TEXT NOT NULL,
  collection    TEXT NOT NULL,
  category      TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT '',
  position      INTEGER,
  out_of        INTEGER NOT NULL DEFAULT 0,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_play_rank_app
  ON play_rank_snapshots(app_id, category, collection, country, checked_at);
