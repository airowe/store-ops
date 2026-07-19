-- 0004_play_funnel_snapshots — persist the Google Play conversion funnel (PRD 02-D).
-- The Play sibling of analytics_engagement: monthly store-listing visitors →
-- acquisitions from the GCS export (the only official Play funnel source). visitors
-- / acquisitions are NULL when absent (never a fake 0); the conversion rate is
-- derived at read time. Idempotent (IF NOT EXISTS) — a no-op if schema.sql already
-- created it.
CREATE TABLE IF NOT EXISTS play_funnel_snapshots (
  app_id        TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT '',
  visitors      INTEGER,
  acquisitions  INTEGER,
  source        TEXT NOT NULL DEFAULT 'gcs',
  ingested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, period, country)
);
CREATE INDEX IF NOT EXISTS idx_play_funnel_app ON play_funnel_snapshots(app_id, period);
