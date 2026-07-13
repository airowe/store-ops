# D1 migrations

Incremental, forward-only schema changes applied to production D1 **automatically
on deploy** (`.github/workflows/deploy.yml` runs `wrangler d1 migrations apply
store_ops --remote` before deploying the Worker). Wrangler tracks which files have
run in a `d1_migrations` table and applies **only the new ones**, so re-deploys are
safe and one-way changes (e.g. `ALTER TABLE`) run exactly once.

## Relationship to `schema.sql`

- **`../schema.sql`** stays the canonical, full picture of the schema — the
  reference doc and the bootstrap for a brand-new/local database.
- **`migrations/`** holds the incremental changes from the point we adopted this
  system (2026-07). Every schema change from now on lands as BOTH: a new numbered
  file here (what actually runs in prod) and the corresponding edit to
  `schema.sql` (so the canonical schema stays complete).

## Adding a migration

1. Create `NNNN_short_name.sql` (next number, zero-padded 4 digits).
2. Prefer idempotent DDL (`CREATE TABLE/INDEX IF NOT EXISTS`) where possible.
   A one-way change (`ALTER TABLE ADD COLUMN`, backfill) is fine — it runs once.
3. Mirror the change into `../schema.sql`.
4. Validate locally: `npx wrangler d1 migrations apply store_ops --local`.
5. The next merge to `main` applies it to prod.

## Prerequisite (one-time)

The deploy token needs **Account · D1 · Edit** (in addition to Workers Scripts /
Pages Edit). Without it, the `migrations apply` step fails loudly — which is the
point: a schema that can't apply must not be masked.

## Not auto-applied yet

The standing `rank_snapshots.country` change (documented in `../schema.sql`) is
**not** in this directory, because we can't confirm from CI whether the column was
already added to prod by hand — and a bare `ALTER TABLE ADD COLUMN` on a column
that already exists would fail the whole apply and block deploys. Confirm the prod
state, then add it as `0002_rank_snapshots_country.sql` (or run it once manually
per the commands in `../schema.sql`).
