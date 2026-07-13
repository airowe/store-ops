-- 0002_rank_snapshots_country — finish the per-market rank tracking migration (#180).
--
-- IMPORTANT: this intentionally does NOT run `ALTER TABLE rank_snapshots ADD COLUMN
-- country`. The column is already present in production — the deployed rank-insert
-- path writes it (`INSERT INTO rank_snapshots (… country …)` in d1.ts), so a prod
-- without the column would already be failing every rank write. SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, so re-adding an existing column ERRORS and would fail
-- the whole apply (blocking the deploy). We therefore run ONLY the two idempotent
-- remainders, both of which are no-ops if they were already applied by hand:
--
--   1. backfill legacy rows whose country was written as '' (before per-market
--      tracking) with the app's storefront, lowercased.
--   2. ensure the per-market lookup index exists.
--
-- (For a brand-new/local DB the column itself comes from schema.sql's CREATE TABLE.)
UPDATE rank_snapshots
   SET country = COALESCE((SELECT lower(a.country) FROM apps a WHERE a.id = rank_snapshots.app_id), '')
 WHERE country = '';

CREATE INDEX IF NOT EXISTS idx_rank_app_country_kw ON rank_snapshots(app_id, country, keyword, checked_at);
