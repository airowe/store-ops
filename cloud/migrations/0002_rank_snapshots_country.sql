-- 0002_rank_snapshots_country — add the per-market rank dimension (#180 Phase 1).
--
-- The column is ABSENT in production — confirmed the hard way: the first version of
-- this migration skipped the ADD COLUMN (assuming the deployed INSERTs proved it
-- existed) and failed with `no such column: country`. So the deployed rank-insert
-- path has in fact been failing on that column; this migration is what makes it
-- work. This file never applied successfully, so replacing its contents is safe —
-- wrangler only records a migration once it succeeds.
--
--   1. add the column (NOT NULL DEFAULT '' backfills existing rows as legacy),
--   2. backfill those legacy rows with the app's storefront (lowercased),
--   3. add the per-market lookup index.
--
-- (On a fresh/local DB the column comes from schema.sql's CREATE TABLE instead;
-- this ALTER only runs against the existing prod table via the deploy pipeline.)
ALTER TABLE rank_snapshots ADD COLUMN country TEXT NOT NULL DEFAULT '';

UPDATE rank_snapshots
   SET country = COALESCE((SELECT lower(a.country) FROM apps a WHERE a.id = rank_snapshots.app_id), '')
 WHERE country = '';

CREATE INDEX IF NOT EXISTS idx_rank_app_country_kw ON rank_snapshots(app_id, country, keyword, checked_at);
