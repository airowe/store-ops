-- 0005_corpus_snapshots — the compounding rank+metadata data moat (#63).
-- A daily, category-tagged sample of the top-N apps per broad seed keyword — NOT
-- just customer apps, so deliberately NO app_id / FK (these are arbitrary store
-- apps). Collection is OFF by default (env.CATEGORY_CORPUS_ENABLED) and capped
-- small (seeds × topN ≈ 200 rows/day). VISIBLE fields only — iTunes exposes
-- name/version/description/rating/category/rank, NOT subtitle or the keyword
-- field — so a rank we couldn't read is NULL (beyond the cap), never a fake 0.
-- Idempotent (IF NOT EXISTS) — a no-op if schema.sql already created it.
CREATE TABLE IF NOT EXISTS corpus_snapshots (
  id            TEXT PRIMARY KEY,
  seed_keyword  TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT '',
  bundle_id     TEXT NOT NULL,
  track_id      INTEGER,
  name          TEXT NOT NULL DEFAULT '',
  category_id   TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '',
  rank          INTEGER,
  version       TEXT NOT NULL DEFAULT '',
  rating        REAL,
  rating_count  INTEGER,
  description   TEXT NOT NULL DEFAULT '',
  checked_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corpus_seed ON corpus_snapshots(seed_keyword, country, checked_at);
CREATE INDEX IF NOT EXISTS idx_corpus_bundle ON corpus_snapshots(bundle_id, checked_at);
