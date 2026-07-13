# D1 migrations

Incremental, forward-only schema changes applied to production D1 **automatically
on deploy** (`.github/workflows/deploy.yml` runs `wrangler d1 migrations apply
store_ops --remote` before deploying the Worker). Wrangler tracks which files have
run in a `d1_migrations` table and applies **only the new ones**, so re-deploys are
safe and one-way changes (e.g. `ALTER TABLE`) run exactly once.

## Relationship to `schema.sql`

- **`../schema.sql`** is the BASELINE bootstrap for a brand-new/local database
  (`CREATE TABLE IF NOT EXISTS …`), plus the reference doc.
- **`migrations/`** holds the incremental changes on top of that baseline, applied
  in order and tracked in `d1_migrations`.
- **They must compose, not overlap.** A change a migration makes with a bare
  `ALTER TABLE ADD COLUMN` must NOT also be declared in `schema.sql`'s `CREATE`
  — otherwise a fresh DB (bootstrapped from `schema.sql`) already has the column
  and the migration's non-idempotent `ADD COLUMN` fails on it. So `schema.sql`
  stays at the *pre-migration* baseline for such columns; the migration owns them.
  (Example: `rank_snapshots.country` lives only in `0002`, not in `schema.sql`'s
  `CREATE TABLE rank_snapshots`.) Idempotent DDL (`CREATE … IF NOT EXISTS`) is
  safe to keep in both.

## Adding a migration

1. Create `NNNN_short_name.sql` (next number, zero-padded 4 digits).
2. Prefer idempotent DDL (`CREATE TABLE/INDEX IF NOT EXISTS`). A one-way change
   (`ALTER TABLE ADD COLUMN`, backfill) is fine — it runs once — but do NOT also
   add that column to `schema.sql`'s `CREATE` (see above).
3. Validate the full compose locally (baseline + migrations):
   `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npx wrangler d1 migrations apply store_ops --local`.
4. The next merge to `main` applies it to prod.

## Prerequisite (one-time)

The deploy token needs **Account · D1 · Edit** (in addition to Workers Scripts /
Pages Edit). Without it, the `migrations apply` step fails loudly — which is the
point: a schema that can't apply must not be masked.

## The `ADD COLUMN` gotcha (learned from `0002`)

SQLite has no `ADD COLUMN IF NOT EXISTS`, so a bare `ALTER TABLE … ADD COLUMN` is not
idempotent: it errors if the column is already there. Confirm the prod state before
choosing. `0002_rank_snapshots_country.sql` learned this the hard way — its first
version *assumed* the column existed (skipping the ADD) and failed with `no such
column: country`; the corrected version adds the column. Note that a **failed**
migration is never recorded as applied, so it's safe to edit and re-ship — wrangler
retries it on the next deploy. (A *successfully applied* migration must never be
edited; add a new numbered file instead.)
