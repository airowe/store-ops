# D1 migrations — the ONE mechanism

Schema changes reach production one way: **numbered SQL files in this directory,
applied automatically on deploy.** `.github/workflows/deploy.yml` runs
`wrangler d1 migrations apply store_ops --remote` **before** deploying the Worker;
wrangler records applied files in a `d1_migrations` table and runs **only new
ones**, so re-deploys are safe and one-way changes (`ALTER TABLE`) run exactly once.
Because migrations apply before the Worker deploys, a table/column a migration adds
already exists by the time the new code reads it — no manual deploy-ordering.

> **History:** there used to be a *second*, parallel mechanism — a manual
> `.github/workflows/db-migrate.yml` that PRAGMA-probed prod and added missing
> columns. Two systems that both "apply pending schema" is how a bad migration
> slipped through (0002 first shipped assuming a column existed). It's **retired**.
> Its historical column-adds already live in `schema.sql`'s `CREATE`s (fresh DBs)
> and are applied in prod, so nothing was lost.

## The two layers, and the rule that keeps them from colliding

- **`../schema.sql`** — the BASELINE for a brand-new / local DB (`CREATE TABLE IF
  NOT EXISTS …`), plus the reference doc. Apply it with `npm run db:migrate` (remote)
  or `npm run db:migrate:local` (local) when first creating a database.
- **`migrations/`** — incremental changes layered on that baseline, in order.
- **The rule:** a change a migration makes with a **bare `ALTER TABLE ADD COLUMN`**
  must NOT also be declared in `schema.sql`'s `CREATE`. Otherwise a fresh DB already
  has the column and the migration's non-idempotent `ADD COLUMN` fails on it (and,
  symmetrically, an existing DB without it fails if the migration *skips* the ADD —
  that was the 0002 incident). So `schema.sql` stays at the *pre-migration* baseline
  for migration-owned columns; the migration owns them. Idempotent DDL
  (`CREATE … IF NOT EXISTS`) is safe to keep in both.
  - Example: `rank_snapshots.country` lives only in `0002`, never in `schema.sql`'s
    `CREATE TABLE rank_snapshots`.

## Adding a migration

1. Create `NNNN_short_name.sql` (next number, zero-padded 4 digits).
2. **Adding a table/index?** `CREATE TABLE/INDEX IF NOT EXISTS` — idempotent, safe,
   and you may also keep it in `schema.sql`.
3. **Adding a column to an existing table?** `ALTER TABLE … ADD COLUMN` (+ any
   backfill) in the migration ONLY — do **not** also add it to `schema.sql`'s
   `CREATE` (see the rule above). It runs exactly once.
4. **Changing a CHECK / rebuilding a table?** Do the create-new → copy → drop →
   rename dance inside the migration; keep `schema.sql`'s `CREATE` at the new shape
   (fresh DBs get it directly; the migration only runs the rebuild on existing DBs —
   guard it if the rebuild isn't safe to repeat).
5. Validate the full compose locally (baseline + migrations), mirroring prod:
   ```
   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local \
     && npx wrangler d1 migrations apply store_ops --local
   ```
6. The next merge to `main` applies it to prod.

## Prerequisite (one-time)

The deploy token needs **Account · D1 · Edit** (in addition to Workers Scripts /
Pages Edit). Without it the `migrations apply` step fails loudly — which is the
point: a schema that can't apply must not be masked.
