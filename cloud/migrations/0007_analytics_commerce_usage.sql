-- 0007_analytics_commerce_usage — COMMERCE + APP_USAGE analytics series + a raw
-- header-capture table. Siblings of analytics_engagement: composite PK over
-- (app_id, date, <dimensions>); metric columns NULL when absent (never a fake 0).
-- analytics_report_headers stores Apple's real header row per category so an
-- unconfirmed COLUMN_MAP is a visible, one-line fix. Idempotent (IF NOT EXISTS) —
-- a no-op if schema.sql already created these (fresh DBs get them directly).

CREATE TABLE IF NOT EXISTS analytics_commerce (
  app_id        TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  content_name  TEXT NOT NULL DEFAULT '',
  purchase_type TEXT NOT NULL DEFAULT '',
  sales         INTEGER,
  proceeds      REAL,
  paying_users  INTEGER,
  ingested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, date, content_name, purchase_type)
);
CREATE INDEX IF NOT EXISTS idx_analytics_commerce_app ON analytics_commerce(app_id, date);

CREATE TABLE IF NOT EXISTS analytics_usage (
  app_id         TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  app_version    TEXT NOT NULL DEFAULT '',
  device         TEXT NOT NULL DEFAULT '',
  sessions       INTEGER,
  active_devices INTEGER,
  installations  INTEGER,
  deletions      INTEGER,
  crashes        INTEGER,
  unique_devices INTEGER,
  ingested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, date, app_version, device)
);
CREATE INDEX IF NOT EXISTS idx_analytics_usage_app ON analytics_usage(app_id, date);

CREATE TABLE IF NOT EXISTS analytics_report_headers (
  app_id         TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  report_version TEXT NOT NULL DEFAULT '',
  header_row     TEXT NOT NULL,
  captured_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, category, header_row)
);
