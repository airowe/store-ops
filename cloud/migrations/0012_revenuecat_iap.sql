-- 0012_revenuecat_iap — a SECOND payment source: native in-app subscriptions via
-- the RevenueCat SDK (App Store / Play Billing), alongside the existing Stripe
-- (web) subscription. Motivated by RevenueCat Shipaton 2026 (the RevenueCat SDK
-- must power an in-app purchase) and Apple's "implement IAP" fix for the 3.1.1
-- rejection, superseding the sell-nothing workaround (#423).
--
-- POLICY — HIGHEST ACTIVE TIER WINS. A user may hold BOTH a web (Stripe) and an
-- in-app (RevenueCat) subscription. Rather than overload the single `tier` column
-- (which everything reads) with one source, we record EACH source's granted tier
-- separately and materialize `tier` = max(stripe_tier, iap_tier) via
-- `recomputeEffectiveTier`. That keeps every existing reader of `users.tier`
-- correct with no read-site change, and lets one source downgrade without losing
-- the other's independent grant.
--
--   stripe_tier             — tier the Stripe (web) sub grants; NULL/'free' → none
--   iap_tier                — tier the RevenueCat (in-app) sub grants; NULL/'free' → none
--   iap_status              — last RC status: active|cancelled|expired|billing_issue|paused
--   iap_product_id          — store product id behind the current IAP entitlement
--   iap_period_end          — ISO expiry of the current IAP entitlement
--   revenuecat_app_user_id  — RC app_user_id (equals our user id once the app logs in)
--
-- Plain `ALTER TABLE ADD COLUMN` (like 0011): each only APPENDS a nullable column,
-- which SQLite applies to existing rows without a table rewrite. These columns are
-- defined HERE ONLY, never in schema.sql — the specs build a real DB as schema.sql
-- (baseline) + every migration in order, so a column present in both fails with
-- "duplicate column name".
ALTER TABLE users ADD COLUMN stripe_tier TEXT;
ALTER TABLE users ADD COLUMN iap_tier TEXT;
ALTER TABLE users ADD COLUMN iap_status TEXT;
ALTER TABLE users ADD COLUMN iap_product_id TEXT;
ALTER TABLE users ADD COLUMN iap_period_end TEXT;
ALTER TABLE users ADD COLUMN revenuecat_app_user_id TEXT;

-- Backfill: an existing row's `tier` is entirely Stripe-derived today, so seed
-- stripe_tier from it. The effective tier stays identical (iap_tier is NULL →
-- 'free') until the first IAP purchase arrives, so no user changes plan here.
UPDATE users SET stripe_tier = tier;
